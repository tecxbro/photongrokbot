import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixture, batch } from "./tests/storage/fixture.ts";
import type { Submission } from "./contracts.ts";
export function deliveryFixture(options: Parameters<typeof fixture>[0] = {}) {
    if (process.env.PHOTON_TEST_MODE !== "1")
        throw new Error("TEST_GUARD_REQUIRED");
    const f = fixture(options);
    const context = batch(f.store);
    return { ...f, ...context, submission(payload: Submission["payload"], actionKey: string = crypto.randomUUID(), purpose: Submission["purpose"] = "final"): Submission { return { version: 1, batchId: context.batch.batchId, claim: context.claim, actionKey, purpose, payload }; }, asset(name = `${crypto.randomUUID()}.jpg`) { const path = join(f.paths.outboundAssetsDir, name); writeFileSync(path, Buffer.from([255, 216, 0, 255, 217]), { mode: 0o600 }); return path; } };
}
