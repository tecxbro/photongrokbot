import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveInstancePaths,
  ensureInstancePaths,
  atomicPrivateWrite,
} from "../../../../shared/instance-paths.mjs";
import { openStore } from "../../storage.ts";
import type { StoreOptions } from "../../storage.contract.ts";
import type { InboundRecord } from "../../types.ts";
export function fixture(options: Partial<StoreOptions> = {}) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "photon-store-"));
  const paths = resolveInstancePaths({
    instanceDir: root,
    testMode: true,
    env: { PHOTON_TEST_MODE: "1" },
  });
  ensureInstancePaths(paths);
  atomicPrivateWrite(
    paths.configPath,
    JSON.stringify({
      version: 1,
      installationId: "test-installation-0001",
      setup: { version: 1, resources: {} },
    }),
  );
  const store = openStore({ paths, create: true, testMode: true, ...options });
  return {
    root,
    paths,
    store,
    cleanup() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
export function record(id = "msg-1", spaceId = "space-1"): InboundRecord {
  return {
    id,
    spaceId,
    senderId: "sender-1",
    text: "hello world",
    timestamp: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
  };
}
export function batch(
  store: ReturnType<typeof openStore>,
  spaceId = "space-1",
) {
  store.accept({
    eventKey: crypto.randomUUID(),
    record: record(crypto.randomUUID(), spaceId),
    destination: { spaceId, lineId: "line-1" },
  });
  const b = store.formBatches()[0]!;
  const c = store.claimBatch(b.batchId);
  if (c.status !== "acquired") throw new Error("fixture claim failed");
  return {
    batch: b,
    claim: c.token,
    destination: { spaceId, lineId: "line-1" },
  };
}
