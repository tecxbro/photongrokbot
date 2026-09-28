import { existsSync, writeFileSync } from "node:fs";
import { resolveInstancePaths } from "../../../../shared/instance-paths.mjs";
import { openStore } from "../../storage.ts";
import { record } from "./fixture.ts";
const [root, mode, inputRaw = "{}", ready, barrier] = process.argv.slice(2);
const data = JSON.parse(inputRaw);
const paths = resolveInstancePaths({ instanceDir: root, testMode: true });
const store = openStore({
  paths,
  testMode: true,
  fault: (transition) => {
    if (transition === data.crashAt) process.kill(process.pid, "SIGKILL");
  },
});
if (ready) writeFileSync(ready, "ready");
if (barrier) {
  const start = Date.now();
  while (!existsSync(barrier)) {
    if (Date.now() - start > 10000) throw new Error("BARRIER_TIMEOUT");
    await Bun.sleep(2);
  }
}
let result: unknown;
if (mode === "claim") result = store.claimBatch(data.batchId);
else if (mode === "enqueue") {
  const ids: string[] = [];
  for (let i = 0; i < (data.count ?? 1); i++) {
    const items = store.enqueue(
      {
        spaceId: data.destination.spaceId,
        text: `worker ${data.worker} item ${i}\n\nsecond bubble`,
      },
      {
        claim: data.claim,
        destination: data.destination,
        purpose: "final",
        actionKey: `${data.worker}-${i}`,
      },
    );
    ids.push(...items.map((x) => x.id));
  }
  result = ids;
} else if (mode === "enqueue-presentation") {
  result = store.enqueue(data.input, data.context);
} else if (mode === "dispatch") {
  let n = 0;
  const start = Date.now();
  while (n < data.count && Date.now() - start < 10000) {
    const c = store.claimOutbound();
    if (c) {
      store.settleOutbound(c.item.id, c.attemptId, {
        state: "accepted",
        evidence: "fixture-only",
        reference: { messageId: `fixture-${c.item.id}` },
      });
      n++;
    } else await Bun.sleep(2);
  }
  result = n;
} else if (mode === "accept")
  result = store.accept({
    eventKey: "crash-key",
    record: record("crash-message"),
    destination: { spaceId: "space-1", lineId: "line-1" },
    onboarding: true,
  });
else if (mode === "batch") result = store.formBatches();
else if (mode === "claim-outbound") result = store.claimOutbound();
else if (mode === "settle-outbound")
  result = store.settleOutbound(data.id, data.attemptId, {
    state: "accepted",
    evidence: "fixture-only",
    reference: { messageId: "provider-fixture" },
  });
else if (mode === "wake") result = store.claimWake();
else if (mode === "settle-wake")
  result = store.settleWake(data.job, { state: "acknowledged" });
else if (mode === "media") result = store.claimMedia();
else if (mode === "settle-media")
  result = store.settleMedia(
    data.job.id,
    { state: "ready", patch: { transcript: "fixture transcript" } },
    data.job.attempts,
  );
else if (mode === "complete") result = store.completeClaim(data.claim);
else if (mode === "bind-task") result = store.bindTask(data.claim, data.task);
else if (mode === "task-result") result = store.ingestTaskResult(data.result);
else if (mode === "hold-lock") {
  store.db.exec("BEGIN IMMEDIATE");
  writeFileSync(data.acquired, "acquired");
  while (!existsSync(data.release)) await Bun.sleep(2);
  store.db.exec("ROLLBACK");
} else throw new Error("WORKER_MODE_INVALID");
console.log(JSON.stringify(result ?? null));
store.close();
