import { afterEach, expect, test } from "bun:test";
import { submitOutbound } from "../../submit.ts";
import { fixture, batch } from "./fixture.ts";

const fixtures: ReturnType<typeof fixture>[] = [];
const setup = () => { const f = fixture(); fixtures.push(f); return f; };
afterEach(() => { for (const f of fixtures.splice(0)) f.cleanup(); });

test("different requests may both answer:1 with Done while each retry and status stay in their own request", async () => {
  const f = setup(), first = batch(f.store), second = batch(f.store);
  const submission = (ctx: typeof first) => ({ version: 1, batchId: ctx.batch.batchId, claim: ctx.claim, actionKey: "answer:1", purpose: "final", payload: { spaceId: ctx.destination.spaceId, text: "Done." } });
  const a = await submitOutbound(submission(first), { store: f.store, paths: f.paths });
  const b = await submitOutbound(submission(second), { store: f.store, paths: f.paths });
  expect(a).toHaveLength(1); expect(b).toHaveLength(1);
  expect(a[0]!.id).not.toBe(b[0]!.id);
  expect(await submitOutbound(submission(first), { store: f.store, paths: f.paths })).toEqual(a);
  expect(await submitOutbound(submission(second), { store: f.store, paths: f.paths })).toEqual(b);
  expect(f.store.operationStatus(first.destination, "final", "answer:1", { batchId: first.batch.batchId })).toEqual(a);
  expect(f.store.operationStatus(second.destination, "final", "answer:1", { batchId: second.batch.batchId })).toEqual(b);
  expect(f.store.outboundStatus(a[0]!.id)).toEqual(a[0]);
  expect(f.store.listOutbound()).toHaveLength(2);
});

test("claim renewal and recovery preserve operation scope and payload conflicts stay rejected", () => {
  const f = setup(), ctx = batch(f.store);
  const payload = { spaceId: ctx.destination.spaceId, text: "Done." };
  const context = { claim: ctx.claim, destination: ctx.destination, actionKey: "answer:1", purpose: "progress" };
  const original = f.store.enqueue(payload, context);
  f.store.renewClaim(ctx.claim);
  expect(f.store.enqueue(payload, context).map(item => item.id)).toEqual(original.map(item => item.id));
  f.store.db.query("UPDATE batches SET lease_until=0 WHERE id=?").run(ctx.batch.batchId);
  const wake = f.store.claimWake()!;
  expect(wake.batchId).toBe(ctx.batch.batchId);
  const recovered = f.store.claimBatch(ctx.batch.batchId);
  if (recovered.status !== "acquired") throw new Error("FIXTURE_RECOVERY_FAILED");
  expect(recovered.token.generation).toBeGreaterThan(ctx.claim.generation);
  expect(f.store.enqueue(payload, { ...context, claim: recovered.token }).map(item => item.id)).toEqual(original.map(item => item.id));
  expect(() => f.store.enqueue({ ...payload, text: "changed" }, { ...context, claim: recovered.token })).toThrow();
  expect(() => f.store.enqueue(payload, context)).toThrow("STALE_CLAIM");
  expect(f.store.operationStatus(ctx.destination, "progress", "answer:1", { batchId: ctx.batch.batchId, inputRevision: recovered.inputRevision }).map(item => item.id)).toEqual(original.map(item => item.id));
  expect(f.store.listOutbound()).toHaveLength(1);
});

test("submission cannot forge another request's scope or substitute an unrecorded task association", async () => {
  const f = setup(), first = batch(f.store), second = batch(f.store);
  f.store.bindTask(first.claim, { taskId: "original-task", batchId: first.batch.batchId, destination: first.destination, owner: "app-builder", finalOwner: "front-door", state: "intent" });
  const valid = { version: 1, batchId: second.batch.batchId, claim: second.claim, actionKey: "answer:1", purpose: "final", payload: { spaceId: second.destination.spaceId, text: "Done." } };
  await expect(submitOutbound({ ...valid, scope: first.batch.batchId }, { store: f.store, paths: f.paths })).rejects.toThrow();
  await expect(submitOutbound({ ...valid, taskId: "original-task", taskInputRevision: 1 }, { store: f.store, paths: f.paths })).rejects.toThrow();
  await expect(submitOutbound({ ...valid, inputRevision: 99 }, { store: f.store, paths: f.paths })).rejects.toThrow();
  expect(() => f.store.operationStatus({ ...first.destination, lineId: "different-line" }, "final", "answer:1", { batchId: first.batch.batchId })).toThrow();
  expect(f.store.listOutbound()).toHaveLength(0);
});

