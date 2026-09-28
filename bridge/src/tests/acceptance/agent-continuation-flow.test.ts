import { afterEach, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ClaimResult, TaskBinding, TaskInput } from "../../contracts.ts";
import { fixture, record } from "../storage/fixture.ts";

const fixtures: ReturnType<typeof fixture>[] = [];
afterEach(() => { for (const f of fixtures.splice(0)) f.cleanup(); });
async function cli(f: ReturnType<typeof fixture>, entry: string, args: string[], input?: unknown) {
  const env: NodeJS.ProcessEnv = { ...process.env, PHOTON_TEST_MODE: "1", PHOTON_INSTANCE_DIR: f.root, NODE_ENV: "test" };
  delete env.PHOTON_LOCK_FD;
  const child = Bun.spawn([process.execPath, new URL(`../../${entry}.ts`, import.meta.url).pathname, ...args], { env, stdin: input === undefined ? "ignore" : new Blob([JSON.stringify(input)]), stdout: "pipe", stderr: "pipe" });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try {
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (exit !== 0) throw new Error(`CONTROL_FAILED ${entry} ${exit}: ${stderr}`);
    return JSON.parse(stdout);
  } finally { clearTimeout(timeout); }
}
async function claim(f: ReturnType<typeof fixture>, text: string) {
  const id = crypto.randomUUID();
  f.store.accept({ eventKey: id, record: { ...record(id), text }, destination: { spaceId: "space-1", lineId: "line-1" } });
  const batch = f.store.formBatches().find(batch => batch.messages.some(message => message.id === id))!;
  const claimed = await cli(f, "batch-control", ["claim", "--batch-id", batch.batchId]) as ClaimResult;
  if (claimed.status !== "acquired") throw new Error("FIXTURE_CLAIM_FAILED");
  return claimed;
}
async function complete(f: ReturnType<typeof fixture>, claimed: Extract<ClaimResult, { status: "acquired" }>) {
  await cli(f, "batch-control", ["complete", "--batch-id", claimed.token.batchId, "--run-id", claimed.token.runId, "--generation", String(claimed.token.generation), "--input-revision", String(claimed.inputRevision)]);
}
async function waitFor(path: string) {
  const end = Date.now() + 5_000;
  while (!existsSync(path)) { if (Date.now() > end) throw new Error("LOCK_FIXTURE_TIMEOUT"); await Bun.sleep(5); }
}

