/** Private Node 22 publisher helper. All physical sends use the existing bridge outbox. */
import {
  readFileSync,
  existsSync,
  openSync,
  fstatSync,
  readSync,
  closeSync,
  constants,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  resolveInstancePaths,
  assertPrivateFile,
  atomicPrivateWrite,
} from "../../shared/instance-paths.mjs";
import { PublisherClient } from "../live-task-cards/src/client.mjs";
import { CardError, assert } from "../live-task-cards/src/errors.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BRIDGE_ROOT = resolve(HERE, "../../bridge");
const LIMIT = 65536;
const terminal = new Set(["completed", "failed", "cancelled"]);
function fail(code) {
  throw new CardError(code, code, 409);
}
function identifier(value) {
  assert(
    typeof value === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/.test(value),
    "CONTEXT_REQUIRED",
    "A complete task identity is required.",
  );
  return value;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
const serialize = (value) => JSON.stringify(canonical(value));
const hash = (value) =>
  createHash("sha256").update(serialize(value)).digest("hex");

export function loadEnvFile(path, root = dirname(path)) {
  if (!existsSync(path)) return {};
  let fd;
  let raw;
  try {
    fd = openSync(
      assertPrivateFile(path, root),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const stat = fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > LIMIT)
      fail("CONFIG_ERROR");
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!count) fail("CONFIG_ERROR");
      offset += count;
    }
    if (fstatSync(fd).size !== stat.size) fail("CONFIG_ERROR");
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("CONFIG_ERROR");
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  const out = Object.create(null);
  for (const rawLine of raw.split(/\r?\n/)) {
    if (/[\x00-\x1f\x7f]/.test(rawLine)) fail("CONFIG_ERROR");
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(PUBLIC_BASE_URL|PUBLISHER_TOKEN)\s*=\s*(.*)$/.exec(line);
    if (!match || Object.hasOwn(out, match[1])) fail("CONFIG_ERROR");
    let value = match[2];
    if (/^["']/.test(value)) {
      if (value.length < 2 || value.at(-1) !== value[0]) fail("CONFIG_ERROR");
      value = value.slice(1, -1);
    }
    if (!value || /[\x00-\x20\x7f"']/.test(value)) fail("CONFIG_ERROR");
    out[match[1]] = value; // Literal values only: no expansion, interpolation or shell evaluation.
  }
  if (!out.PUBLIC_BASE_URL || !out.PUBLISHER_TOKEN) fail("CONFIG_ERROR");
  try {
    const url = new URL(out.PUBLIC_BASE_URL);
    if (
      url.protocol !== "https:" ||
      url.pathname !== "/" ||
      url.username ||
      url.password ||
      url.hash ||
      url.search
    )
      fail("CONFIG_ERROR");
  } catch {
    fail("CONFIG_ERROR");
  }
  return out;
}
export function resolvePublisherConfig(
  opts = {},
  paths = resolveInstancePaths(),
) {
  if (opts.secretsPath || opts.stateDir) fail("CANONICAL_PATHS_REQUIRED");
  const env = loadEnvFile(paths.liveMiniEnv, paths.root);
  const baseUrl = opts.baseUrl ?? env.PUBLIC_BASE_URL;
  const token = opts.publisherToken ?? env.PUBLISHER_TOKEN;
  if (!baseUrl || !token) fail("CONFIG_ERROR");
  return { baseUrl, token };
}

/** No shell, bounded stdin/stdout/stderr, finite execution deadline, generic errors. */
export function runBridgeControl({
  command,
  body,
  bridgeRoot = BRIDGE_ROOT,
  bun = process.env.PHOTON_BUN_BIN || "bun",
  timeoutMs = 10000,
  env = process.env,
}) {
  const scripts = {
    "task-context": ["src/presentation-control.ts", "task-context"],
    register: ["src/presentation-control.ts", "register"],
    "operation-status": ["src/presentation-control.ts", "operation-status"],
    enqueue: ["src/enqueue.ts"],
  };
  if (!scripts[command])
    return Promise.reject(
      new CardError("BRIDGE_COMMAND_INVALID", "Bridge command rejected."),
    );
  const input = JSON.stringify(body);
  if (Buffer.byteLength(input) > LIMIT)
    return Promise.reject(
      new CardError("BRIDGE_INPUT_TOO_LARGE", "Bridge input rejected."),
    );
  return new Promise((resolveResult, reject) => {
    const child = spawn(bun, ["run", ...scripts[command], "--json-stdin"], {
      cwd: bridgeRoot,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "",
      bytes = 0,
      settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        child.kill("SIGKILL");
        reject(new CardError(error, error, 502));
      } else resolveResult(value);
    };
    const timer = setTimeout(
      () => finish("BRIDGE_RESPONSE_UNKNOWN"),
      timeoutMs,
    );
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > LIMIT) finish("BRIDGE_RESPONSE_TOO_LARGE");
      else output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > LIMIT) finish("BRIDGE_RESPONSE_TOO_LARGE");
    });
    child.on("error", () => finish("BRIDGE_UNAVAILABLE"));
    child.stdin.on("error", () => finish("BRIDGE_RESPONSE_UNKNOWN"));
    child.on("close", (code) => {
      if (code !== 0) return finish("BRIDGE_REJECTED");
      try {
        finish(null, JSON.parse(output));
      } catch {
        finish("BRIDGE_RESPONSE_UNKNOWN");
      }
    });
    child.stdin.end(input);
  });
}

