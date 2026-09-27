import { loaderFor, loaderPreference, setLoaderPreference, pruneLoaders } from './loaders.mjs';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { assert } from './errors.mjs';
import { identifier, integer, object, parseCreate, parseUpdate, SLOT_NAMES, TERMINAL, text } from './model.mjs';

function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export function secureEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// Server-owned elapsed stage time survives theme changes, pauses and reopening.
function workflowTiming(content, now, previous = null) {
  if (!content.workflow) return null;
  const stageId = content.stages.find(stage => stage.state !== 'done')?.id ?? null;
  const same = previous?.stageId === stageId;
  const elapsedMs = same ? previous.elapsedMs + (previous.resumedAt ? Math.max(0, Date.parse(now) - Date.parse(previous.resumedAt)) : 0) : 0;
  return { stageId, elapsedMs, resumedAt: content.status === 'running' ? now : null };
}

/** Owns publishing state, not task execution. One instance/pool per user's setup. */
export class CardService {
  constructor(store, config, { clock = () => new Date(), newId = randomUUID } = {}) {
    this.store = store; this.config = config; this.clock = clock; this.newId = newId;
  }
  now() { return this.clock().toISOString(); }
  key(record) {
    return createHmac('sha256', this.config.viewSecret)
      .update(`live-card:v1:${record.slot}:${record.id}`).digest('base64url');
  }
  url(record) {
    const url = new URL(`/${record.slot}/${record.id}`, this.config.baseUrl);
    url.searchParams.set('k', this.key(record));
    return url.href;
  }
  output(record) {
    return { ownerRef: record.ownerRef ?? null, loaderAssetId: record.loaderAssetId ?? null, id: record.id, slot: record.slot, taskId: record.taskId, conversationRef: record.conversationRef,
      workflowTiming: record.workflowTiming ?? null, revision: record.revision, createdAt: record.createdAt, updatedAt: record.updatedAt,
      archivedAt: record.archivedAt, content: record.content, delivery: record.delivery,
      activeAttempt: record.activeAttempt, viewUrl: this.url(record) };
  }
  require(state, id) {
    identifier(id);
    const r = state.cards[id];
    assert(r, 'CARD_NOT_FOUND', 'Card is unavailable or its read-only history has expired.', 404);
    return r;
  }
  available(r) {
    assert(!r.archivedAt, 'CARD_ARCHIVED', 'This card is read-only history. Start another task with a new identity.', 409);
  }
  prune(state, now) {
    const cutoff = Date.parse(now) - this.config.archiveDays * 86400_000;
    const archived = Object.values(state.cards).filter(r => r.archivedAt)
      .sort((a, b) => a.archivedAt.localeCompare(b.archivedAt));
    const extra = Math.max(0, archived.length - this.config.maxArchived);
    archived.forEach((r, i) => {
      if (Date.parse(r.archivedAt) < cutoff || i < extra) delete state.cards[r.id];
    });
    pruneLoaders(state);
  }
  async getLoader(ownerRef) { return loaderPreference(await this.store.read(), ownerRef); }
  async setLoader(input) {
    const now = this.now();
    return this.store.transaction(state => { this.prune(state, now); return setLoaderPreference(state, input, now); });
  }
  async create(input) {
    const b = parseCreate(input), hash = digest(b), id = this.newId(), now = this.now();
    return this.store.transaction(state => {
      this.prune(state, now);
      const retry = Object.values(state.cards).find(r => r.initialRequestId === b.requestId);
      if (retry) {
        assert(retry.initialHash === hash, 'IDEMPOTENCY_CONFLICT', 'Create requestId was reused with different content.', 409);
        return this.output(retry);
      }
      const existing = Object.values(state.cards).find(r => r.taskId === b.taskId && r.conversationRef === b.conversationRef);
      assert(!existing, 'TASK_ALREADY_HAS_CARD', 'This task already has a retained card. Read the slots/records and update that card.', 409);
      const slot = SLOT_NAMES.find(s => state.slots[s] === null);
      assert(slot, 'NO_SLOT_AVAILABLE', 'All ten slots are occupied. Continue the task using text.', 409);
      const record = { id, slot, taskId: b.taskId, conversationRef: b.conversationRef,
        ownerRef: b.ownerRef ?? null, loaderAssetId: b.ownerRef ? loaderPreference(state, b.ownerRef).loader?.id ?? null : null,
        revision: 1, createdAt: now, updatedAt: now, archivedAt: null,
        initialRequestId: b.requestId, initialHash: hash, lastUpdate: null,
        content: b.content, workflowTiming: workflowTiming(b.content, now), delivery: { messageRef: null, presentedRevision: 0, lastAttempt: null },
        activeAttempt: null };
      state.cards[id] = record; state.slots[slot] = id;
      return this.output(record);
    });
  }
  async get(id) { return this.output(this.require(await this.store.read(), id)); }
  async slots() {
    const s = await this.store.read();
    return SLOT_NAMES.map(slot => {
      const r = s.cards[s.slots[slot]];
      return { slot, occupied: Boolean(r), cardId: r?.id ?? null, taskId: r?.taskId ?? null,
        conversationRef: r?.conversationRef ?? null, status: r?.content.status ?? null,
        revision: r?.revision ?? null, presentationPending: Boolean(r?.activeAttempt) };
    });
  }
  async update(id, input) {
    const b = parseUpdate(input), hash = digest(b), now = this.now();
    return this.store.transaction(s => {
      const r = this.require(s, id);
      if (r.lastUpdate?.requestId === b.requestId) {
        assert(r.lastUpdate.hash === hash, 'IDEMPOTENCY_CONFLICT', 'Update requestId was reused with different content.', 409);
        return this.output(r);
      }
      this.available(r);
      assert(r.revision === b.expectedRevision, 'REVISION_CONFLICT', 'Read current state; do not overwrite a newer revision.', 409);
      assert(!TERMINAL.has(r.content.status), 'TASK_TERMINAL', 'Terminal task content is immutable. Use a new task for new work.', 409);
      assert(b.content.template === r.content.template, 'TEMPLATE_CONFLICT', 'Keep the selected card template for this task.', 409);
      assert(Boolean(b.content.workflow) === Boolean(r.content.workflow), 'WORKFLOW_CONFLICT', 'Keep the progress mode for this card.');
      if (r.content.workflow) {
        assert(digest(b.content.workflow) === digest(r.content.workflow), 'WORKFLOW_CONFLICT', 'Keep stage weights and pacing fixed for this workflow.');
        for (const stage of r.content.stages.filter(stage => stage.state === 'done')) {
          assert(b.content.stages.find(next => next.id === stage.id)?.state === 'done', 'WORKFLOW_CONFLICT', 'Confirmed stages cannot become unfinished.');
        }
      }
      r.workflowTiming = workflowTiming(b.content, now, r.workflowTiming);
      r.content = b.content; r.revision++; r.updatedAt = now;
      r.lastUpdate = { requestId: b.requestId, hash };
      this.prune(s, now);
      return this.output(r);
    });
  }
  async beginPresentation(id, input) {
    object(input, 'presentation', ['revision']);
    const revision = integer(input.revision, 'revision', 1, Number.MAX_SAFE_INTEGER);
    const attemptId = this.newId(), now = this.now();
    return this.store.transaction(s => {
      const r = this.require(s, id); this.available(r);
      assert(!r.activeAttempt, 'PRESENTATION_PENDING', 'Reconcile the initial send first.', 409);
      assert(r.revision === revision, 'REVISION_CONFLICT', 'Present only the current saved revision.', 409);
      if (r.delivery.messageRef) return { skipped: true, record: this.output(r) };
      r.activeAttempt = { id: attemptId, revision, kind: 'send',
        state: 'in_flight', startedAt: now };
      return { skipped: false, attempt: structuredClone(r.activeAttempt), record: this.output(r) };
    });
  }
  async settlePresentation(id, input) {
    object(input, 'settlement', ['attemptId', 'outcome', 'messageRef', 'note']);
    const attemptId = identifier(input.attemptId, 'attemptId');
    assert(['accepted', 'not_applied', 'unknown'].includes(input.outcome), 'INVALID_INPUT', 'Invalid presentation outcome.');
    const b = { attemptId, outcome: input.outcome, messageRef: input.messageRef == null ? null : text(input.messageRef, 'messageRef', 256),
      note: text(input.note, 'note', 160, true) };
    const now = this.now(), hash = digest(b);
    return this.store.transaction(s => {
      const r = this.require(s, id);
      if (!r.activeAttempt && r.delivery.lastAttempt?.id === attemptId) {
        assert(r.delivery.lastAttempt.hash === hash, 'SETTLEMENT_CONFLICT', 'This presentation has already been settled differently.', 409);
        return this.output(r);
      }
      const a = r.activeAttempt;
      assert(a?.id === attemptId, 'ATTEMPT_CONFLICT', 'Settlement does not match the in-flight attempt.', 409);
      if (b.outcome === 'unknown') {
        a.state = 'unknown'; a.note = b.note || 'Provider outcome needs reconciliation.';
        return this.output(r);
      }
      if (b.outcome === 'accepted') {
        if (a.kind === 'send') {
          assert(b.messageRef, 'INVALID_INPUT', 'Accepted send requires the actual returned message reference.');
          r.delivery.messageRef = b.messageRef;
        } else {
          // Settle pre-migration edit claims without permitting any new edit claims.
          if (b.messageRef) assert(b.messageRef === r.delivery.messageRef,
            'MESSAGE_CONFLICT', 'A legacy edit cannot replace the original message reference.', 409);
        }
        r.delivery.presentedRevision = a.revision;
      }
      r.delivery.lastAttempt = { id: a.id, kind: a.kind, revision: a.revision,
        outcome: b.outcome, settledAt: now, hash, note: b.note };
      r.activeAttempt = null;
      return this.output(r);
    });
  }
  async release(id, expectedRevision) {
    integer(expectedRevision, 'expectedRevision', 1, Number.MAX_SAFE_INTEGER);
    const now = this.now();
    return this.store.transaction(s => {
      const r = this.require(s, id);
      assert(r.revision === expectedRevision, 'REVISION_CONFLICT', 'Release the exact final revision.', 409);
      if (r.archivedAt) return this.output(r);
      this.available(r);
      assert(!r.activeAttempt, 'PRESENTATION_PENDING', 'Reconcile the initial send before releasing its slot.', 409);
      assert(TERMINAL.has(r.content.status), 'TASK_NOT_FINISHED', 'Running, queued or waiting cards retain their slot.', 409);
      assert(r.delivery.messageRef,
        'INITIAL_SEND_NOT_RECONCILED', 'Reconcile the initial send before releasing its slot.', 409);
      r.archivedAt = now; s.slots[r.slot] = null;
      const result = this.output(r); this.prune(s, now); return result;
    });
  }
  async discard(id) {
    const now = this.now();
    return this.store.transaction(s => {
      const r = this.require(s, id);
      if (r.archivedAt) return this.output(r);
      this.available(r);
      assert(!r.activeAttempt, 'PRESENTATION_PENDING', 'Reconcile the initial send before discarding.', 409);
      assert(!r.delivery.messageRef && r.delivery.presentedRevision === 0,
        'ALREADY_PRESENTED', 'Only an unsent draft with no uncertain send can be discarded.', 409);
      r.archivedAt = now; s.slots[r.slot] = null;
      const result = this.output(r); this.prune(s, now); return result;
    });
  }
  async view(slot, id, key) {
    assert(secureEqual(this.key({ slot, id }), key), 'CARD_NOT_FOUND', 'Card is unavailable.', 404);
    const state = await this.store.read();
    const r = this.require(state, id);
    assert(r.slot === slot, 'CARD_NOT_FOUND', 'Card is unavailable.', 404);
    const expired = r.archivedAt && Date.parse(r.archivedAt) < this.clock().getTime() - this.config.archiveDays * 86400_000;
    assert(!expired, 'CARD_NOT_FOUND', 'This card’s read-only history has expired.', 404);
    // No internal task/conversation IDs, publishing tokens, SDK objects or attempts.
    return { id: r.id, slot: r.slot, revision: r.revision, updatedAt: r.updatedAt,
      archived: Boolean(r.archivedAt), loader: loaderFor(state, r), workflowTiming: r.workflowTiming ?? null, content: r.content };
  }
}