test("public controls keep dog app → unrelated question → add cats on one native task while runtime lock is held", async () => {
  const f = fixture(); fixtures.push(f);
  const ready = join(f.root, "lock-ready"), release = join(f.root, "lock-release");
  const lock = Bun.spawn(["python3", new URL("../../../tools/with-instance-lock.py", import.meta.url).pathname, join(f.root, "runtime.lock"), "python3", "-c", "import os,sys,time; open(sys.argv[1],'w').close()\nwhile not os.path.exists(sys.argv[2]): time.sleep(0.01)", ready, release], { stdout: "pipe", stderr: "pipe" });
  try {
    await waitFor(ready);
    const original = await claim(f, "Build a dog app");
    const task = { taskId: "local-app-intent", batchId: original.token.batchId, destination: { spaceId: "space-1", lineId: "line-1" }, owner: "imessage-creator", finalOwner: "front-door", state: "intent" };
    // Local intent is persisted before a native invocation can return its ID.
    const intent = await cli(f, "batch-control", ["delegation-intent", "--json-stdin"], { claim: original.token, task }) as TaskBinding;
    expect(intent.nativeRef).toBeUndefined();
    const firstInput = intent.inputs![0]!;
    await cli(f, "batch-control", ["delegation-receipt", "--json-stdin"], { claim: original.token, task: { ...task, state: "accepted", receipt: "native original invocation receipt", nativeRef: "native-app-reference" } });
    f.store.db.query("UPDATE batches SET lease_until=0 WHERE id=?").run(original.token.batchId);
    const firstResult = { taskId: task.taskId, inputRevision: firstInput.inputRevision, correlationId: firstInput.correlationId, nativeRef: "native-app-reference", receipt: "native dog completion", result: { text: "Dog app ready", url: "https://example.test/same-app" } };
    const recorded = await cli(f, "batch-control", ["task-result", "--json-stdin"], firstResult);
    const resumed = await cli(f, "batch-control", ["resume-task", "--json-stdin"], { taskId: task.taskId, inputRevision: firstInput.inputRevision }) as Extract<ClaimResult, { status: "acquired" }>;
    expect(resumed.status).toBe("acquired");
    const dog = await cli(f, "enqueue", ["--json-stdin"], { version: 1, batchId: resumed.token.batchId, inputRevision: resumed.inputRevision, taskId: task.taskId, taskInputRevision: firstInput.inputRevision, claim: resumed.token, purpose: "final", actionKey: "answer:1", payload: { spaceId: "space-1", text: "Dog app ready" } });
    await complete(f, resumed);
    expect(await cli(f, "batch-control", ["task-result", "--json-stdin"], firstResult)).toEqual(recorded);

    const unrelated = await claim(f, "What is two plus two?");
    await cli(f, "enqueue", ["--json-stdin"], { version: 1, batchId: unrelated.token.batchId, claim: unrelated.token, purpose: "final", actionKey: "answer:1", payload: { spaceId: "space-1", text: "Four." } });
    await complete(f, unrelated);
    expect(f.store.tasksForBatch(unrelated.token.batchId)).toEqual([]);

    const cats = await claim(f, "Add cats to that app");
    const secondInput = await cli(f, "batch-control", ["associate-task", "--json-stdin"], { claim: cats.token, taskId: task.taskId, inputRevision: cats.inputRevision }) as TaskInput;
    expect(secondInput.inputRevision).toBe(firstInput.inputRevision + 1);
    expect(f.store.getTask(task.taskId)).toMatchObject({ batchId: original.token.batchId, nativeRef: "native-app-reference", owner: task.owner, destination: task.destination });
    expect(f.store.tasksForBatch(cats.token.batchId).map(task => task.taskId)).toEqual([task.taskId]);
    await cli(f, "batch-control", ["delegation-receipt", "--json-stdin"], { claim: cats.token, task: { ...task, state: "accepted", receipt: "native amendment accepted", nativeRef: "native-app-reference", currentInputRevision: secondInput.inputRevision } });
    const secondResult = { taskId: task.taskId, inputRevision: secondInput.inputRevision, correlationId: secondInput.correlationId, nativeRef: "native-app-reference", receipt: "native cat amendment completion", result: { text: "Dogs and cats ready", url: "https://example.test/same-app" } };
    f.store.db.query("UPDATE batches SET lease_until=0 WHERE id=?").run(cats.token.batchId);
    await cli(f, "batch-control", ["task-result", "--json-stdin"], secondResult);
    const resumedCats = await cli(f, "batch-control", ["resume-task", "--json-stdin"], { taskId: task.taskId, inputRevision: secondInput.inputRevision }) as Extract<ClaimResult, { status: "acquired" }>;
    expect(resumedCats.status).toBe("acquired");
    const submission = { version: 1, batchId: resumedCats.token.batchId, inputRevision: resumedCats.inputRevision, taskId: task.taskId, taskInputRevision: secondInput.inputRevision, claim: resumedCats.token, purpose: "final", actionKey: "answer:1", payload: { spaceId: "space-1", text: "Dogs and cats ready" } };
    const combined = await cli(f, "enqueue", ["--json-stdin"], submission);
    expect(combined.items[0].id).not.toBe(dog.items[0].id);
    expect(await cli(f, "enqueue", ["--json-stdin"], submission)).toEqual(combined);
    await complete(f, resumedCats);
    await cli(f, "batch-control", ["task-result", "--json-stdin"], secondResult);
    expect(f.store.listOutbound()).toHaveLength(3);
    expect(f.store.getTask(task.taskId)!.inputs).toHaveLength(2);
    expect(f.store.claimWake()).toBeUndefined();
  } finally {
    writeFileSync(release, "release");
    await lock.exited;
  }
}, 20_000);
