import { afterEach, expect, test } from "bun:test";
import { submitOutbound } from "../../submit.ts";
import { exportInstance } from "../../export-instance.ts";
import { Database } from "bun:sqlite";
import { join, relative } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { fixture, batch } from "./fixture.ts";

const fixtures: ReturnType<typeof fixture>[] = [];
afterEach(() => { for (const f of fixtures.splice(0)) f.cleanup(); });
function setup() {
  const f = fixture(); fixtures.push(f);
  const ctx = batch(f.store);
  const task = { taskId: "local-dog-app", batchId: ctx.batch.batchId, destination: ctx.destination, owner: "app-builder", finalOwner: "front-door", state: "intent" as const };
  f.store.bindTask(ctx.claim, task);
  const intent = f.store.getTask(task.taskId)!;
  f.store.bindTask(ctx.claim, { ...task, state: "accepted", receipt: "native accepted original invocation", nativeRef: "native-task-after-invocation" });
  const input = intent.inputs![0]!;
  return { ...f, ...ctx, task, input };
}
function result(f: ReturnType<typeof setup>, patch: Record<string, unknown> = {}) {
  return { taskId: f.task.taskId, inputRevision: f.input.inputRevision, correlationId: f.input.correlationId, nativeRef: "native-task-after-invocation", receipt: "original worker completion", result: { text: "Dog app built", url: "https://example.test/dog" }, ...patch };
}

test("original worker result obtains fresh authority after parent expiry while expired tokens remain invalid", async () => {
  const f = setup();
  f.store.db.query("UPDATE batches SET lease_until=0 WHERE id=?").run(f.batch.batchId);
  expect(() => f.store.assertClaim(f.claim)).toThrow("STALE_CLAIM");
  expect(() => f.store.renewClaim(f.claim)).toThrow("STALE_CLAIM");
  const returned = f.store.ingestTaskResult(result(f));
  expect(returned).toMatchObject({ taskId: f.task.taskId, batchId: f.batch.batchId, inputRevision: 1, superseded: false });
  const resumed = f.store.resumeTask(f.task.taskId, f.input.inputRevision);
  if (resumed.status !== "acquired") throw new Error("RESULT_RESUME_FAILED");
  expect(resumed.token.runId).not.toBe(f.claim.runId);
  expect(resumed.token.generation).toBeGreaterThan(f.claim.generation);
  expect(() => f.store.completeClaim(f.claim)).toThrow("STALE_CLAIM");
  const read = f.store.readBatch(f.batch.batchId, resumed.inputRevision);
  expect(read.continuationReason).toBe("task_result");
  expect(read.taskResults).toContainEqual(returned);
  expect(f.store.getTask(f.task.taskId)).toMatchObject({ taskId: "local-dog-app", nativeRef: "native-task-after-invocation", batchId: f.batch.batchId, owner: "app-builder", destination: f.destination });
  const sent = await submitOutbound({ version: 1, batchId: f.batch.batchId, inputRevision: read.inputRevision, taskId: f.task.taskId, taskInputRevision: f.input.inputRevision, claim: resumed.token, actionKey: "answer:1", purpose: "final", payload: { spaceId: f.destination.spaceId, text: "Dog app built" } }, { store: f.store, paths: f.paths });
  expect(sent).toHaveLength(1);
  f.store.completeClaim(resumed.token, read.inputRevision);
  expect(f.store.ingestTaskResult(result(f))).toEqual(returned);
  expect(f.store.resumeTask(f.task.taskId, f.input.inputRevision).status).toBe("completed");
  expect(f.store.claimWake()).toBeUndefined();
  expect(f.store.listOutbound()).toHaveLength(1);
  expect(() => f.store.ingestTaskResult(result(f, { result: { text: "changed result" } }))).toThrow();
});

