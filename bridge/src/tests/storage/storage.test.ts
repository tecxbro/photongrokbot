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
test("independently due conversations flush only their own exact space and line", () => {
  const f = setup();
  const first = { spaceId: "first-space", lineId: "line-1" };
  const second = { spaceId: "second-space", lineId: "line-1" };
  const otherLine = { spaceId: "first-space", lineId: "line-2" };
  for (const [i, destination] of [first, second, otherLine].entries())
    f.store.accept({
      eventKey: `due-${i}`,
      record: record(`due-message-${i}`, destination.spaceId),
      destination,
    });
  const firstDeadline = Date.now();
  const secondDeadline = firstDeadline + 2000;
  const flushed = f.store.formBatches(firstDeadline, [first, first]);
  expect(flushed).toHaveLength(1);
  expect(flushed[0]?.messages.map((message) => message.id)).toEqual([
    "due-message-0",
  ]);
  expect(flushed[0]?.flushedAt).toBe(new Date(firstDeadline).toISOString());
  expect(
    f.store.db.query("SELECT count(*) n FROM inbox WHERE pending=1").get(),
  ).toEqual({ n: 2 });
  expect(f.store.formBatches(firstDeadline, [])).toHaveLength(0);
  expect(
    f.store.formBatches(firstDeadline, [
      first,
      { spaceId: "absent", lineId: "line-1" },
    ]),
  ).toHaveLength(0);
  expect(f.store.db.query("SELECT count(*) n FROM batches").get()).toEqual({
    n: 1,
  });
  const later = f.store.formBatches(secondDeadline, [second]);
  expect(later).toHaveLength(1);
  expect(later[0]?.messages[0]?.id).toBe("due-message-1");
  expect(later[0]?.flushedAt).toBe(new Date(secondDeadline).toISOString());
  const recovered = f.store.formBatches();
  expect(recovered).toHaveLength(1);
  expect(f.store.batchDestination(recovered[0]!.batchId)).toEqual(otherLine);
});
test("destination validation rejects entire flush before pending membership can change", () => {
  const f = setup();
  const destination = { spaceId: "space-1", lineId: "line-1" };
  f.store.accept({ eventKey: "validation", record: record(), destination });
  expect(() =>
    f.store.formBatches(Date.now(), [
      destination,
      { spaceId: "", lineId: "line-1" },
    ]),
  ).toThrow("DESTINATION_INVALID");
  expect(() => f.store.formBatches(Number.NaN, [destination])).toThrow(
    "BATCH_TIME_INVALID",
  );
  expect(
    f.store.db.query("SELECT count(*) n FROM inbox WHERE pending=1").get(),
  ).toEqual({ n: 1 });
  expect(f.store.db.query("SELECT count(*) n FROM batches").get()).toEqual({
    n: 0,
  });
  const plan = f.store.db
    .query(
      "EXPLAIN QUERY PLAN SELECT id FROM inbox WHERE pending=1 AND space_id=? AND line_id=? ORDER BY seq LIMIT 250",
    )
    .all(destination.spaceId, destination.lineId) as any[];
  expect(plan.some((row) => row.detail.includes("inbox_pending"))).toBe(true);
});
test("presentation identity is committed with outbox and never changed by idempotent replay", () => {
  const f = setup();
  const ctx = presentationFixture(f);
  f.store.registerPresentation(ctx.claim, ctx.context);
  const input = {
    kind: "app" as const,
    spaceId: ctx.destination.spaceId,
    url: ctx.context.viewUrl,
    live: true,
  };
  const presentation = {
    cardId: "card-1",
    taskId: ctx.context.taskId,
    viewUrl: input.url,
    claimId: "host-claim-1",
  };
  const context = {
    ...ctx,
    purpose: "presentation",
    actionKey: "live-first",
    presentation,
  };
  const first = f.store.enqueue(input, context);
  const expected = {
    ...presentation,
    batchId: ctx.claim.batchId,
    actionKey: context.actionKey,
    destination: ctx.destination,
    outboundId: first[0]!.id,
  };
  expect(
    f.store.getMetadata<typeof expected>(
      "presentation-submission",
      first[0]!.id,
    ),
  ).toEqual(expected);
  expect(f.store.enqueue(input, context).map((row) => row.id)).toEqual(
    first.map((row) => row.id),
  );
  for (const patch of [
    { cardId: "different" },
    { taskId: "different" },
    { claimId: "different" },
    { viewUrl: "https://example.test/changed" },
  ])
    expect(() =>
      f.store.enqueue(input, {
        ...context,
        presentation: { ...presentation, ...patch },
      }),
    ).toThrow();
  expect(() =>
    f.store.enqueue(input, { ...context, presentation: undefined }),
  ).toThrow("PRESENTATION_IDENTITY_CONFLICT");
  expect(
    f.store.getMetadata<typeof expected>(
      "presentation-submission",
      first[0]!.id,
    ),
  ).toEqual(expected);
  expect(f.store.listOutbound()).toHaveLength(1);
  const staticContext = {
    ...ctx,
    purpose: "presentation",
    actionKey: "static-first",
  };
  f.store.enqueue(input, staticContext);
  expect(() =>
    f.store.enqueue(input, { ...staticContext, presentation }),
  ).toThrow("TASK_CARD_OPERATION_CONFLICT");
  const send = f.store.claimOutbound()!;
  f.store.settleOutbound(send.item.id, send.attemptId, {
    state: "unknown",
    code: "fixture-uncertain",
  });
  expect(
    f.store.getMetadata("presentation-settlement", send.item.id),
  ).toMatchObject({ ...expected, deliveryState: "unknown", state: "pending" });
});
test("presentation context must match canonical payload and task binding", () => {
  const f = setup();
  const ctx = batch(f.store);
  const presentation = {
    cardId: "card",
    taskId: "task",
    claimId: "claim",
    viewUrl: "https://example.test/card",
  };
  expect(() =>
    f.store.enqueue(
      { spaceId: ctx.destination.spaceId, text: "unrelated" },
      { ...ctx, purpose: "presentation", actionKey: "bad-kind", presentation },
    ),
  ).toThrow("PRESENTATION_CONTEXT_INVALID");
  expect(() =>
    f.store.enqueue(
      {
        kind: "app",
        spaceId: ctx.destination.spaceId,
        url: presentation.viewUrl,
      },
      {
        ...ctx,
        purpose: "presentation",
        actionKey: "bad-task",
        taskId: "other-task",
        presentation,
      },
    ),
  ).toThrow("PRESENTATION_CONTEXT_INVALID");
  expect(f.store.listOutbound()).toHaveLength(0);
  expect(f.store.listMetadata("presentation-submission")).toHaveLength(0);
});
test("expired processing lease re-wakes the original batch and fences its abandoned run", () => {
  const f = setup();
  const ctx = batch(f.store);
  const deadline = f.store.claimSnapshot(ctx.batch.batchId).leaseUntil!;
  expect(f.store.claimWake(deadline - 1)).toBeUndefined();
  expect(f.store.claimSnapshot(ctx.batch.batchId).state).toBe("claimed");
  const wake = f.store.claimWake(deadline)!;
  expect(wake.batchId).toBe(ctx.batch.batchId);
  expect(f.store.readBatch(wake.batchId).messages[0]?.id).toBe(
    ctx.batch.messages[0]?.id,
  );
  expect(f.store.claimSnapshot(wake.batchId)).toMatchObject({
    state: "pending",
    runId: null,
    generation: ctx.claim.generation + 1,
  });
  expect(() => f.store.renewClaim(ctx.claim)).toThrow("STALE_CLAIM");
  expect(() => f.store.completeClaim(ctx.claim)).toThrow("STALE_CLAIM");
  expect(() =>
    f.store.enqueue(
      { spaceId: ctx.destination.spaceId, text: "abandoned result" },
      { ...ctx, purpose: "final", actionKey: "abandoned" },
    ),
  ).toThrow("STALE_CLAIM");
  const acquired = f.store.claimBatch(wake.batchId, 3_600_000);
  expect(acquired.status).toBe("acquired");
  if (acquired.status === "acquired")
    expect(acquired.token.generation).toBeGreaterThan(ctx.claim.generation);
  expect(f.store.db.query("SELECT count(*) n FROM batches").get()).toEqual({
    n: 1,
  });
  expect(f.store.claimWake(deadline)).toBeUndefined();
});
for (const state of ["queued", "sending", "retry_wait", "unknown"] as const) {
  test(`expired claim with ${state} final remains held without re-notification`, () => {
    const f = setup();
    const ctx = batch(f.store);
    f.store.enqueue(
      { spaceId: ctx.destination.spaceId, text: "final" },
      { ...ctx, purpose: "final", actionKey: "final" },
    );
    if (state !== "queued") {
      const sent = f.store.claimOutbound()!;
      if (state === "retry_wait")
        f.store.settleOutbound(sent.item.id, sent.attemptId, {
          state: "retry_wait",
          code: "explicitly-not-applied",
          retryAfterMs: 1000,
        });
      else if (state === "unknown")
        f.store.settleOutbound(sent.item.id, sent.attemptId, {
          state: "unknown",
          code: "uncertain",
        });
    }
    expect(
      f.store.claimWake(
        f.store.claimSnapshot(ctx.batch.batchId).leaseUntil! + 1,
      ),
    ).toBeUndefined();
    expect(f.store.claimSnapshot(ctx.batch.batchId).state).toBe("claimed");
    expect(f.store.tasksForBatch(ctx.batch.batchId)).toHaveLength(0);
  });
}
for (const state of ["intent", "accepted", "unknown"] as const) {
  test(`expired claim with ${state} native handoff never creates another wake or task`, () => {
    const f = setup();
    const ctx = batch(f.store);
    const binding = {
      taskId: `task-${state}`,
      batchId: ctx.batch.batchId,
      destination: ctx.destination,
      owner: "worker",
      finalOwner: "front-door",
      state: "intent" as const,
    };
    f.store.bindTask(ctx.claim, binding);
    if (state !== "intent")
      f.store.bindTask(ctx.claim, {
        ...binding,
        state,
        receipt: "native exact receipt",
      });
    if (state === "accepted") {
      f.store.bindTask(ctx.claim, {
        ...binding,
        state: "completed",
        receipt: "native completion",
      });
    }
    // Reconciliation can legitimately return accepted work to a claimed batch.
    if (state === "accepted") {
      const second = {
        ...binding,
        taskId: "task-reconciled",
        state: "intent" as const,
      };
      f.store.bindTask(ctx.claim, second);
      f.store.bindTask(ctx.claim, { ...second, state: "unknown" });
      f.store.reconcileTask(second.taskId, {
        state: "accepted",
        receipt: "native exact recovered receipt",
      });
      expect(f.store.claimBatch(ctx.batch.batchId).status).toBe("acquired");
    }
    const before = f.store.tasksForBatch(ctx.batch.batchId);
    expect(
      f.store.claimWake(
        f.store.claimSnapshot(ctx.batch.batchId).leaseUntil! + 1,
      ),
    ).toBeUndefined();
    expect(f.store.tasksForBatch(ctx.batch.batchId)).toEqual(before);
    expect(f.store.claimSnapshot(ctx.batch.batchId).state).toBe(
      state === "accepted" ? "claimed" : "delegated",
    );
  });
}
function presentationFixture(f: ReturnType<typeof fixture>) {
  const ctx = batch(f.store);
  const task = {
    taskId: "presentation-task",
    batchId: ctx.batch.batchId,
    destination: ctx.destination,
    owner: "worker",
    finalOwner: "front-door",
    state: "intent" as const,
  };
  f.store.bindTask(ctx.claim, task);
  f.store.bindTask(ctx.claim, {
    ...task,
    state: "accepted",
    receipt: "native recorded receipt",
  });
  f.store.setMetadata("live-mini-host", "configured", {
    origin: "https://live.example.test",
  });
  return {
    ...ctx,
    context: {
      cardId: "card-1",
      taskId: task.taskId,
      batchId: ctx.batch.batchId,
      destination: ctx.destination,
      viewUrl: "https://live.example.test/live-10/card-1?k=private-view-token",
    },
  };
}
test("presentation registration binds exact original task and private full URL idempotently", () => {
  const f = setup();
  const ctx = presentationFixture(f);
  f.store.registerPresentation(ctx.claim, ctx.context);
  f.store.registerPresentation(ctx.claim, ctx.context);
  expect(
    f.store.getMetadata<typeof ctx.context>(
      "task-card-context",
      ctx.context.cardId,
    ),
  ).toEqual(ctx.context);
  expect(
    f.store.getMetadata<{ cardId: string }>(
      "task-card-url",
      ctx.context.viewUrl,
    ),
  ).toEqual({ cardId: ctx.context.cardId });
  expect(f.store.listMetadata("task-card-context")).toHaveLength(1);
  expect(f.store.listMetadata("task-card-url")).toHaveLength(1);
  expect(f.store.listOutbound()).toHaveLength(0);
  const changed = {
    ...ctx.context,
    viewUrl: "https://live.example.test/live-10/card-1?k=other-token",
  };
  expect(() => f.store.registerPresentation(ctx.claim, changed)).toThrow(
    "PRESENTATION_IDENTITY_CONFLICT",
  );
  expect(f.store.getMetadata("task-card-url", changed.viewUrl)).toBeUndefined();
  expect(
    f.store.getMetadata<typeof ctx.context>(
      "task-card-context",
      ctx.context.cardId,
    ),
  ).toEqual(ctx.context);
});
test("presentation registration rejects other task, conversation, batch and expired invocation", () => {
  const f = setup();
  const ctx = presentationFixture(f);
  expect(() =>
    f.store.registerPresentation(ctx.claim, {
      ...ctx.context,
      taskId: "missing-task",
    }),
  ).toThrow("PRESENTATION_TASK_MISMATCH");
  expect(() =>
    f.store.registerPresentation(ctx.claim, {
      ...ctx.context,
      batchId: "other-batch",
    }),
  ).toThrow("PRESENTATION_BINDING_MISMATCH");
  expect(() =>
    f.store.registerPresentation(ctx.claim, {
      ...ctx.context,
      destination: { ...ctx.destination, spaceId: "other" },
    }),
  ).toThrow("PRESENTATION_BINDING_MISMATCH");
  const other = batch(f.store, "other-space");
  const binding = {
    taskId: "other-native-task",
    batchId: other.batch.batchId,
    destination: other.destination,
    owner: "worker",
    finalOwner: "front",
    state: "intent" as const,
  };
  f.store.bindTask(other.claim, binding);
  expect(() =>
    f.store.registerPresentation(ctx.claim, {
      ...ctx.context,
      taskId: binding.taskId,
    }),
  ).toThrow("PRESENTATION_TASK_MISMATCH");
  f.store.db
    .query("UPDATE batches SET lease_until=0 WHERE id=?")
    .run(ctx.batch.batchId);
  expect(() => f.store.registerPresentation(ctx.claim, ctx.context)).toThrow(
    "STALE_CLAIM",
  );
  expect(f.store.listMetadata("task-card-context")).toHaveLength(0);
  expect(f.store.listMetadata("task-card-url")).toHaveLength(0);
});
test("presentation URL must match configured HTTPS origin, host route and exact card ID", () => {
  const f = setup();
  const ctx = presentationFixture(f);
  for (const viewUrl of [
    "https://other.example.test/live-10/card-1?k=secret",
    "http://live.example.test/live-10/card-1?k=secret",
    "https://user:secret@live.example.test/live-10/card-1?k=secret",
    "https://live.example.test/live-11/card-1?k=secret",
    "https://live.example.test/live-10/other-card?k=secret",
    "https://live.example.test/live-10/card-1",
    "https://live.example.test/live-10/card-1?k=one&k=two",
    "https://live.example.test/live-10/card-1?k=secret#fragment",
    "https://live.example.test/live-10/card-1?k=secret&unrelated=true",
    " https://live.example.test/live-10/card-1?k=secret",
    "not a url",
  ])
    expect(() =>
      f.store.registerPresentation(ctx.claim, { ...ctx.context, viewUrl }),
    ).toThrow();
  expect(() =>
    f.store.registerPresentation(ctx.claim, {
      ...ctx.context,
      cardId: "../escape",
    }),
  ).toThrow("PRESENTATION_CONTEXT_INVALID");
  f.store.deleteMetadata("live-mini-host", "configured");
  expect(() => f.store.registerPresentation(ctx.claim, ctx.context)).toThrow(
    "PRESENTATION_HOST_MISMATCH",
  );
  expect(f.store.listMetadata("task-card-context")).toHaveLength(0);
});
test("presentation context and URL index roll back together on insertion failure", () => {
  let fail = false;
  const f = setup({
    fault: (transition: string) => {
      if (fail && transition === "register_presentation:context")
        throw new Error("fixture index failure");
    },
  });
  const ctx = presentationFixture(f);
  fail = true;
  expect(() => f.store.registerPresentation(ctx.claim, ctx.context)).toThrow(
    "fixture index failure",
  );
  expect(f.store.listMetadata("task-card-context")).toHaveLength(0);
  expect(f.store.listMetadata("task-card-url")).toHaveLength(0);
  fail = false;
  f.store.registerPresentation(ctx.claim, ctx.context);
  expect(
    f.store.getMetadata<{ cardId: string }>(
      "task-card-url",
      ctx.context.viewUrl,
    ),
  ).toEqual({ cardId: ctx.context.cardId });
});
test("wake exclusions hold only unresolved HTTP batches while unrelated chats continue", () => {
  const f = setup();
  for (const spaceId of ["first", "second"])
    f.store.accept({
      eventKey: spaceId,
      record: record(spaceId, spaceId),
      destination: { spaceId, lineId: "line-1" },
    });
  f.store.formBatches();
  const first = f.store.claimWake()!;
  f.store.settleWake(first, {
    state: "retry_wait",
    code: "http_still_pending",
    retryAfterMs: 0,
  });
  const second = f.store.claimWake(Date.now(), [first.batchId])!;
  expect(second.batchId).not.toBe(first.batchId);
  expect(f.store.claimWake(Date.now(), [first.batchId])).toBeUndefined();
  const held = f.store.db
    .query("SELECT state,attempts FROM wakes WHERE batch_id=?")
    .get(first.batchId);
  expect(held).toEqual({ state: "retry_wait", attempts: 1 });
  const released = f.store.claimWake(Date.now(), []);
  expect(released?.batchId).toBe(first.batchId);
  expect(released?.attempts).toBe(2);
});
test("wake exclusion IDs and bounded list validate before any durable claim", () => {
  const f = setup();
  f.store.accept({
    eventKey: "pending",
    record: record(),
    destination: { spaceId: "space-1", lineId: "line-1" },
  });
  const batch = f.store.formBatches()[0]!;
  expect(() =>
    f.store.claimWake(Date.now(), Array(33).fill(batch.batchId)),
  ).toThrow("WAKE_EXCLUSIONS_INVALID");
  expect(() =>
    f.store.claimWake(Date.now(), [batch.batchId, "../escape"]),
  ).toThrow("INVALID_BATCH_ID");
  expect(
    f.store.db
      .query("SELECT state,attempts FROM wakes WHERE batch_id=?")
      .get(batch.batchId),
  ).toEqual({ state: "pending", attempts: 0 });
  expect(
    f.store.claimWake(Date.now(), [batch.batchId, batch.batchId]),
  ).toBeUndefined();
  expect(f.store.claimWake()?.batchId).toBe(batch.batchId);
});