test("recording a native task after an ordinary progress answer does not change that operation's retry identity", () => {
  const f = setup(), ctx = batch(f.store);
  const payload = { spaceId: ctx.destination.spaceId, text: "Working on it." };
  const context = { claim: ctx.claim, destination: ctx.destination, actionKey: "progress:1", purpose: "progress" };
  const original = f.store.enqueue(payload, context);
  const task = { taskId: "native-intent-after-progress", batchId: ctx.batch.batchId, destination: ctx.destination, owner: "worker", finalOwner: "front-door", state: "intent" as const };
  f.store.bindTask(ctx.claim, task);
  f.store.bindTask(ctx.claim, { ...task, state: "accepted", nativeRef: "native-returned-reference", receipt: "accepted after initial progress" });
  expect(f.store.enqueue(payload, context).map(item => item.id)).toEqual(original.map(item => item.id));
  expect(f.store.operationStatus(ctx.destination, "progress", "progress:1", { batchId: ctx.batch.batchId }).map(item => item.id)).toEqual(original.map(item => item.id));
  expect(f.store.listOutbound()).toHaveLength(1);
});

test("native result submission derives the same stored task-input scope with or without an explicit task ID", () => {
  const f = setup(), ctx = batch(f.store);
  const task = { taskId: "local-result-task", batchId: ctx.batch.batchId, destination: ctx.destination, owner: "worker", finalOwner: "front-door", state: "intent" as const };
  f.store.bindTask(ctx.claim, task);
  const input = f.store.getTask(task.taskId)!.inputs![0]!;
  f.store.bindTask(ctx.claim, { ...task, state: "accepted", receipt: "native accepted", nativeRef: "native-result-reference" });
  f.store.ingestTaskResult({ taskId: task.taskId, inputRevision: input.inputRevision, correlationId: input.correlationId, receipt: "native completed", result: { text: "Done." } });
  const resumed = f.store.resumeTask(task.taskId, input.inputRevision);
  if (resumed.status !== "acquired") throw new Error("RESULT_RESUME_FAILED");
  const payload = { spaceId: ctx.destination.spaceId, text: "Done." };
  const context = { claim: resumed.token, inputRevision: resumed.inputRevision, destination: ctx.destination, actionKey: "answer:1", purpose: "final" };
  const original = f.store.enqueue(payload, context);
  expect(f.store.enqueue(payload, { ...context, taskId: task.taskId, taskInputRevision: input.inputRevision }).map(item => item.id)).toEqual(original.map(item => item.id));
  const source = { batchId: ctx.batch.batchId, inputRevision: resumed.inputRevision };
  const inferred = f.store.operationStatus(ctx.destination, "final", "answer:1", source);
  expect(inferred.map(item => item.id)).toEqual(original.map(item => item.id));
  expect(f.store.operationStatus(ctx.destination, "final", "answer:1", { ...source, taskId: task.taskId, taskInputRevision: input.inputRevision })).toEqual(inferred);
  expect(f.store.listOutbound()).toHaveLength(1);
});

test("omitting task ID cannot restore send authority for input superseded by an amendment", () => {
  const f = setup(), original = batch(f.store);
  const task = { taskId: "superseded-local-task", batchId: original.batch.batchId, destination: original.destination, owner: "worker", finalOwner: "front-door", state: "intent" as const };
  f.store.bindTask(original.claim, task);
  f.store.bindTask(original.claim, { ...task, state: "accepted", receipt: "native accepted", nativeRef: "same-native-task" });
  const amendment = batch(f.store);
  f.store.associateTask(amendment.claim, task.taskId);
  const context = { claim: original.claim, destination: original.destination, actionKey: "answer:1", purpose: "final" };
  const payload = { spaceId: original.destination.spaceId, text: "obsolete answer" };
  expect(() => f.store.enqueue(payload, context)).toThrow("SUPERSEDED_TASK_INPUT");
  expect(() => f.store.enqueue(payload, { ...context, taskId: task.taskId, taskInputRevision: 1 })).toThrow("SUPERSEDED_TASK_INPUT");
  expect(f.store.listOutbound()).toHaveLength(0);
});