/** Lock holder has no publisher secrets. EOF releases after Node death; holder loss fences writes. */
export async function withContextLock(
  path,
  action,
  { python = "python3" } = {},
) {
  const child = spawn(python, [join(HERE, "context-lock.py"), path], {
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", PYTHONUTF8: "1" },
    stdio: ["pipe", "pipe", "ignore"],
  });
  let alive = true;
  child.stdin.on("error", () => {
    alive = false;
  });
  const closed = new Promise((resolveClosed) => {
    child.once("close", () => {
      alive = false;
      resolveClosed();
    });
    child.once("error", () => {
      alive = false;
      resolveClosed();
    });
  });
  const check = () => {
    if (!alive) fail("CONTEXT_LOCK_LOST");
  };
  try {
    await new Promise((resolveReady, reject) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(
          new CardError(
            "CONTEXT_LOCK_UNAVAILABLE",
            "Context lock unavailable.",
          ),
        );
      }, 3000);
      child.once("error", () => {
        clearTimeout(timer);
        reject(
          new CardError(
            "CONTEXT_LOCK_UNAVAILABLE",
            "Context lock unavailable.",
          ),
        );
      });
      child.once("close", () => {
        clearTimeout(timer);
        reject(
          new CardError(
            "CONTEXT_BUSY",
            "Context is busy; retry the same task identity.",
          ),
        );
      });
      child.stdout.once("data", (chunk) => {
        clearTimeout(timer);
        if (chunk.toString() === "CONTEXT_LOCKED\n") resolveReady();
        else {
          child.kill();
          reject(
            new CardError(
              "CONTEXT_LOCK_UNAVAILABLE",
              "Context lock unavailable.",
            ),
          );
        }
      });
    });
    check();
    return await action(check, child.pid);
  } finally {
    child.stdin.end();
    await closed;
  }
}

