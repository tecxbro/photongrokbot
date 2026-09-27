/**
 * Durable live-task-cards milestone helper for Grok VM / Spectrum task execution.
 *
 * Lives OUTSIDE the Vercel deploy tree. Progress = PUT /api/cards/:id at the
 * same viewUrl. Spectrum app(viewUrl,{live:true}) is sent ONCE on create via
 * grok-photon-proof enqueue — never edit/resend for ordinary progress.
 *
 * Prefer attachLiveTaskCards when an in-process Spectrum Space is available;
 * otherwise use publisher HTTP + enqueue (this module's default path).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { PublisherClient } from '../live-task-cards/src/client.mjs';
import { CardError } from '../live-task-cards/src/errors.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INSTALL_ROOT = resolve(__dirname, '..');
const DEFAULT_STATE_DIR = join(__dirname, 'state');
const DEFAULT_SECRETS = join(INSTALL_ROOT, 'secrets', 'prod.env');
const DEFAULT_PROOF_ROOT = '{{BRIDGE_ROOT}}';
const SPACE_PROOF = '{{AUTHORIZED_SPACE_ID}}';

/** Parse KEY=VALUE env file without printing values. */
export function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

export function resolvePublisherConfig(opts = {}) {
  const fileEnv = loadEnvFile(opts.secretsPath || process.env.LIVE_CARDS_SECRETS || DEFAULT_SECRETS);
  const baseUrl = (
    opts.baseUrl ||
    process.env.LIVE_CARDS_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    fileEnv.PUBLIC_BASE_URL ||
    ''
  ).replace(/\/$/, '');
  const token =
    opts.publisherToken ||
    process.env.LIVE_CARDS_PUBLISHER_TOKEN ||
    process.env.PUBLISHER_TOKEN ||
    fileEnv.PUBLISHER_TOKEN ||
    '';
  if (!baseUrl || !token) {
    throw new CardError('CONFIG_ERROR', 'Publisher base URL and token are required (secrets/local.env or env).', 503);
  }
  return { baseUrl, token };
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function statePath(stateDir, taskKey) {
  const safe = String(taskKey).replace(/[^A-Za-z0-9._:-]+/g, '_').slice(0, 120);
  return join(stateDir, `${safe}.json`);
}

function redactViewUrl(url) {
  if (typeof url !== 'string') return url;
  return url.replace(/([?&]k=)[^&]+/gi, '$1REDACTED');
}

function publicViewUrl(url) {
  // Strip query for equality checks of "same URL forever" path identity.
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return String(url).split('?')[0];
  }
}

/**
 * @param {object} [opts]
 * @param {string} [opts.secretsPath]
 * @param {string} [opts.baseUrl]
 * @param {string} [opts.publisherToken]
 * @param {string} [opts.stateDir]
 * @param {string} [opts.proofRoot] grok-photon-proof checkout (for enqueue CLI)
 * @param {object} [opts.liveCards] optional attachLiveTaskCards runtime (in-process Space path)
 * @param {object} [opts.space] authorized Spectrum Space when using liveCards
 * @param {object} [opts.taskContext] context passed to liveCards owner hooks
 * @param {typeof fetch} [opts.fetchImpl]
 */