test("follow-up association preserves original task binding and excludes unrelated input", async () => {
  const f = setup();
  const unrelated = batch(f.store);
  f.store.completeClaim(unrelated.claim);
  const amendment = batch(f.store);
  const associated = f.store.associateTask(amendment.claim, f.task.taskId);
  expect(associated.inputRevision).toBe(2);
  expect(associated.batchId).toBe(amendment.batch.batchId);
  expect(f.store.associateTask(amendment.claim, f.task.taskId)).toEqual(associated);
  const task = f.store.getTask(f.task.taskId)!;
  expect(task.batchId).toBe(f.batch.batchId);
  expect(task.destination).toEqual(f.destination);
  expect(task.owner).toBe(f.task.owner);
  expect(task.inputs).toHaveLength(2);
  expect(f.store.tasksForBatch(f.batch.batchId).map(task => task.taskId)).toEqual([f.task.taskId]);
  expect(f.store.tasksForBatch(amendment.batch.batchId).map(task => task.taskId)).toEqual([f.task.taskId]);
  expect(f.store.tasksForBatch(unrelated.batch.batchId)).toEqual([]);
  expect(() => f.store.getTaskInput(f.task.taskId, unrelated.batch.batchId)).toThrow();
  f.store.bindTask(amendment.claim, { ...f.task, state: "accepted", nativeRef: "native-task-after-invocation", currentInputRevision: associated.inputRevision, receipt: "native amendment accepted" });
  const sent = await submitOutbound({ version: 1, batchId: amendment.batch.batchId, taskId: f.task.taskId, taskInputRevision: associated.inputRevision, claim: amendment.claim, actionKey: "amendment:1", purpose: "progress", payload: { spaceId: f.destination.spaceId, text: "Adding cats to the same app" } }, { store: f.store, paths: f.paths });
  expect(sent).toHaveLength(1);
});

test("wrong conversation or line cannot associate an existing task or return a mismatched result", () => {
  const f = setup();
  const wrongConversation = batch(f.store, "other-space");
  expect(() => f.store.associateTask(wrongConversation.claim, f.task.taskId)).toThrow();
  f.store.accept({ eventKey: "wrong-line", record: { ...f.batch.messages[0]!, id: "wrong-line-message" }, destination: { ...f.destination, lineId: "other-line" } });
  const second = f.store.formBatches()[0]!;
  const wrongLine = f.store.claimBatch(second.batchId);
  if (wrongLine.status !== "acquired") throw new Error("FIXTURE_CLAIM_FAILED");
  expect(() => f.store.associateTask(wrongLine.token, f.task.taskId)).toThrow();
  expect(() => f.store.ingestTaskResult(result(f, { correlationId: "not-recorded" }))).toThrow();
  expect(() => f.store.ingestTaskResult(result(f, { nativeRef: "another-native-task" }))).toThrow();
  expect(() => f.store.ingestTaskResult(result(f, { inputRevision: 99 }))).toThrow();
  expect(f.store.getTask(f.task.taskId)!.inputs).toHaveLength(1);
  expect(f.store.listOutbound()).toHaveLength(0);
});

test("late superseded worker result is retained without reviving obsolete work or final-send authority", async () => {
  const f = setup();
  const amendment = batch(f.store);
  const input = f.store.associateTask(amendment.claim, f.task.taskId);
  const returned = f.store.ingestTaskResult(result(f));
  expect(returned.superseded).toBe(true);
  expect(f.store.ingestTaskResult(result(f))).toEqual(returned);
  expect(() => f.store.resumeTask(f.task.taskId, f.input.inputRevision)).toThrow("SUPERSEDED_TASK_INPUT");
  expect(() => f.store.getTaskInput(f.task.taskId, f.batch.batchId, f.input.workRevision, true)).toThrow();
  await expect(submitOutbound({ version: 1, batchId: f.batch.batchId, claim: f.claim, taskId: f.task.taskId, taskInputRevision: f.input.inputRevision, actionKey: "answer:1", purpose: "final", payload: { spaceId: f.destination.spaceId, text: "obsolete worker output" } }, { store: f.store, paths: f.paths })).rejects.toThrow("SUPERSEDED_TASK_INPUT");
  expect(f.store.getTaskInput(f.task.taskId, amendment.batch.batchId, input.workRevision, true)).toEqual(input);
  f.store.recoverWork();
  expect(f.store.claimWake()).toBeUndefined();
  expect(f.store.listOutbound()).toHaveLength(0);
  expect(f.store.getTask(f.task.taskId)!.batchId).toBe(f.batch.batchId);
});

test("retention retains native task context after parent expiry until a result is consumed", () => {
  const f = setup();
  f.store.db.query("UPDATE batches SET lease_until=0 WHERE id=?").run(f.batch.batchId);
  const first = f.store.pruneResolvedBefore({ resolvedBefore: Date.now() + 1_000, intermediateBefore: Date.now() + 1_000, apply: true });
  expect(first.events).toBe(0);
  f.store.ingestTaskResult(result(f));
  const second = f.store.pruneResolvedBefore({ resolvedBefore: Date.now() + 1_000, intermediateBefore: Date.now() + 1_000, apply: true });
  expect(second.events).toBe(0);
  expect(f.store.readBatch(f.batch.batchId).messages).toHaveLength(1);
});

