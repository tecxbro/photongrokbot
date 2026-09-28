import { afterEach, expect, test } from "bun:test";
import { fixture, batch } from "./storage/fixture.ts";
import { presentationControl } from "../presentation-control.ts";
import { resolve } from "node:path";
const fixtures: ReturnType<typeof fixture>[] = [];
function setup() {
  const f = fixture();
  fixtures.push(f);
  const b = batch(f.store);
  const task = {
    taskId: "task-1",
    batchId: b.batch.batchId,
    destination: b.destination,
    owner: "worker",
    finalOwner: "orchestrator",
    state: "accepted" as const,
    receipt: "native-task-1",
  };
  f.store.bindTask(b.claim, { ...task, state: "intent", receipt: undefined });
  f.store.bindTask(b.claim, task);
  f.store.setMetadata("live-mini-host", "configured", {
    origin: "https://cards.example.test",
  });
  const context = {
    cardId: "card-1",
    taskId: task.taskId,
    batchId: task.batchId,
    destination: task.destination,
    viewUrl: "https://cards.example.test/live-1/card-1?k=private-test-key",
  };
  const call = (command: string, body: unknown) =>
    presentationControl([command, "--json-stdin"], f.store, async () =>
      JSON.stringify(body),
    );
  return { ...f, b, task, context, call };
}
afterEach(() => {
  for (const f of fixtures.splice(0)) f.cleanup();
});
test("private controls derive original task destination and register immutable full URL", async () => {
  const f = setup();
  expect(
    await f.call("task-context", {
      taskId: f.task.taskId,
      batchId: f.task.batchId,
      claim: f.b.claim,
    }),
  ).toEqual({
    taskId: f.task.taskId,
    batchId: f.task.batchId,
    originalBatchId: f.task.batchId,
    inputRevision: 1,
    taskInputRevision: 1,
    destination: f.b.destination,
    origin: "https://cards.example.test",
  });
  expect(
    await f.call("register", { claim: f.b.claim, context: f.context }),
  ).toEqual({ ok: true });
  await f.call("register", { claim: f.b.claim, context: f.context });
  await expect(
    f.call("register", {
      claim: f.b.claim,
      context: {
        ...f.context,
        viewUrl: f.context.viewUrl.replace("private-test-key", "other"),
      },
    }),
  ).rejects.toThrow("PRESENTATION_IDENTITY_CONFLICT");
  await expect(
    f.call("task-context", { taskId: "absent", batchId: f.task.batchId }),
  ).rejects.toThrow("TASK_CONTEXT_MISMATCH");
  await expect(
    f.call("task-context", {
      taskId: f.task.taskId,
      batchId: f.task.batchId,
      destination: f.b.destination,
    }),
  ).rejects.toThrow("UNKNOWN_FIELD");
});
test("read-only operation recovery survives lease expiry without allowing another registration", async () => {
  const f = setup();
  await f.call("register", { claim: f.b.claim, context: f.context });
  const [item] = f.store.enqueue(
    {
      kind: "app",
      spaceId: f.b.destination.spaceId,
      url: f.context.viewUrl,
      live: true,
    },
    {
      actionKey: "card-action",
      purpose: "presentation",
      claim: f.b.claim,
      destination: f.b.destination,
      taskId: f.task.taskId,
      presentation: {
        cardId: f.context.cardId,
        taskId: f.task.taskId,
        viewUrl: f.context.viewUrl,
        claimId: "host-claim",
      },
    },
  );
  f.store.db
    .query("UPDATE batches SET lease_until=0 WHERE id=?")
    .run(f.task.batchId);
  expect(
    await f.call("operation-status", {
      taskId: f.task.taskId,
      batchId: f.task.batchId,
      actionKey: "card-action",
      cardId: f.context.cardId,
    }),
  ).toMatchObject({ items: [{ id: item!.id, state: "queued" }] });
  await expect(
    f.call("register", { claim: f.b.claim, context: f.context }),
  ).rejects.toThrow();
});
test("permitted follow-ups retain card identity while superseded inputs can only recover reads", async () => {
  const f = setup();
  await f.call("register", { claim: f.b.claim, context: f.context });
  const next = batch(f.store);
  await expect(f.call("task-context", {
    taskId: f.task.taskId, batchId: next.batch.batchId, claim: next.claim,
  })).rejects.toThrow("TASK_CONTEXT_MISMATCH");
  const input = f.store.associateTask(next.claim, f.task.taskId, 1);
  f.store.bindTask(next.claim, { ...f.task, currentInputRevision: input.inputRevision, receipt: "native-amendment" });
  expect(await f.call("task-context", {
    taskId: f.task.taskId, batchId: next.batch.batchId, claim: next.claim,
    inputRevision: 1, taskInputRevision: input.inputRevision,
  })).toMatchObject({
    originalBatchId: f.task.batchId, batchId: next.batch.batchId,
    inputRevision: 1, taskInputRevision: input.inputRevision,
  });
  await f.call("register", {
    claim: next.claim, inputRevision: 1, taskInputRevision: input.inputRevision,
    context: f.context,
  });
  expect(f.store.getTask(f.task.taskId)?.batchId).toBe(f.task.batchId);
  expect(f.store.getMetadata<typeof f.context>("task-card-context", f.context.cardId)).toEqual(f.context);
  await expect(f.call("task-context", {
    taskId: f.task.taskId, batchId: f.task.batchId, claim: f.b.claim,
    inputRevision: 1, taskInputRevision: 1,
  })).rejects.toThrow("SUPERSEDED_TASK_INPUT");
  expect(await f.call("task-context", {
    taskId: f.task.taskId, batchId: f.task.batchId,
    inputRevision: 1, taskInputRevision: 1,
  })).toMatchObject({ originalBatchId: f.task.batchId });
  await expect(f.call("operation-status", {
    taskId: f.task.taskId, batchId: next.batch.batchId,
    actionKey: "card-action", cardId: "some-other-card",
  })).rejects.toThrow("TASK_CARD_CONTEXT_MISMATCH");
});
test("executable Bun control accepts bounded stdin and emits no input or private URL on rejection", async () => {
  const f = setup();
  async function run(input: string, args = ["task-context", "--json-stdin"]) {
    const child = Bun.spawn(
      [
        process.execPath,
        "run",
        resolve(import.meta.dir, "../presentation-control.ts"),
        ...args,
      ],
      {
        env: {
          ...process.env,
          PHOTON_TEST_MODE: "1",
          PHOTON_INSTANCE_DIR: f.root,
        },
        stdin: new Blob([input]),
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    return {
      stdout: await new Response(child.stdout).text(),
      stderr: await new Response(child.stderr).text(),
      code: await child.exited,
    };
  }
  const good = await run(
    JSON.stringify({ taskId: f.task.taskId, batchId: f.task.batchId }),
  );
  expect(good.code).toBe(0);
  expect(JSON.parse(good.stdout).destination).toEqual(f.b.destination);
  const oversized = await run(
    JSON.stringify({ private: "secret".repeat(12000) }),
  );
  expect(oversized.code).toBe(1);
  expect(oversized.stdout).toBe("");
  expect(JSON.parse(oversized.stderr)).toEqual({
    ok: false, error: { code: "INPUT_TOO_LARGE", recovery: ["correct-input"] },
  });
  expect((await run("{}", ["task-context", "--", "--json-stdin"])).code).toBe(
    1,
  );
});
