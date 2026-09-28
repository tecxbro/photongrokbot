import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { resolveInstancePaths } from "../../shared/instance-paths.mjs";
import { getStore } from "./storage.ts";
import { createOutboundDispatcher } from "./outbound-dispatcher.ts";
if (import.meta.main) {
    if (process.env.PHOTON_TEST_MODE !== "1" || !process.env.PHOTON_INSTANCE_DIR)
        throw new Error("ISOLATED_TEST_INSTANCE_REQUIRED");
    const paths = resolveInstancePaths(), store = getStore();
    const mode = process.argv[2];
    const worker = createOutboundDispatcher({ store, paths, resolveSpace: async (destination) => ({ id: destination.spaceId, phone: destination.lineId, getMessage: async () => undefined, send: async () => {
                appendFileSync(join(paths.logsDir, "synthetic-provider-calls"), "one\n", { mode: 0o600 });
                if (mode === "crash-after-send")
                    process.kill(process.pid, "SIGKILL");
                await Bun.sleep(20);
                return { id: "synthetic-message-ref" };
            } }) });
    try {
        worker.notify();
        await worker.drain();
        await worker.stop();
        console.log("DISPATCH_DONE");
    }
    finally {
        store.close();
    }
}
