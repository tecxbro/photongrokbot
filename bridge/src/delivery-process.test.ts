import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deliveryFixture } from "./delivery-fixture.ts";
import { submitOutbound } from "./submit.ts";
const cli = fileURLToPath(new URL("./enqueue.ts", import.meta.url));
const child = fileURLToPath(new URL("./delivery-process-fixture.ts", import.meta.url));
function spawn(root: string, argv: string[], stdin?: unknown) { return Bun.spawn([process.execPath, ...argv], { env: { PATH: process.env.PATH, PHOTON_TEST_MODE: "1", PHOTON_INSTANCE_DIR: root }, stdin: stdin === undefined ? "ignore" : Buffer.from(JSON.stringify(stdin)), stdout: "pipe", stderr: "pipe" }); }
async function result(proc: ReturnType<typeof spawn>) { const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]); return { code, out, err }; }
test("O01/X04 two separate JSON CLI processes atomically enqueue same operation", async () => { const f = deliveryFixture(); try {
    const submission = f.submission({ spaceId: f.destination.spaceId, text: 'literal $(touch nope) `echo nope`' }, "process-key");
    const [one, two] = await Promise.all([result(spawn(f.root, [cli, "--json-stdin"], submission)), result(spawn(f.root, [cli, "--json-stdin"], submission))]);
    expect(one.code).toBe(0);
    expect(two.code).toBe(0);
    expect(JSON.parse(one.out).items[0].id).toBe(JSON.parse(two.out).items[0].id);
    expect(f.store.listOutbound()).toHaveLength(1);
    expect(one.out).not.toContain("literal");
    const invalid = await result(spawn(f.root, [cli, "--json-stdin", "--text", "extra"], submission));
    expect(invalid.code).not.toBe(0);
    expect(invalid.err.trim()).toBe("OUTBOUND_SUBMISSION_REJECTED");
}
finally {
    f.cleanup();
} });
test("O01 two dispatch processes cannot emit one provider operation twice", async () => { const f = deliveryFixture(); try {
    await submitOutbound(f.submission({ spaceId: f.destination.spaceId, text: "one" }), f);
    const [one, two] = await Promise.all([result(spawn(f.root, [child, "dispatch"])), result(spawn(f.root, [child, "dispatch"]))]);
    expect(one.code).toBe(0);
    expect(two.code).toBe(0);
    expect(readFileSync(join(f.paths.logsDir, "synthetic-provider-calls"), "utf8")).toBe("one\n");
    expect(f.store.listOutbound()[0]!.status).toBe("accepted");
}
finally {
    f.cleanup();
} });
test("O04 SIGKILL after fake provider effect leaves sending, recovery unknown never replays", async () => { const f = deliveryFixture(); try {
    const ids = await submitOutbound(f.submission({ spaceId: f.destination.spaceId, text: "one" }), f);
    const crashed = await result(spawn(f.root, [child, "crash-after-send"]));
    expect(crashed.code).not.toBe(0);
    expect(f.store.outboundStatus(ids[0]!.id)?.state).toBe("sending");
    expect(f.store.recoverSending()).toBe(1);
    expect(f.store.outboundStatus(ids[0]!.id)?.state).toBe("unknown");
    const next = await result(spawn(f.root, [child, "dispatch"]));
    expect(next.code).toBe(0);
    expect(readFileSync(join(f.paths.logsDir, "synthetic-provider-calls"), "utf8")).toBe("one\n");
}
finally {
    f.cleanup();
} });

test("cards-ready JSON CLI writes validated durable intent and rejects extra fields or flags", async () => {
    const f = deliveryFixture();
    try {
        const paths = Array.from({ length: 5 }, () => f.asset());
        const marker = {
            submission: f.submission({ kind: "attachment_group", spaceId: f.destination.spaceId,
                batchId: f.batch.batchId, attachmentPaths: paths,
                cards: paths.map((_, i) => ({ optionId: `option-${i}` })) }, `cards:${f.batch.batchId}:v1`),
            expectedCount: 5, revision: "v1", readyAt: new Date().toISOString(),
        };
        const ok = await result(spawn(f.root, [cli, "--cards-ready", "--json-stdin"], marker));
        expect(ok.code).toBe(0);
        expect(JSON.parse(ok.out)).toEqual({ state: "pending", expectedCount: 5 });
        expect(f.store.listMetadata("cards-ready-pending")).toHaveLength(1);
        expect(f.store.listOutbound()).toHaveLength(0);
        const bad = await result(spawn(f.root, [cli, "--cards-ready", "--json-stdin"], { ...marker, authorized: true }));
        expect(bad.code).not.toBe(0);
        expect(bad.err.trim()).toBe("OUTBOUND_SUBMISSION_REJECTED");
        const flags = await result(spawn(f.root, [cli, "--cards-ready", "--json-stdin", "--live"], marker));
        expect(flags.code).not.toBe(0);
    } finally { f.cleanup(); }
});
