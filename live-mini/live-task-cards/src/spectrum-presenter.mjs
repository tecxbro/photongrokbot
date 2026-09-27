import { CardError, assert } from './errors.mjs';

/** Optional uptime-only record of the initial send; page updates never need it. */
export class MemoryTargets {
  constructor() { this.map = new Map(); }
  async get(id) { return this.map.get(id) ?? null; }
  async set(id, target) { this.map.set(id, target); }
  async forget(id) { this.map.delete(id); }
}

/** Inject the existing Spectrum app builder and original authorized Space. */
export function createSpectrumPresenter({ app, targets }) {
  assert(typeof app === 'function', 'CONFIG_ERROR', 'Supply the installed app builder.');
  return {
    async forget(id) { if (typeof targets?.forget === 'function') await targets.forget(id); },
    async prepare(record, space) {
      assert(space && typeof space.send === 'function' && space.id === record.conversationRef,
        'SPACE_MISMATCH', 'Use the original authorized Space, including its sending line.', 403);
      assert(!record.activeAttempt && !record.delivery.messageRef,
        'PRESENTATION_PENDING', 'The initial send needs reconciliation; do not send a replacement.', 409);
      const operation = app(record.viewUrl, { live: true });
      return {
        async perform() {
          const message = await space.send(operation);
          assert(message && typeof message.id === 'string' && message.id.length > 0,
            'PROVIDER_RESULT_UNKNOWN', 'No usable initial message reference returned; reconcile the send.', 502);
          if (targets?.set) await targets.set(record.id, { space, message });
          return { messageRef: message.id };
        },
      };
    },
  };
}

export function createTaskCardRuntime({ client, presenter, resolveOwner, authorizeLoaderChange }) {
  async function owner(space, context) {
    assert(typeof resolveOwner === 'function', 'LOADER_NOT_CONFIGURED', 'Install the trusted task-owner resolver before using personal loaders.', 409);
    const ref = await resolveOwner(space, context);
    assert(typeof ref === 'string' && ref.trim() === ref && ref.length > 0,
      'OWNER_REQUIRED', 'Resolve the stable task owner from trusted runtime context.', 403);
    return ref;
  }
  async function get(id, space, context) {
    const record = await client.get(id);
    assert(record.conversationRef === space?.id, 'SPACE_MISMATCH', 'Use the original authorized Space.', 403);
    if (record.ownerRef) assert(record.ownerRef === await owner(space, context), 'OWNER_MISMATCH', 'Use the original task owner.', 403);
    return record;
  }
  async function changeLoader(action, input, space, context) {
    assert(typeof authorizeLoaderChange === 'function', 'LOADER_REQUEST_REQUIRED', 'Personalization requires an explicit user request verified by the existing runtime.', 403);
    const ownerRef = await owner(space, context);
    const authorization = await authorizeLoaderChange(space, context);
    assert(authorization?.action === action && typeof authorization.requestId === 'string',
      'LOADER_REQUEST_REQUIRED', 'A photo attachment or ordinary task is not a loader-change request.', 403);
    // Identity and request ID come from trusted callbacks, never the generated asset/tool payload.
    return client.setLoader({ ...input, ownerRef, requestId: authorization.requestId, action });
  }
  async function archive(record) {
    const archived = await client.release(record.id, record.revision);
    if (typeof presenter.forget === 'function') await presenter.forget(record.id);
    return archived;
  }
  async function sync(id, space, context) {
    let record = await get(id, space, context);
    if (record.archivedAt) return { record, presentation: 'already_archived' };
    assert(record.conversationRef === space?.id, 'SPACE_MISMATCH', 'Use the original authorized Space.', 403);
    if (record.activeAttempt) throw new CardError('PRESENTATION_PENDING', 'Reconcile the initial send; no replacement was attempted.', 409);
    if (record.delivery.messageRef) {
      if (['completed', 'failed', 'cancelled'].includes(record.content.status)) record = await archive(record);
      return { record, presentation: 'already_sent' };
    }
    const plan = await presenter.prepare(record, space);
    const claim = await client.beginPresentation(record.id, record.revision);
    if (claim.skipped) return { record: claim.record, presentation: 'already_sent' };
    let result;
    try { result = await plan.perform(); }
    catch {
      try { await client.settlePresentation(record.id, { attemptId: claim.attempt.id, outcome: 'unknown', note: 'SDK or target persistence failed after initial send started.' }); }
      catch { /* The durable in-flight claim still prevents duplicate dispatch. */ }
      throw new CardError('PRESENTATION_UNKNOWN', `Reconcile initial send attempt ${claim.attempt.id}. No automatic resend was attempted.`, 502);
    }
    try {
      record = await client.settlePresentation(record.id, { attemptId: claim.attempt.id, outcome: 'accepted', messageRef: result.messageRef });
    } catch {
      return { record, presentation: 'provider_accepted_ack_pending',
        reconciliation: { attemptId: claim.attempt.id, outcome: 'accepted', messageRef: result.messageRef } };
    }
    if (['completed', 'failed', 'cancelled'].includes(record.content.status)) record = await archive(record);
    return { record, presentation: 'provider_accepted' };
  }
  return {
    get,
    async getLoader(space, context) { return client.getLoader(await owner(space, context)); },
    async setLoader(input, space, context) {
      assert(input && Object.keys(input).every(key => ['asset', 'expectedRevision'].includes(key)), 'INVALID_INPUT', 'Supply asset and expectedRevision only.');
      return changeLoader('replace', input, space, context);
    },
    async resetLoader(input, space, context) {
      assert(input && Object.keys(input).every(key => key === 'expectedRevision'), 'INVALID_INPUT', 'Supply expectedRevision only.');
      return changeLoader('reset', input, space, context);
    },
    async start(input, space, context) {
      assert(input.ownerRef === undefined, 'INVALID_INPUT', 'The trusted owner resolver supplies ownerRef.');
      assert(input.conversationRef === space?.id, 'SPACE_MISMATCH', 'Task and authorized Space do not match.', 403);
      const record = await client.create(resolveOwner ? { ...input, ownerRef: await owner(space, context) } : input);
      return sync(record.id, space, context);
    },
    async update(id, input, space, context) {
      const existing = await get(id, space, context);
      assert(existing.conversationRef === space?.id, 'SPACE_MISMATCH', 'Update must use its original authorized Space.', 403);
      let record = await client.update(id, input);
      if (['completed', 'failed', 'cancelled'].includes(record.content.status) && record.delivery.messageRef && !record.activeAttempt) record = await archive(record);
      return { record, presentation: record.delivery.messageRef ? 'already_sent' : 'initial_send_pending' };
    },
    sync,
  };
}