export function createLiveCardMilestones(opts = {}) {
  const { baseUrl, token } = resolvePublisherConfig(opts);
  const client = new PublisherClient({ baseUrl, token, fetchImpl: opts.fetchImpl });
  const stateDir = opts.stateDir || DEFAULT_STATE_DIR;
  const proofRoot = opts.proofRoot || process.env.GROK_PHOTON_PROOF || DEFAULT_PROOF_ROOT;
  const liveCards = opts.liveCards || null;
  const space = opts.space || null;
  const taskContext = opts.taskContext || {};
  ensureDir(stateDir);

  const log = (...args) => {
    if (opts.silent) return;
    console.log('[live-card-milestones]', ...args);
  };

  function loadContext(taskKey) {
    const p = statePath(stateDir, taskKey);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf8'));
  }

  function saveContext(taskKey, ctx) {
    const p = statePath(stateDir, taskKey);
    const safe = {
      ...ctx,
      viewUrlRedacted: redactViewUrl(ctx.viewUrl),
      updatedAt: new Date().toISOString(),
    };
    // Persist full viewUrl for executor reuse (file is gitignored); never log k=.
    writeFileSync(p, JSON.stringify(safe, null, 2) + '\n', { mode: 0o600 });
    return safe;
  }

  async function createCard(payload, taskKey = payload.taskId || payload.requestId) {
    if (liveCards && space) {
      const started = await liveCards.start(payload, space, taskContext);
      const record = started.record;
      const ctx = saveContext(taskKey, {
        taskKey,
        cardId: record.id,
        revision: record.revision,
        viewUrl: record.viewUrl,
        slot: record.slot,
        conversationRef: record.conversationRef,
        template: record.content?.template,
        spectrumMessageId: record.delivery?.messageRef || null,
        spectrumSendCount: record.delivery?.messageRef ? 1 : 0,
        presentation: started.presentation,
        path: 'attachLiveTaskCards',
      });
      log('createCard(attach)', { cardId: ctx.cardId, slot: ctx.slot, revision: ctx.revision, presentation: started.presentation });
      return { record, context: ctx, presentation: started.presentation };
    }

    const record = await client.create(payload);
    const ctx = saveContext(taskKey, {
      taskKey,
      cardId: record.id,
      revision: record.revision,
      viewUrl: record.viewUrl,
      slot: record.slot,
      conversationRef: record.conversationRef,
      template: record.content?.template,
      spectrumMessageId: null,
      spectrumSendCount: 0,
      path: 'publisher+enqueue',
    });
    log('createCard', { cardId: ctx.cardId, slot: ctx.slot, revision: ctx.revision, viewPath: publicViewUrl(record.viewUrl) });
    return { record, context: ctx };
  }

  /**
   * Enqueue Spectrum app(url,{live:true}) once via grok-photon-proof CLI.
   * Does not use --app-update. Idempotent if context already has spectrumMessageId.
   */
  async function sendOnce(spaceId, viewUrl, taskKey) {
    const ctx = taskKey ? loadContext(taskKey) : null;
    if (ctx?.spectrumMessageId && ctx.spectrumSendCount >= 1) {
      log('sendOnce skipped — already sent', { messageId: ctx.spectrumMessageId, sendCount: ctx.spectrumSendCount });
      return { skipped: true, messageId: ctx.spectrumMessageId, outboundId: ctx.outboundId || null, context: ctx };
    }
    if (liveCards && space) {
      // attach path already sent on start(); sync only if needed
      if (ctx?.cardId) {
        const synced = await liveCards.sync(ctx.cardId, space, taskContext);
        const next = saveContext(taskKey || ctx.taskKey, {
          ...ctx,
          revision: synced.record.revision,
          spectrumMessageId: synced.record.delivery?.messageRef || ctx.spectrumMessageId,
          spectrumSendCount: synced.record.delivery?.messageRef ? 1 : ctx.spectrumSendCount || 0,
          presentation: synced.presentation,
        });
        return { skipped: synced.presentation === 'already_sent', messageId: next.spectrumMessageId, context: next, presentation: synced.presentation };
      }
    }

    const url = viewUrl || ctx?.viewUrl;
    if (!url) throw new CardError('CONFIG_ERROR', 'sendOnce requires viewUrl or persisted context.', 400);
    const sid = spaceId || ctx?.conversationRef || SPACE_PROOF;

    // Claim presentation before send so duplicates cannot race (HTTP path).
    let attemptId = null;
    if (ctx?.cardId) {
      try {
        const claim = await client.beginPresentation(ctx.cardId, ctx.revision);
        if (!claim.skipped) attemptId = claim.attempt?.id;
        else if (claim.record?.delivery?.messageRef) {
          const next = saveContext(taskKey || ctx.taskKey, {
            ...ctx,
            revision: claim.record.revision,
            spectrumMessageId: claim.record.delivery.messageRef,
            spectrumSendCount: 1,
          });
          log('sendOnce skipped — presentation already settled');
          return { skipped: true, messageId: next.spectrumMessageId, context: next };
        }
      } catch (err) {
        if (!(err instanceof CardError && err.code === 'PRESENTATION_PENDING')) throw err;
        throw new CardError('PRESENTATION_PENDING', 'Reconcile in-flight initial send; do not enqueue a replacement.', 409);
      }
    }

    const enqueueResult = await runEnqueueApp({ proofRoot, spaceId: sid, url, live: true });
    const outboundId = enqueueResult.items?.[0]?.id;
    log('enqueue app live', { outboundId, spaceId: sid, viewPath: publicViewUrl(url) });

    const delivered = await waitOutboundSent({ proofRoot, outboundId, timeoutMs: opts.sendTimeoutMs || 90_000 });
    const messageId = delivered.messageId;
    if (!messageId) {
      if (attemptId && ctx?.cardId) {
        try {
          await client.settlePresentation(ctx.cardId, {
            attemptId,
            outcome: 'unknown',
            note: 'Enqueue accepted but messageId not observed in time.',
          });
        } catch { /* durable claim remains */ }
      }
      throw new CardError('PRESENTATION_UNKNOWN', `Outbound ${outboundId} did not yield messageId; reconcile without resend.`, 502);
    }

    if (attemptId && ctx?.cardId) {
      const settled = await client.settlePresentation(ctx.cardId, {
        attemptId,
        outcome: 'accepted',
        messageRef: messageId,
      });
      const next = saveContext(taskKey || ctx.taskKey, {
        ...ctx,
        revision: settled.revision,
        spectrumMessageId: messageId,
        spectrumSendCount: 1,
        outboundId,
        viewUrl: settled.viewUrl || ctx.viewUrl,
      });
      log('presentation settled', { messageId, revision: next.revision, sendCount: 1 });
      return { skipped: false, messageId, outboundId, context: next, record: settled };
    }

    const next = ctx
      ? saveContext(taskKey || ctx.taskKey, {
          ...ctx,
          spectrumMessageId: messageId,
          spectrumSendCount: 1,
          outboundId,
        })
      : { spectrumMessageId: messageId, spectrumSendCount: 1, outboundId, viewUrl: url };
    log('sendOnce complete (no presentation claim)', { messageId, sendCount: 1 });
    return { skipped: false, messageId, outboundId, context: next };
  }

  /**
   * PUT milestone snapshot. On REVISION_CONFLICT: re-get and reconcile expectedRevision once
   * (same requestId retry is idempotent if content matches).
   */
  async function updateMilestone(cardId, updateBody, taskKey) {
    const id = cardId || (taskKey && loadContext(taskKey)?.cardId);
    if (!id) throw new CardError('INVALID_INPUT', 'updateMilestone requires cardId or taskKey with state.', 400);

    if (liveCards && space) {
      const body = { ...updateBody };
      if (body.expectedRevision == null) {
        const existing = await liveCards.get(id, space, taskContext);
        body.expectedRevision = existing.revision;
      }
      try {
        const result = await liveCards.update(id, body, space, taskContext);
        if (taskKey || loadContext(id)) {
          const key = taskKey || loadContext(id)?.taskKey || id;
          const prev = loadContext(key) || { taskKey: key, cardId: id };
          saveContext(key, {
            ...prev,
            cardId: result.record.id,
            revision: result.record.revision,
            viewUrl: result.record.viewUrl || prev.viewUrl,
            spectrumMessageId: result.record.delivery?.messageRef || prev.spectrumMessageId,
            lastMilestoneRequestId: body.requestId,
          });
        }
        log('updateMilestone(attach)', {
          cardId: id,
          revision: result.record.revision,
          status: result.record.content?.status,
          presentation: result.presentation,
          viewPath: publicViewUrl(result.record.viewUrl),
        });
        return { record: result.record, presentation: result.presentation };
      } catch (err) {
        if (!(err instanceof CardError && err.code === 'REVISION_CONFLICT')) throw err;
        const fresh = await liveCards.get(id, space, taskContext);
        const retry = { ...body, expectedRevision: fresh.revision };
        const result = await liveCards.update(id, retry, space, taskContext);
        log('updateMilestone reconciled REVISION_CONFLICT', { cardId: id, revision: result.record.revision });
        return { record: result.record, presentation: result.presentation, reconciled: true };
      }
    }

    const body = { ...updateBody };
    if (body.expectedRevision == null) {
      const existing = await client.get(id);
      body.expectedRevision = existing.revision;
    }

    try {
      const record = await client.update(id, body);
      persistAfterWrite(taskKey, id, record, body.requestId);
      assertSameUrl(taskKey, id, record);
      log('updateMilestone', {
        cardId: id,
        revision: record.revision,
        status: record.content?.status,
        active: record.content?.stages?.find((s) => s.state === 'active')?.id,
        viewPath: publicViewUrl(record.viewUrl),
      });
      return { record };
    } catch (err) {
      if (!(err instanceof CardError && err.code === 'REVISION_CONFLICT')) throw err;
      const fresh = await client.get(id);
      const retryBody = { ...body, expectedRevision: fresh.revision };
      // Same requestId + same content is safe idempotent retry; different content needs new requestId.
      try {
        const record = await client.update(id, retryBody);
        persistAfterWrite(taskKey, id, record, retryBody.requestId);
        assertSameUrl(taskKey, id, record);
        log('updateMilestone reconciled REVISION_CONFLICT (same requestId)', { cardId: id, revision: record.revision });
        return { record, reconciled: true };
      } catch (err2) {
        if (!(err2 instanceof CardError && err2.code === 'IDEMPOTENCY_CONFLICT')) throw err2;
        const freshRequestId = `${body.requestId}-reconcile-${Date.now()}`;
        const record = await client.update(id, { ...retryBody, requestId: freshRequestId });
        persistAfterWrite(taskKey, id, record, freshRequestId);
        assertSameUrl(taskKey, id, record);
        log('updateMilestone reconciled with new requestId', { cardId: id, revision: record.revision });
        return { record, reconciled: true };
      }
    }
  }

  function persistAfterWrite(taskKey, id, record, requestId) {
    const prev = (taskKey && loadContext(taskKey)) || loadContext(id) || { taskKey: taskKey || id, cardId: id };
    saveContext(prev.taskKey || taskKey || id, {
      ...prev,
      cardId: record.id,
      revision: record.revision,
      viewUrl: record.viewUrl || prev.viewUrl,
      slot: record.slot || prev.slot,
      lastMilestoneRequestId: requestId,
    });
  }

  function assertSameUrl(taskKey, id, record) {
    const prev = (taskKey && loadContext(taskKey)) || loadContext(id);
    if (!prev?.viewUrl || !record.viewUrl) return;
    const a = publicViewUrl(prev.viewUrl);
    const b = publicViewUrl(record.viewUrl);
    if (a !== b) {
      throw new CardError('URL_CHANGED', `viewUrl path changed from ${a} to ${b}; aborting.`, 500);
    }
  }

  /**
   * Ensure terminal status then release slot. Requires reconciled initial send (messageRef).
   */
  async function completeAndRelease(cardId, taskKey, terminalContent) {
    const key = taskKey;
    let ctx = key ? loadContext(key) : null;
    const id = cardId || ctx?.cardId;
    if (!id) throw new CardError('INVALID_INPUT', 'completeAndRelease requires cardId or taskKey.', 400);

    let record = await client.get(id);
    if (!['completed', 'failed', 'cancelled'].includes(record.content.status)) {
      if (!terminalContent) {
        throw new CardError('TASK_NOT_FINISHED', 'Provide terminal content snapshot before release.', 409);
      }
      const updated = await updateMilestone(
        id,
        {
          requestId: terminalContent.requestId || `complete-${id}-${Date.now()}`,
          expectedRevision: record.revision,
          content: terminalContent.content || terminalContent,
        },
        key,
      );
      record = updated.record;
    }

    if (liveCards && space) {
      // update() on attach path auto-archives when terminal + messageRef
      record = (await liveCards.get(id, space, taskContext));
      if (record.archivedAt) {
        const next = saveContext(key || id, { ...(ctx || {}), cardId: id, revision: record.revision, archivedAt: record.archivedAt, released: true });
        log('completeAndRelease already archived', { cardId: id, revision: record.revision });
        return { record, context: next };
      }
    }

    try {
      const archived = await client.release(id, record.revision);
      const next = saveContext(key || id, {
        ...(ctx || loadContext(id) || { taskKey: key || id, cardId: id }),
        revision: archived.revision,
        archivedAt: archived.archivedAt,
        released: true,
        spectrumMessageId: archived.delivery?.messageRef || ctx?.spectrumMessageId,
      });
      log('completeAndRelease', { cardId: id, revision: archived.revision, archivedAt: archived.archivedAt });
      return { record: archived, context: next };
    } catch (err) {
      if (err instanceof CardError && err.code === 'REVISION_CONFLICT') {
        const fresh = await client.get(id);
        const archived = await client.release(id, fresh.revision);
        const next = saveContext(key || id, {
          ...(ctx || { taskKey: key || id, cardId: id }),
          revision: archived.revision,
          archivedAt: archived.archivedAt,
          released: true,
        });
        return { record: archived, context: next, reconciled: true };
      }
      // Prod host may require presentedRevision === final revision (FINAL_NOT_PRESENTED).
      // Package service.mjs does not. Never Spectrum edit/resend to satisfy that — terminal
      // JSON is already at the same URL; slot stays occupied until host aligns or operator discards policy allows.
      if (err instanceof CardError && err.code === 'FINAL_NOT_PRESENTED') {
        const next = saveContext(key || id, {
          ...(ctx || loadContext(id) || { taskKey: key || id, cardId: id }),
          revision: record.revision,
          released: false,
          releaseBlocked: 'FINAL_NOT_PRESENTED',
          spectrumMessageId: record.delivery?.messageRef || ctx?.spectrumMessageId,
        });
        log('completeAndRelease blocked FINAL_NOT_PRESENTED (no Spectrum re-present)', {
          cardId: id,
          revision: record.revision,
          presentedRevision: record.delivery?.presentedRevision,
        });
        return { record, context: next, releaseBlocked: 'FINAL_NOT_PRESENTED' };
      }
      throw err;
    }
  }

  return {
    client,
    baseUrl,
    stateDir,
    loadContext,
    saveContext,
    createCard,
    sendOnce,
    updateMilestone,
    completeAndRelease,
    doctor: () => client.doctor(),
    slots: () => client.slots(),
    get: (id) => client.get(id),
    SPACE_PROOF,
  };
}