test("offline amendment recovery reopens its current input while preserving the completed original batch", () => {
  for (const state of ["accepted", "unknown"] as const) {
    const f = setup();
    f.store.ingestTaskResult(result(f));
    const originalResult = f.store.resumeTask(f.task.taskId, 1);
    if (originalResult.status !== "acquired") throw new Error("RESULT_RESUME_FAILED");
    f.store.completeClaim(originalResult.token, originalResult.inputRevision);
    const original = f.store.claimSnapshot(f.batch.batchId);
    const amendment = batch(f.store);
    const input = f.store.associateTask(amendment.claim, f.task.taskId);
    f.store.bindTask(amendment.claim, {
      ...f.task, state, currentInputRevision: input.inputRevision,
      nativeRef: "native-task-after-invocation", receipt: "amendment invocation receipt",
    });
    f.store.db.query("UPDATE batches SET lease_until=0 WHERE id=?").run(amendment.batch.batchId);
    f.store.reconcileTask(f.task.taskId, { state: "completed", receipt: "offline verified amendment completion" });
    expect(f.store.claimSnapshot(f.batch.batchId)).toEqual(original);
    expect(f.store.claimSnapshot(amendment.batch.batchId).state).toBe("pending");
    expect(f.store.getTask(f.task.taskId)).toMatchObject({
      batchId: f.batch.batchId, currentInputRevision: input.inputRevision, state: "completed",
    });
    expect(f.store.getTask(f.task.taskId)!.inputs!.find(item => item.inputRevision === input.inputRevision)?.state).toBe("completed");
    expect(f.store.claimWake()?.batchId).toBe(amendment.batch.batchId);
    expect(f.store.claimBatch(amendment.batch.batchId).status).toBe("acquired");
  }
});

test("export includes pending task results, stable input correlation and required assets; resolved result content is pruned", () => {
  const f = setup(), asset = join(f.paths.outboundAssetsDir, "pending-result.txt");
  writeFileSync(asset, "private worker asset", { mode: 0o600 });
  const returned = f.store.ingestTaskResult(result(f, { result: { text: "private worker result", attachmentPath: asset } }));
  const preview = exportInstance(f.paths, f.store);
  const exported = exportInstance(f.paths, f.store, { apply: true, planId: preview.planId });
  if (!("exportId" in exported)) throw new Error("EXPORT_NOT_APPLIED");
  const directory = join(f.paths.backupsDir, `export-${exported.exportId}`);
  expect(readFileSync(join(directory, relative(f.paths.root, asset)), "utf8")).toBe("private worker asset");
  const snapshot = new Database(join(directory, "bridge.sqlite"), { readonly: true });
  try {
    const stored = snapshot.query("SELECT value FROM task_results WHERE id=?").get(returned.resultId) as { value: string };
    expect(JSON.parse(stored.value)).toEqual(returned);
    expect(snapshot.query("SELECT correlation_id FROM task_inputs WHERE task_id=? AND input_revision=?").get(f.task.taskId, f.input.inputRevision)).toEqual({ correlation_id: f.input.correlationId });
    expect(snapshot.query("SELECT input_revision,acknowledged_revision FROM batches WHERE id=?").get(f.batch.batchId)).toEqual({ input_revision: returned.workRevision, acknowledged_revision: 0 });
  } finally { snapshot.close(); }
  const claim = f.store.resumeTask(f.task.taskId, f.input.inputRevision);
  if (claim.status !== "acquired") throw new Error("RESULT_RESUME_FAILED");
  f.store.completeClaim(claim.token, claim.inputRevision);
  f.store.pruneResolvedBefore({ resolvedBefore: Date.now() + 1_000, intermediateBefore: Date.now() + 1_000, apply: true });
  const retained = f.store.db.query("SELECT value FROM task_results WHERE id=?").get(returned.resultId) as { value: string };
  expect(retained.value).not.toContain("private worker result");
  expect(JSON.parse(retained.value)).toMatchObject({ resultId: returned.resultId, taskId: f.task.taskId, inputRevision: f.input.inputRevision, correlationId: f.input.correlationId, result: { redacted: true } });
});
