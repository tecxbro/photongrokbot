import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { fixture, record, batch } from "./fixture.ts";
import { openStore } from "../../storage.ts";
import { assertPatchedSQLite } from "../../db.ts";
const fixtures: ReturnType<typeof fixture>[] = [];
const setup = (options = {}) => {
  const f = fixture(options);
  fixtures.push(f);
  return f;
};
afterEach(() => {
  for (const f of fixtures.splice(0)) f.cleanup();
});
describe("transactional store", () => {
  test("ordinary open cannot create storage; identity is immutable", () => {
    const f = setup();
    expect(() =>
      openStore({
        paths: {
          ...f.paths,
          databasePath: join(f.paths.dataDir, "absent.sqlite"),
        },
      }),
    ).toThrow("STORE_NOT_INITIALIZED");
    expect(existsSync(join(f.paths.dataDir, "absent.sqlite"))).toBe(false);
    writeFileSync(
      f.paths.configPath,
      JSON.stringify({ installationId: "different-installation" }),
    );
    expect(() => openStore({ paths: f.paths })).toThrow("INSTANCE_ID_MISMATCH");
  });
  test("patched SQLite floor and FULL/local WAL evidence", () => {
    const f = setup();
    expect(f.store.evidence.journal).toBe("wal");
    expect(() =>
      assertPatchedSQLite("3.51.2", f.store.evidence.source),
    ).toThrow();
    expect(() =>
      assertPatchedSQLite("3.51.3", f.store.evidence.source),
    ).not.toThrow();
    expect(f.store.db.query("PRAGMA synchronous").get()).toEqual({
      synchronous: 2,
    });
  });
  test("corrupt database is rejected without overwriting", () => {
    const f = setup();
    const p = join(f.paths.dataDir, "corrupt.sqlite");
    writeFileSync(p, "not sqlite");
    expect(() =>
      openStore({ paths: { ...f.paths, databasePath: p }, create: true }),
    ).toThrow();
    expect(readFileSync(p, "utf8")).toBe("not sqlite");
  });
  test("input duplicate and first greeting onboarding one atomic intent", () => {
    const f = setup();
    const input = {
      eventKey: "provider-key",
      record: record(),
      destination: { spaceId: "space-1", lineId: "line-1" },
      onboarding: true,
      greetingOnly: true,
    };
    expect(f.store.accept(input).onboardingCreated).toBe(true);
    expect(f.store.accept(input).duplicate).toBe(true);
    expect(f.store.formBatches()).toHaveLength(0);
    expect(f.store.listOutbound()).toHaveLength(1);
    const later = { ...input, eventKey: "second-key", record: record("msg-2") };
    expect(f.store.accept(later).onboardingCreated).toBe(false);
    expect(f.store.formBatches()).toHaveLength(1);
  });
  test("substantive first input is batched and onboarding commits together", () => {
    const f = setup();
    f.store.accept({
      eventKey: "key",
      record: record(),
      destination: { spaceId: "space-1", lineId: "line-1" },
      onboarding: true,
    });
    expect(f.store.formBatches()[0]?.messages[0]?.id).toBe("msg-1");
    expect(f.store.listOutbound()).toHaveLength(1);
  });
  test("failure anywhere during acceptance rolls back input and greeting", () => {
    let fail = true;
    const f = setup({
      fault: (p: string) => {
        if (fail && p === "accept:before_commit") throw new Error("injected");
      },
    });
    expect(() =>
      f.store.accept({
        eventKey: "key",
        record: record(),
        destination: { spaceId: "space-1", lineId: "line-1" },
        onboarding: true,
      }),
    ).toThrow();
    expect(f.store.listOutbound()).toHaveLength(0);
    expect(f.store.recentInbound()).toHaveLength(0);
    fail = false;
    expect(
      f.store.accept({
        eventKey: "key",
        record: record(),
        destination: { spaceId: "space-1", lineId: "line-1" },
        onboarding: true,
      }).duplicate,
    ).toBe(false);
  });
  test("conversation and line batch boundaries; missing/path traversal rejected", () => {
    const f = setup();
    for (const lineId of ["a", "b"])
      f.store.accept({
        eventKey: lineId,
        record: record(lineId),
        destination: { spaceId: "space-1", lineId },
      });
    expect(f.store.formBatches()).toHaveLength(2);
    expect(() => f.store.readBatch("../secret")).toThrow("INVALID_BATCH_ID");
    expect(() => f.store.readBatch("not-found")).toThrow("BATCH_NOT_FOUND");
  });
  test("wake acknowledgement retains work; active claim prevents additional wakes", () => {
    const f = setup();
    f.store.accept({
      eventKey: "key",
      record: record(),
      destination: { spaceId: "space-1", lineId: "line-1" },
    });
    const b = f.store.formBatches()[0]!;
    const wake = f.store.claimWake()!;
    f.store.settleWake(wake, { state: "acknowledged" });
    expect(f.store.readBatch(b.batchId).messages).toHaveLength(1);
    expect(f.store.claimSnapshot(b.batchId).state).toBe("pending");
    expect(f.store.claimWake()).toBeUndefined();
    expect(f.store.claimBatch(b.batchId).status).toBe("acquired");
  });
  test("same bot is never same run; stale owner cannot renew/complete/enqueue", async () => {
    const f = setup();
    const { batch: b, claim } = batch(f.store);
    expect(f.store.claimBatch(b.batchId).status).toBe("busy");
    f.store.db
      .query("UPDATE batches SET lease_until=0 WHERE id=?")
      .run(b.batchId);
    const acquired = f.store.claimBatch(b.batchId);
    expect(acquired.status).toBe("acquired");
    if (acquired.status !== "acquired") return;
    expect(acquired.token.generation).toBe(claim.generation + 1);
    expect(() => f.store.renewClaim(claim)).toThrow("STALE_CLAIM");
    expect(() => f.store.completeClaim(claim)).toThrow("STALE_CLAIM");
    expect(() =>
      f.store.enqueue(
        { spaceId: "space-1", text: "oops" },
        {
          actionKey: "x",
          destination: { spaceId: "space-1", lineId: "line-1" },
          purpose: "final",
          claim,
        },
      ),
    ).toThrow("STALE_CLAIM");
  });
  test("same action same payload ids; conflicting payload rejected", () => {
    const f = setup();
    const ctx = { ...batch(f.store), actionKey: "a", purpose: "final" };
    const first = f.store.enqueue(
      { spaceId: "space-1", text: "First\n\nSecond" },
      ctx,
    );
    expect(first).toHaveLength(2);
    expect(
      f.store
        .enqueue({ spaceId: "space-1", text: "First\n\nSecond" }, ctx)
        .map((x) => x.id),
    ).toEqual(first.map((x) => x.id));
    expect(() =>
      f.store.enqueue({ spaceId: "space-1", text: "Changed" }, ctx),
    ).toThrow("ACTION_PAYLOAD_CONFLICT");
    expect(f.store.listOutbound()).toHaveLength(2);
  });
  test("all child bubbles roll back on injected child insertion failure", () => {
    let fail = false;
    const f = setup({
      fault: (p: string) => {
        if (fail && p === "enqueue:child") throw new Error("child");
      },
    });
    const ctx = { ...batch(f.store), actionKey: "a", purpose: "final" };
    fail = true;
    expect(() =>
      f.store.enqueue({ spaceId: "space-1", text: "One\n\nTwo" }, ctx),
    ).toThrow();
    expect(f.store.listOutbound()).toHaveLength(0);
    expect(f.store.db.query("SELECT count(*) n FROM operations").get()).toEqual(
      { n: 0 },
    );
  });
  test("unknown blocks later conversation content but permits cleanup and other chat", () => {
    const f = setup();
    const ctx = { ...batch(f.store), actionKey: "a", purpose: "final" };
    f.store.enqueue({ spaceId: "space-1", text: "One\n\nTwo" }, ctx);
    const send = f.store.claimOutbound()!;
    f.store.settleOutbound(send.item.id, send.attemptId, {
      state: "unknown",
      code: "TIMEOUT",
    });
    expect(f.store.claimOutbound()).toBeUndefined();
    f.store.enqueue(
      { kind: "typing", spaceId: "space-1", state: "stop" },
      { ...ctx, actionKey: "cleanup", purpose: "control" },
    );
    expect(f.store.claimOutbound()?.item.kind).toBe("typing");
    const other = {
      ...batch(f.store, "space-2"),
      actionKey: "b",
      purpose: "final",
    };
    f.store.enqueue({ spaceId: "space-2", text: "Other" }, other);
    expect(f.store.claimOutbound()?.destination.spaceId).toBe("space-2");
  });
  test("sending recovery never fresh sends and old attempt cannot settle", () => {
    const f = setup();
    const ctx = { ...batch(f.store), actionKey: "a", purpose: "final" };
    const [item] = f.store.enqueue({ spaceId: "space-1", text: "One" }, ctx);
    const send = f.store.claimOutbound()!;
    expect(f.store.recoverSending()).toBe(1);
    expect(f.store.outboundStatus(item!.id)?.state).toBe("unknown");
    expect(f.store.claimOutbound()).toBeUndefined();
    expect(() =>
      f.store.settleOutbound(item!.id, send.attemptId, {
        state: "accepted",
        evidence: "late",
      }),
    ).toThrow("STALE_OUTBOUND_ATTEMPT");
  });
  test("provider reference/poll/session/mapping settlement commits atomically", () => {
    const f = setup();
    const ctx = { ...batch(f.store), actionKey: "poll", purpose: "final" };
    f.store.enqueue(
      { kind: "poll", spaceId: "space-1", title: "Pick", options: ["A", "B"] },
      ctx,
    );
    const send = f.store.claimOutbound()!;
    f.store.settleOutbound(send.item.id, send.attemptId, {
      state: "accepted",
      evidence: "resolved",
      reference: { messageId: "provider-poll" },
    });
    expect(f.store.getMetadata("poll", "provider-poll")).toMatchObject({
      title: "Pick",
      options: ["A", "B"],
    });
    expect(f.store.knownTarget(ctx.destination, "provider-poll")).toBe(true);
    expect(
      f.store.knownTarget(
        { ...ctx.destination, lineId: "other" },
        "provider-poll",
      ),
    ).toBe(false);
  });
  test("unknown native handoff reserves work and cannot create second task", () => {
    const f = setup();
    const ctx = batch(f.store);
    const binding = {
      taskId: "task-1",
      batchId: ctx.batch.batchId,
      destination: ctx.destination,
      owner: "specialist",
      finalOwner: "front-door",
      state: "intent" as const,
    };
    f.store.bindTask(ctx.claim, binding);
    f.store.recoverWork();
    expect(f.store.getTask("task-1")?.state).toBe("unknown");
    expect(f.store.claimBatch(ctx.batch.batchId).status).toBe("busy");
    expect(() =>
      f.store.bindTask(ctx.claim, { ...binding, taskId: "task-2" }),
    ).toThrow("HANDOFF_ALREADY_RESERVED");
    expect(() => f.store.completeClaim(ctx.claim)).toThrow("TASK_UNRESOLVED");
  });
  test("media remains same event/batch and stale completion is fenced", () => {
    const f = setup();
    f.store.accept({
      eventKey: "audio",
      record: { ...record(), kind: "voice" },
      destination: { spaceId: "space-1", lineId: "line-1" },
      media: {
        kind: "voice",
        spaceId: "space-1",
        lineId: "line-1",
        messageId: "msg-1",
      },
    });
    const b = f.store.formBatches()[0]!;
    const first = f.store.claimMedia()!;
    f.store.recoverWork();
    const second = f.store.claimMedia()!;
    expect(() =>
      f.store.settleMedia(
        first.id,
        { state: "ready", patch: { transcript: "stale" } },
        first.attempts,
      ),
    ).toThrow();
    f.store.settleMedia(
      second.id,
      {
        state: "failed",
        code: "STT_FAILED",
        patch: { attachmentPath: "/private/audio.m4a" },
      },
      second.attempts,
    );
    expect(f.store.readBatch(b.batchId).messages[0]?.attachmentPath).toBe(
      "/private/audio.m4a",
    );
    expect(f.store.formBatches()).toHaveLength(0);
  });
  test("retention preserves unresolved/active records; prunes resolved bodies only", () => {
    const f = setup();
    const ctx = { ...batch(f.store), actionKey: "a", purpose: "final" };
    const [item] = f.store.enqueue(
      { spaceId: "space-1", text: "secret body" },
      ctx,
    );
    expect(
      f.store.pruneResolvedBefore({
        resolvedBefore: Date.now() + 1000,
        intermediateBefore: Date.now(),
        apply: true,
      }).events,
    ).toBe(0);
    const c = f.store.claimOutbound()!;
    f.store.settleOutbound(item!.id, c.attemptId, {
      state: "accepted",
      evidence: "resolved",
    });
    f.store.completeClaim(ctx.claim);
    expect(
      f.store.pruneResolvedBefore({
        resolvedBefore: Date.now() + 1000,
        intermediateBefore: Date.now(),
        apply: true,
      }),
    ).toMatchObject({ events: 1, outbound: 1 });
    expect(f.store.listOutbound()[0]).toMatchObject({
      text: "[content removed]",
    });
    expect(f.store.outboundStatus(item!.id)?.state).toBe("accepted");
    expect(f.store.enqueue.bind(f.store)).toBeDefined();
  });
  test("backup includes committed WAL content and read diagnostics bounded", () => {
    const f = setup();
    batch(f.store);
    const backup = join(f.paths.backupsDir, "export.sqlite");
    f.store.backupTo(backup);
    expect(readFileSync(backup).byteLength).toBeGreaterThan(1000);
    expect(() => f.store.backupTo(backup)).toThrow();
    expect(() => f.store.recentInbound(10001)).toThrow("LIMIT_INVALID");
  });
});
test("read-only inspection refuses bad modes without repairs or content writes", () => {
  const f = setup();
  const reader = openStore({ paths: f.paths, readOnly: true });
  expect(reader.sqliteFacts().filesystemVerified).toBe(true);
  expect(reader.privacySnapshot().events).toBe(0);
  expect(() =>
    reader.accept({
      eventKey: "x",
      record: record(),
      destination: { spaceId: "space-1", lineId: "line-1" },
    }),
  ).toThrow();
  reader.close();
  chmodSync(f.paths.databasePath, 0o644);
  expect(() => openStore({ paths: f.paths })).toThrow(
    "PRIVATE_FILE_PERMISSIONS",
  );
  chmodSync(f.paths.databasePath, 0o600);
});
test("unused intermediate cleanup survives process loss between redaction and unlink", () => {
  const f = setup();
  f.store.setMetadata("intermediate-artifact", "unused-1", {
    path: "/private/unreferenced.tmp",
    createdAt: 1,
    state: "unused",
  });
  const plan = f.store.pruneResolvedBefore({
    resolvedBefore: 2,
    intermediateBefore: 2,
    apply: true,
  });
  expect(plan.artifactPaths).toEqual(["/private/unreferenced.tmp"]);
  expect(
    f.store.pruneResolvedBefore({ resolvedBefore: 2, intermediateBefore: 2 })
      .artifactPaths,
  ).toEqual(plan.artifactPaths);
  f.store.acknowledgePrunedArtifacts(plan.artifactPaths);
  expect(
    f.store.pruneResolvedBefore({ resolvedBefore: 2, intermediateBefore: 2 })
      .artifactPaths,
  ).toEqual([]);
});
test("acknowledged wake can be retried for unclaimed work after the handoff grace period", () => {
  const f = setup();
  f.store.accept({
    eventKey: "e",
    record: record(),
    destination: { spaceId: "space-1", lineId: "line-1" },
  });
  f.store.formBatches();
  const first = f.store.claimWake()!;
  f.store.settleWake(first, { state: "acknowledged" });
  expect(f.store.claimWake()).toBeUndefined();
  expect(f.store.claimWake(Date.now() + 61000)?.batchId).toBe(first.batchId);
});
test("progress completion preserves typing until final completion or lease expiry", () => {
  const f = setup();
  const ctx = batch(f.store);
  f.store.enqueue(
    { spaceId: "space-1", text: "Working" },
    { ...ctx, purpose: "progress", actionKey: "p" },
  );
  const send = f.store.claimOutbound()!;
  f.store.settleOutbound(send.item.id, send.attemptId, {
    state: "accepted",
    evidence: "fixture",
  });
  expect(f.store.activeConversationWork()).toEqual([ctx.destination]);
  f.store.db
    .query("UPDATE batches SET lease_until=0 WHERE id=?")
    .run(ctx.batch.batchId);
  expect(f.store.activeConversationWork()).toHaveLength(0);
});
test("bounded control input rejects oversized stream before EOF", async () => {
  const { boundedStdin } = await import("../../batch-control.ts");
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(65537));
    },
    cancel() {
      cancelled = true;
    },
  });
  await expect(boundedStdin(stream)).rejects.toThrow("INPUT_TOO_LARGE");
  expect(cancelled).toBe(true);
});
test("D07 eligible operation reads use indexed outbox after retained history", () => {
  const f = setup();
  const rows = f.store.db
    .query(
      "EXPLAIN QUERY PLAN SELECT id FROM outbound WHERE state IN ('queued','retry_wait') AND next_at<=? ORDER BY seq LIMIT 1",
    )
    .all(Date.now()) as any[];
  expect(rows.some((row) => row.detail.includes("outbound_eligible"))).toBe(
    true,
  );
});
test("offline evidence resolution never retries uncertain operation and requires provider reference", () => {
  const f = setup();
  const ctx = batch(f.store);
  const items = f.store.enqueue(
    { spaceId: "space-1", text: "first\n\nsecond" },
    { ...ctx, purpose: "final", actionKey: "resolve" },
  );
  const first = f.store.claimOutbound()!;
  f.store.settleOutbound(first.item.id, first.attemptId, {
    state: "unknown",
    code: "TIMEOUT",
  });
  expect(() =>
    f.store.reconcileOutbound(first.item.id, {
      state: "accepted",
      evidence: "operator inspected provider",
    }),
  ).toThrow("EXACT_PROVIDER_REFERENCE_REQUIRED");
  const resolved = f.store.reconcileOutbound(first.item.id, {
    state: "accepted",
    evidence: "operator inspected exact provider receipt",
    reference: { messageId: "provider-exact" },
  });
  expect(resolved.state).toBe("accepted");
  expect(resolved.attempts).toBe(1);
  expect(f.store.claimOutbound()?.item.id).toBe(items[1]!.id);
  expect(() =>
    f.store.reconcileOutbound(first.item.id, {
      state: "cancelled",
      evidence: "abandonment after review",
    }),
  ).toThrow("UNKNOWN_OUTBOUND_REQUIRED");
  expect(
    f.store.operationStatus(ctx.destination, "final", "resolve"),
  ).toHaveLength(2);
});
test("expired unknown native task can only resume original binding from explicit receipt", () => {
  const f = setup();
  const ctx = batch(f.store);
  const binding = {
    taskId: "recover-task",
    batchId: ctx.batch.batchId,
    destination: ctx.destination,
    owner: "worker",
    finalOwner: "front-door",
    state: "intent" as const,
  };
  f.store.bindTask(ctx.claim, binding);
  f.store.recoverWork();
  f.store.db
    .query("UPDATE batches SET lease_until=0 WHERE id=?")
    .run(ctx.batch.batchId);
  const recovered = f.store.reconcileTask(binding.taskId, {
    state: "accepted",
    receipt: "native tool exact task receipt",
  });
  expect(recovered.taskId).toBe(binding.taskId);
  expect((f.store.readBatch(ctx.batch.batchId) as any).tasks[0].state).toBe(
    "accepted",
  );
  const acquired = f.store.claimBatch(ctx.batch.batchId);
  expect(acquired.status).toBe("acquired");
  expect(() => f.store.renewClaim(ctx.claim)).toThrow("STALE_CLAIM");
  if (acquired.status === "acquired")
    expect(() =>
      f.store.bindTask(acquired.token, {
        ...binding,
        taskId: "replacement-task",
      }),
    ).toThrow("HANDOFF_ALREADY_RESERVED");
});