export function createLiveCardMilestones(opts = {}) {
  if (opts.liveCards || opts.space) fail("CANONICAL_BRIDGE_REQUIRED");
  const paths = resolveInstancePaths({ instanceDir: opts.paths?.root });
  if (existsSync(join(HERE, "state"))) fail("LEGACY_CONTEXT_REVIEW_REQUIRED");
  // Reading verifies this is an initialized private instance; helpers never bootstrap it.
  const installationId = JSON.parse(
    readFileSync(assertPrivateFile(paths.configPath, paths.root), "utf8"),
  ).installationId;
  identifier(installationId);
  const task = opts.taskContext;
  if (!task || !task.claim) fail("CONTEXT_REQUIRED");
  identifier(task.taskId);
  identifier(task.batchId);
  if (task.claim.batchId !== task.batchId) fail("CONTEXT_MISMATCH");
  const { baseUrl, token } = resolvePublisherConfig(opts, paths);
  const client = new PublisherClient({
    baseUrl,
    token,
    fetchImpl: opts.fetchImpl,
  });
  const control =
    opts.control ??
    ((command, body) =>
      runBridgeControl({
        command,
        body,
        bridgeRoot: opts.bridgeRoot ?? BRIDGE_ROOT,
        bun: opts.bun,
        env: { ...process.env, PHOTON_INSTANCE_DIR: paths.root },
      }));
  async function binding() {
    const result = await control("task-context", {
      taskId: task.taskId,
      batchId: task.batchId,
    });
    if (
      result.taskId !== task.taskId ||
      result.batchId !== task.batchId ||
      result.origin !== new URL(baseUrl).origin
    )
      fail("CONTEXT_MISMATCH");
    for (const value of [
      result.destination?.spaceId,
      result.destination?.lineId,
    ])
      if (
        typeof value !== "string" ||
        !value.trim() ||
        value.length > 1000 ||
        value.includes("\0")
      )
        fail("CONTEXT_MISMATCH");
    return result;
  }
  async function scoped(taskKey, action) {
    if (
      typeof taskKey !== "string" ||
      !taskKey.trim() ||
      taskKey.length > 1024 ||
      taskKey.includes("\0")
    )
      fail("CONTEXT_REQUIRED");
    const bound = await binding();
    const identity = {
      installationId,
      taskId: task.taskId,
      batchId: task.batchId,
      destination: bound.destination,
      taskKey,
    };
    const digest = hash(identity);
    const path = join(paths.liveMiniContextDir, `${digest}.json`);
    return withContextLock(`${path}.lock`, async (check) => {
      const load = () => {
        check();
        if (!existsSync(path)) return null;
        const context = JSON.parse(
          readFileSync(assertPrivateFile(path, paths.root), "utf8"),
        );
        if (serialize(context.identity) !== serialize(identity))
          fail("CONTEXT_MISMATCH");
        return context;
      };
      const save = (context) => {
        check();
        const prior = load();
        if (prior?.viewUrl && context.viewUrl !== prior.viewUrl)
          fail("URL_CHANGED");
        atomicPrivateWrite(path, `${JSON.stringify(context, null, 2)}\n`);
        return context;
      };
      const required = () => {
        const ctx = load();
        if (!ctx?.cardId || !ctx.viewUrl) fail("CONTEXT_REQUIRED");
        return ctx;
      };
      return action({ load, save, required, check, identity, digest, path });
    });
  }
  function verifyRecord(ctx, record) {
    if (
      !record ||
      record.taskId !== task.taskId ||
      record.conversationRef !== ctx.identity.destination.spaceId ||
      (ctx.cardId && record.id !== ctx.cardId)
    )
      fail("CONTEXT_MISMATCH");
    if (ctx.viewUrl && record.viewUrl !== ctx.viewUrl) fail("URL_CHANGED");
    const url = new URL(record.viewUrl);
    if (
      url.origin !== new URL(baseUrl).origin ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      url.href !== record.viewUrl ||
      url.pathname !== `/${record.slot}/${record.id}` ||
      !/^live-(?:[1-9]|10)$/.test(record.slot) ||
      !url.searchParams.get("k") ||
      [...url.searchParams.keys()].join() !== "k"
    )
      fail("CONTEXT_MISMATCH");
    return record;
  }
  const presentationContext = (ctx) => ({
    cardId: ctx.cardId,
    taskId: task.taskId,
    batchId: task.batchId,
    destination: ctx.identity.destination,
    viewUrl: ctx.viewUrl,
  });
  async function status(ctx) {
    const result = await control("operation-status", {
      taskId: task.taskId,
      batchId: task.batchId,
      actionKey: ctx.actionKey,
    });
    if (!Array.isArray(result.items) || result.items.length > 1)
      fail("OUTBOUND_STATUS_INVALID");
    return result.items[0];
  }
  async function createCard(payload, taskKey) {
    return scoped(taskKey, async ({ load, save, identity, digest, check }) => {
      if (
        payload.taskId !== task.taskId ||
        payload.conversationRef !== identity.destination.spaceId
      )
        fail("CONTEXT_MISMATCH");
      identifier(payload.requestId);
      if (Buffer.byteLength(serialize(payload)) > LIMIT)
        fail("CREATE_INPUT_TOO_LARGE");
      let ctx = load();
      if (ctx && serialize(ctx.creation) !== serialize(payload))
        fail("IDEMPOTENCY_CONFLICT");
      if (!ctx?.cardId) {
        await control("task-context", {
          taskId: task.taskId,
          batchId: task.batchId,
          claim: task.claim,
        });
      }
      if (!ctx) {
        ctx = save({
          version: 1,
          identity,
          creation: payload,
          actionKey: `live-card:${digest}`,
          phase: "create_intent",
        });
      }
      check();
      const record = verifyRecord(
        ctx,
        ctx.cardId
          ? await client.get(ctx.cardId)
          : await client.create(ctx.creation),
      );
      ctx = save({
        ...ctx,
        cardId: record.id,
        viewUrl: record.viewUrl,
        slot: record.slot,
        revision: record.revision,
        phase: ctx.phase === "create_intent" ? "created" : ctx.phase,
      });
      check();
      await control("register", {
        claim: task.claim,
        context: presentationContext(ctx),
      });
      return { record, context: ctx };
    });
  }
  async function sendOnce(spaceId, viewUrl, taskKey) {
    return scoped(taskKey, async ({ required, save, check }) => {
      let ctx = required();
      if (
        spaceId !== ctx.identity.destination.spaceId ||
        viewUrl !== ctx.viewUrl
      )
        fail("CONTEXT_MISMATCH");
      let record = verifyRecord(ctx, await client.get(ctx.cardId));
      let outcome = await status(ctx);
      if (!ctx.attemptId && !ctx.beginIntent && record.activeAttempt)
        fail("PRESENTATION_PENDING");
      if (!ctx.attemptId && record.delivery.messageRef)
        fail("PRESENTATION_EVIDENCE_REQUIRED");
      if (!ctx.attemptId) {
        check();
        await control("register", {
          claim: task.claim,
          context: presentationContext(ctx),
        });
        if (!ctx.beginIntent)
          ctx = save({
            ...ctx,
            beginIntent: { revision: record.revision },
            phase: "claim_intent",
          });
        if (record.activeAttempt) {
          if (
            record.activeAttempt.revision !== ctx.beginIntent.revision ||
            record.activeAttempt.kind !== "send"
          )
            fail("PRESENTATION_PENDING");
          ctx = save({
            ...ctx,
            attemptId: record.activeAttempt.id,
            phase: "claimed",
          });
        } else {
          check();
          const claim = await client.beginPresentation(
            ctx.cardId,
            ctx.beginIntent.revision,
          );
          verifyRecord(ctx, claim.record);
          if (claim.skipped || !claim.attempt?.id)
            fail("PRESENTATION_EVIDENCE_REQUIRED");
          record = claim.record;
          ctx = save({ ...ctx, attemptId: claim.attempt.id, phase: "claimed" });
        }
      }
      if (record.activeAttempt && record.activeAttempt.id !== ctx.attemptId)
        fail("PRESENTATION_PENDING");
      if (!outcome) {
        // An uncertain external claim or a previously committed submission may never be replaced.
        if (
          record.activeAttempt?.state === "unknown" ||
          record.delivery.messageRef ||
          ctx.outboundId ||
          ctx.phase === "submitted" ||
          ctx.phase === "settled"
        )
          fail("PRESENTATION_UNKNOWN");
        const submission = {
          version: 1,
          batchId: task.batchId,
          taskId: task.taskId,
          claim: task.claim,
          actionKey: ctx.actionKey,
          purpose: "presentation",
          payload: { kind: "app", spaceId, url: viewUrl, live: true },
          presentation: {
            cardId: ctx.cardId,
            taskId: task.taskId,
            viewUrl,
            claimId: ctx.attemptId,
          },
        };
        check();
        const result = await control("enqueue", submission);
        const items = Array.isArray(result) ? result : result.items;
        if (!Array.isArray(items) || items.length !== 1 || !items[0]?.id)
          fail("OUTBOUND_STATUS_INVALID");
        outcome = items[0];
        ctx = save({ ...ctx, outboundId: outcome.id, phase: "submitted" });
      } else if (!ctx.outboundId)
        ctx = save({ ...ctx, outboundId: outcome.id, phase: "submitted" });
      if (ctx.outboundId !== outcome.id) fail("OUTBOUND_STATUS_INVALID");
      const deadline = Date.now() + (opts.sendTimeoutMs ?? 90000);
      while (
        ["queued", "sending", "retry_wait"].includes(outcome.state) &&
        Date.now() < deadline
      ) {
        await new Promise((resolveWait) =>
          setTimeout(resolveWait, opts.pollMs ?? 250),
        );
        check();
        outcome = await status(ctx);
        if (!outcome || outcome.id !== ctx.outboundId)
          fail("OUTBOUND_STATUS_INVALID");
      }
      if (outcome.state !== "accepted" || !outcome.reference?.messageId) {
        // Keep the same host claim occupied. A later exact operator reconciliation may settle it.
        check();
        try {
          verifyRecord(
            ctx,
            await client.settlePresentation(ctx.cardId, {
              attemptId: ctx.attemptId,
              outcome: "unknown",
              note: "Canonical outbox outcome needs reconciliation.",
            }),
          );
        } catch {
          /* Claim remains held on host/response loss. */
        }
        fail("PRESENTATION_UNKNOWN");
      }
      const messageId = outcome.reference.messageId;
      if (
        record.delivery.messageRef &&
        record.delivery.messageRef !== messageId
      )
        fail("PRESENTATION_EVIDENCE_CONFLICT");
      ctx = save({
        ...ctx,
        settlement: {
          attemptId: ctx.attemptId,
          outcome: "accepted",
          messageRef: messageId,
        },
        phase: "settle_intent",
      });
      check();
      record = verifyRecord(
        ctx,
        await client.settlePresentation(ctx.cardId, ctx.settlement),
      );
      ctx = save({
        ...ctx,
        revision: record.revision,
        spectrumMessageId: messageId,
        spectrumSendCount: 1,
        phase: "settled",
      });
      return { record, context: ctx, messageId, outboundId: ctx.outboundId };
    });
  }
  async function updateMilestone(cardId, updateBody, taskKey) {
    return scoped(taskKey, async ({ required, save, check, path }) => {
      const ctx = required();
      if (
        cardId !== ctx.cardId ||
        !Number.isSafeInteger(updateBody.expectedRevision)
      )
        fail("CONTEXT_MISMATCH");
      identifier(updateBody.requestId);
      if (Buffer.byteLength(serialize(updateBody)) > LIMIT)
        fail("UPDATE_INPUT_TOO_LARGE");
      const journalPath = `${path}.update.json`;
      const journal = existsSync(journalPath)
        ? JSON.parse(
            readFileSync(assertPrivateFile(journalPath, paths.root), "utf8"),
          )
        : null;
      if (
        journal &&
        !journal.done &&
        serialize(journal.body) !== serialize(updateBody)
      )
        fail("UPDATE_RECONCILIATION_REQUIRED");
      if (
        journal?.body.requestId === updateBody.requestId &&
        serialize(journal.body) !== serialize(updateBody)
      )
        fail("IDEMPOTENCY_CONFLICT");
      // Reject stale workers before they can leave an unsent journal blocking a successor.
      await control("task-context", {
        taskId: task.taskId,
        batchId: task.batchId,
        claim: task.claim,
      });
      // Journal separately: changed URL/conflict cannot overwrite the prior card context.
      check();
      atomicPrivateWrite(
        journalPath,
        JSON.stringify({ body: updateBody, done: false }),
      );
      check();
      let record;
      try {
        record = verifyRecord(ctx, await client.update(cardId, updateBody));
      } catch (error) {
        if (
          ["REVISION_CONFLICT", "IDEMPOTENCY_CONFLICT"].includes(error.code)
        ) {
          check();
          atomicPrivateWrite(
            journalPath,
            JSON.stringify({
              body: updateBody,
              done: true,
              rejected: error.code,
            }),
          );
        }
        throw error;
      }
      save({
        ...ctx,
        revision: record.revision,
        lastMilestoneRequestId: updateBody.requestId,
      });
      check();
      atomicPrivateWrite(
        journalPath,
        JSON.stringify({ body: updateBody, done: true }),
      );
      return { record };
    });
  }
  async function completeAndRelease(cardId, taskKey, terminalUpdate) {
    if (terminalUpdate) await updateMilestone(cardId, terminalUpdate, taskKey);
    return scoped(taskKey, async ({ required, save, check }) => {
      const ctx = required();
      if (cardId !== ctx.cardId) fail("CONTEXT_MISMATCH");
      let record = verifyRecord(ctx, await client.get(cardId));
      const outcome = await status(ctx);
      if (
        !ctx.spectrumMessageId ||
        outcome?.state !== "accepted" ||
        outcome.reference?.messageId !== ctx.spectrumMessageId ||
        record.delivery.messageRef !== ctx.spectrumMessageId ||
        record.activeAttempt
      )
        fail("INITIAL_SEND_NOT_RECONCILED");
      if (!terminal.has(record.content.status)) fail("TASK_NOT_FINISHED");
      if (!record.archivedAt) {
        check();
        record = verifyRecord(
          ctx,
          await client.release(cardId, record.revision),
        );
      }
      return {
        record,
        context: save({
          ...ctx,
          revision: record.revision,
          archivedAt: record.archivedAt,
          released: true,
        }),
      };
    });
  }
  return {
    createCard,
    sendOnce,
    updateMilestone,
    completeAndRelease,
    loadContext: (taskKey) => scoped(taskKey, ({ load }) => load()),
    doctor: () => client.doctor(),
    slots: () => client.slots(),
  };
}