/** Spawn: bun run enqueue -- --space-id … --app-url … --live */
export function runEnqueueApp({ proofRoot, spaceId, url, live = true }) {
  return new Promise((resolvePromise, reject) => {
    const args = ['run', 'enqueue', '--', '--space-id', spaceId, '--app-url', url];
    if (live) args.push('--live');
    const child = spawn('bun', args, { cwd: proofRoot, env: process.env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`enqueue exited ${code}: ${stderr || stdout}`));
        return;
      }
      try {
        resolvePromise(JSON.parse(stdout));
      } catch (err) {
        reject(new Error(`enqueue returned non-JSON: ${stdout.slice(0, 400)}`));
      }
    });
  });
}

export async function waitOutboundSent({ proofRoot, outboundId, timeoutMs = 90_000, pollMs = 500 }) {
  const queuePath = join(proofRoot, 'data', 'outbound-queue.json');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(queuePath)) {
      const file = JSON.parse(readFileSync(queuePath, 'utf8'));
      const items = Array.isArray(file) ? file : file.items || [];
      const item = items.find((i) => i.id === outboundId);
      if (item?.status === 'sent' && item.messageId) {
        return { messageId: item.messageId, item };
      }
      if (item?.status === 'failed' || item?.status === 'error') {
        throw new Error(`outbound ${outboundId} failed: ${item.lastError || item.error || item.status}`);
      }
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return { messageId: null };
}

/**
 * Optional: wrap attachLiveTaskCards when Spectrum Space + app builder exist in-process.
 * Import examples/existing-runtime.mjs from the caller's shared Spectrum process.
 */
export async function tryAttachLiveTaskCards(attachOpts) {
  const mod = await import('../live-task-cards/examples/existing-runtime.mjs');
  return mod.attachLiveTaskCards(attachOpts);
}

export { SPACE_PROOF, DEFAULT_STATE_DIR, DEFAULT_SECRETS, redactViewUrl, publicViewUrl };