test("metadata pagination advances beyond blocked first page without skipping keys", () => {
  const f = setup();
  for (const key of ["c", "a", "b", "d"])
    f.store.setMetadata("pending", key, { key });
  f.store.setMetadata("unrelated", "aa", true);
  expect(f.store.listMetadata("pending", 2).map((entry) => entry.key)).toEqual([
    "a",
    "b",
  ]);
  expect(
    f.store.listMetadata("pending", 2, "b").map((entry) => entry.key),
  ).toEqual(["c", "d"]);
  expect(f.store.listMetadata("pending", 2, "d")).toEqual([]);
  expect(f.store.listMetadata("pending")).toHaveLength(4);
  expect(() => f.store.listMetadata("pending", 2, "x".repeat(8193))).toThrow(
    "METADATA_CURSOR_INVALID",
  );
  expect(() => f.store.listMetadata("pending", 2, "bad\0cursor")).toThrow(
    "METADATA_CURSOR_INVALID",
  );
});

test("one registered task card reserves exactly one immutable initial operation", () => {
  const f = setup();
  const ctx = presentationFixture(f);
  f.store.registerPresentation(ctx.claim, ctx.context);
  const input = {
    kind: "app" as const,
    spaceId: ctx.destination.spaceId,
    url: ctx.context.viewUrl,
    live: true,
  };
  const context = {
    ...ctx,
    taskId: ctx.context.taskId,
    purpose: "presentation",
    actionKey: "first-card",
    presentation: {
      cardId: ctx.context.cardId,
      taskId: ctx.context.taskId,
      viewUrl: ctx.context.viewUrl,
      claimId: "host-claim",
    },
  };
  const first = f.store.enqueue(input, context);
  expect(f.store.enqueue(input, context).map((item) => item.id)).toEqual(
    first.map((item) => item.id),
  );
  for (const changed of [
    { ...context, actionKey: "another-action" },
    {
      ...context,
      presentation: { ...context.presentation, claimId: "new-claim" },
    },
  ])
    expect(() => f.store.enqueue(input, changed)).toThrow(
      "TASK_CARD_OPERATION_CONFLICT",
    );
  expect(() => f.store.enqueue({ ...input, live: false }, context)).toThrow(
    "TASK_CARD_OPERATION_CONFLICT",
  );
  expect(() =>
    f.store.enqueue(
      { ...input, kind: "app_update", targetMessageId: "original" },
      context,
    ),
  ).toThrow("PRESENTATION_CONTEXT_INVALID");
  expect(f.store.listMetadata("task-card-operation")).toHaveLength(1);
  expect(f.store.listOutbound()).toHaveLength(1);
});
