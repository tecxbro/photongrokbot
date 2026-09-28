import { afterEach, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixture, batch, record } from "./fixture.ts";
const fixtures: ReturnType<typeof fixture>[] = [];
const setup = () => {
  const f = fixture();
  fixtures.push(f);
  return f;
};
afterEach(() => {
  for (const f of fixtures.splice(0)) f.cleanup();
});
function child(
  root: string,
  mode: string,
  input: unknown,
  ready?: string,
  barrier?: string,
) {
  return Bun.spawn(
    [
      process.execPath,
      new URL("./process-worker.ts", import.meta.url).pathname,
      root,
      mode,
      JSON.stringify(input),
      ...(ready ? [ready, barrier!] : []),
    ],
    {
      env: { ...process.env, PHOTON_TEST_MODE: "1", PHOTON_INSTANCE_DIR: root },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
}
async function waitFor(paths: string[]) {
  const start = Date.now();
  while (!paths.every(existsSync)) {
    if (Date.now() - start > 10000) throw new Error("BARRIER_TIMEOUT");
    await Bun.sleep(5);
  }
}
async function output(c: ReturnType<typeof child>) {
  const [exit, stdout, stderr] = await Promise.all([
    c.exited,
    new Response(c.stdout).text(),
    new Response(c.stderr).text(),
  ]);
  if (exit !== 0) throw new Error(`child failed: ${stderr}`);
  return JSON.parse(stdout.trim());
}
test("D01 real concurrent enqueue and settlement processes preserve every acknowledged child", async () => {
  const f = setup();
  const ctx = batch(f.store);
  const barrier = join(f.root, "go");
  const ready = [0, 1, 2, 3].map((n) => join(f.root, `ready-${n}`));
  const producers = [0, 1, 2].map((n) =>
    child(
      f.root,
      "enqueue",
      { ...ctx, count: 12, worker: n },
      ready[n],
      barrier,
    ),
  );
  const consumer = child(f.root, "dispatch", { count: 72 }, ready[3], barrier);
  await waitFor(ready);
  writeFileSync(barrier, "go");
  const returned = (await Promise.all(producers.map(output))).flat();
  expect(await output(consumer)).toBe(72);
  expect(returned).toHaveLength(72);
  expect(new Set(returned).size).toBe(72);
  for (const id of returned)
    expect(f.store.outboundStatus(id)?.state).toBe("accepted");
  expect(f.store.listOutbound()).toHaveLength(72);
}, 20000);
test("C01 separate processes with same bot claim one invocation winner", async () => {
  const f = setup();
  f.store.accept({
    eventKey: "e",
    record: record(),
    destination: { spaceId: "space-1", lineId: "line-1" },
  });
  const b = f.store.formBatches()[0]!;
  const ready = [0, 1, 2].map((n) => join(f.root, `ready-${n}`));
  const barrier = join(f.root, "go");
  const workers = ready.map((r) =>
    child(f.root, "claim", { batchId: b.batchId, bot: "same-bot" }, r, barrier),
  );
  await waitFor(ready);
  writeFileSync(barrier, "go");
  const results = await Promise.all(workers.map(output));
  expect(results.filter((r) => r.status === "acquired")).toHaveLength(1);
  expect(results.filter((r) => r.status === "busy")).toHaveLength(2);
});
for (const phase of ["before_commit", "after_commit"]) {
  test(`D02 crash ${phase} input/onboarding transition remains atomic`, async () => {
    const f = setup();
    const c = child(f.root, "accept", { crashAt: `accept:${phase}` });
    expect(await c.exited).not.toBe(0);
    expect(f.store.recentInbound()).toHaveLength(
      phase === "before_commit" ? 0 : 1,
    );
    expect(f.store.listOutbound()).toHaveLength(
      phase === "before_commit" ? 0 : 1,
    );
    const accepted = f.store.accept({
      eventKey: "crash-key",
      record: record("crash-message"),
      destination: { spaceId: "space-1", lineId: "line-1" },
      onboarding: true,
    });
    expect(accepted.duplicate).toBe(phase === "after_commit");
    expect(f.store.recentInbound()).toHaveLength(1);
    expect(f.store.listOutbound()).toHaveLength(1);
  });
  test(`D03 crash ${phase} batch/wake transition keeps recoverable input`, async () => {
    const f = setup();
    f.store.accept({
      eventKey: "e",
      record: record(),
      destination: { spaceId: "space-1", lineId: "line-1" },
    });
    expect(
      await child(f.root, "batch", { crashAt: `form_batches:${phase}` }).exited,
    ).not.toBe(0);
    f.store.formBatches();
    expect(
      (f.store.db.query("SELECT count(*) n FROM batches").get() as any).n,
    ).toBe(1);
    expect(
      (f.store.db.query("SELECT count(*) n FROM batch_events").get() as any).n,
    ).toBe(1);
    expect(f.store.claimWake()).toBeDefined();
  });
  test(`crash ${phase} fenced claim cannot produce two valid owners`, async () => {
    const f = setup();
    f.store.accept({
      eventKey: "e",
      record: record(),
      destination: { spaceId: "space-1", lineId: "line-1" },
    });
    const b = f.store.formBatches()[0]!;
    expect(
      await child(f.root, "claim", {
        batchId: b.batchId,
        crashAt: `claim_batch:${phase}`,
      }).exited,
    ).not.toBe(0);
    expect(f.store.claimBatch(b.batchId).status).toBe(
      phase === "before_commit" ? "acquired" : "busy",
    );
  });
  test(`D06 crash ${phase} multi-bubble commit has all or no children`, async () => {
    const f = setup();
    const ctx = batch(f.store);
    expect(
      await child(f.root, "enqueue", {
        ...ctx,
        worker: "crash",
        crashAt: `enqueue:${phase}`,
      }).exited,
    ).not.toBe(0);
    expect(f.store.listOutbound()).toHaveLength(
      phase === "before_commit" ? 0 : 2,
    );
    const ids = f.store.enqueue(
      { spaceId: "space-1", text: "worker crash item 0\n\nsecond bubble" },
      { ...ctx, purpose: "final", actionKey: "crash-0" },
    );
    expect(f.store.listOutbound()).toHaveLength(2);
    expect(ids).toHaveLength(2);
  });
  test(`crash ${phase} dispatch attempt is queued or unknown, never automatically repeated`, async () => {
    const f = setup();
    const ctx = batch(f.store);
    const [item] = f.store.enqueue(
      { spaceId: "space-1", text: "One" },
      { ...ctx, purpose: "final", actionKey: "send" },
    );
    expect(
      await child(f.root, "claim-outbound", {
        crashAt: `claim_outbound:${phase}`,
      }).exited,
    ).not.toBe(0);
    f.store.recoverSending();
    expect(f.store.outboundStatus(item!.id)?.state).toBe(
      phase === "before_commit" ? "queued" : "unknown",
    );
    expect(!!f.store.claimOutbound()).toBe(phase === "before_commit");
  });
  test(`crash ${phase} settlement preserves reference/evidence together`, async () => {
    const f = setup();
    const ctx = batch(f.store);
    const [item] = f.store.enqueue(
      { spaceId: "space-1", text: "One" },
      { ...ctx, purpose: "final", actionKey: "send" },
    );
    const c = f.store.claimOutbound()!;
    expect(
      await child(f.root, "settle-outbound", {
        id: item!.id,
        attemptId: c.attemptId,
        crashAt: `settle_outbound:${phase}`,
      }).exited,
    ).not.toBe(0);
    f.store.recoverSending();
    const status = f.store.outboundStatus(item!.id)!;
    expect(status.state).toBe(
      phase === "before_commit" ? "unknown" : "accepted",
    );
    expect(status.reference?.messageId).toBe(
      phase === "before_commit" ? undefined : "provider-fixture",
    );
  });
  test(`crash ${phase} task reservation cannot blindly duplicate handoff`, async () => {
    const f = setup();
    const ctx = batch(f.store);
    const task = {
      taskId: "task-crash",
      batchId: ctx.batch.batchId,
      destination: ctx.destination,
      owner: "worker",
      finalOwner: "front",
      state: "intent",
    };
    expect(
      await child(f.root, "bind-task", {
        claim: ctx.claim,
        task,
        crashAt: `bind_task:${phase}`,
      }).exited,
    ).not.toBe(0);
    f.store.recoverWork();
    expect(f.store.getTask(task.taskId)?.state).toBe(
      phase === "before_commit" ? undefined : "unknown",
    );
  });
  test(`crash ${phase} wake acknowledgement leaves batch actionable`, async () => {
    const f = setup();
    f.store.accept({
      eventKey: "e",
      record: record(),
      destination: { spaceId: "space-1", lineId: "line-1" },
    });
    const b = f.store.formBatches()[0]!;
    const job = f.store.claimWake()!;
    expect(
      await child(f.root, "settle-wake", {
        job,
        crashAt: `settle_wake:${phase}`,
      }).exited,
    ).not.toBe(0);
    f.store.recoverWork();
    expect(f.store.claimBatch(b.batchId).status).toBe("acquired");
    expect(f.store.readBatch(b.batchId).messages).toHaveLength(1);
  });
  test(`crash ${phase} media enrichment remains correlated to same batch`, async () => {
    const f = setup();
    f.store.accept({
      eventKey: "e",
      record: { ...record(), kind: "voice" },
      destination: { spaceId: "space-1", lineId: "line-1" },
      media: {
        messageId: "msg-1",
        spaceId: "space-1",
        lineId: "line-1",
        kind: "voice",
      },
    });
    const b = f.store.formBatches()[0]!;
    const job = f.store.claimMedia()!;
    expect(
      await child(f.root, "settle-media", {
        job,
        crashAt: `settle_media:${phase}`,
      }).exited,
    ).not.toBe(0);
    f.store.recoverWork();
    expect(f.store.readBatch(b.batchId).messages[0]?.transcript).toBe(
      phase === "before_commit" ? undefined : "fixture transcript",
    );
    expect(f.store.formBatches()).toHaveLength(0);
  });
}
test("D08 separate writer lock contention fails within bounded busy timeout", async () => {
  const f = setup();
  const acquired = join(f.root, "locked"),
    release = join(f.root, "unlock");
  const c = child(f.root, "hold-lock", { acquired, release });
  await waitFor([acquired]);
  const start = Date.now();
  try {
    expect(() =>
      f.store.accept({
        eventKey: "busy",
        record: record(),
        destination: { spaceId: "space-1", lineId: "line-1" },
      }),
    ).toThrow();
    expect(Date.now() - start).toBeLessThan(3500);
  } finally {
    writeFileSync(release, "unlock");
    await output(c);
  }
  expect(f.store.recentInbound()).toHaveLength(0);
}, 10000);
for (const phase of ["before_commit", "after_commit"]) {
  test(`presentation ledger and outbox share one durable commit across crash ${phase}`, async () => {
    const f = setup();
    const ctx = batch(f.store);
    const input = {
      kind: "app",
      spaceId: ctx.destination.spaceId,
      url: "https://example.test/live-1/card?k=test",
      live: true,
    };
    const presentation = {
      cardId: "card",
      taskId: "live-task",
      claimId: "host-claim",
      viewUrl: input.url,
    };
    const task = {
      taskId: presentation.taskId,
      batchId: ctx.claim.batchId,
      destination: ctx.destination,
      owner: "worker",
      finalOwner: "main",
      state: "intent" as const,
    };
    f.store.bindTask(ctx.claim, task);
    f.store.bindTask(ctx.claim, {
      ...task,
      state: "accepted",
      receipt: "native-receipt",
    });
    f.store.setMetadata("live-mini-host", "configured", {
      origin: "https://example.test",
    });
    f.store.registerPresentation(ctx.claim, {
      cardId: presentation.cardId,
      taskId: presentation.taskId,
      batchId: ctx.claim.batchId,
      destination: ctx.destination,
      viewUrl: presentation.viewUrl,
    });
    const context = {
      ...ctx,
      purpose: "presentation",
      actionKey: "live-first",
      presentation,
    };
    expect(
      await child(f.root, "enqueue-presentation", {
        input,
        context,
        crashAt: `enqueue:${phase}`,
      }).exited,
    ).not.toBe(0);
    const rows = f.store.listOutbound();
    const ledger = f.store.listMetadata<any>("presentation-submission");
    expect(rows).toHaveLength(phase === "before_commit" ? 0 : 1);
    expect(ledger).toHaveLength(rows.length);
    expect(f.store.listMetadata("task-card-operation")).toHaveLength(
      rows.length,
    );
    const replay = f.store.enqueue({ ...input, kind: "app" }, context);
    expect(f.store.listOutbound()).toHaveLength(1);
    expect(
      f.store.getMetadata("presentation-submission", replay[0]!.id),
    ).toMatchObject({
      ...presentation,
      batchId: ctx.claim.batchId,
      actionKey: context.actionKey,
      destination: ctx.destination,
      outboundId: replay[0]!.id,
    });
  });
}
