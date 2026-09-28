import { test, expect } from "bun:test";
import { writeFileSync, symlinkSync, mkdirSync, mkdtempSync, realpathSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deliveryFixture } from "./delivery-fixture.ts";
import { submitOutbound, parseSubmission, type SubmitOptions } from "./submit.ts";
import { parseLegacyArgs } from "./enqueue.ts";
import { stageOutboundFile } from "./authorization.ts";
import { batch as createClaimedBatch } from "./tests/storage/fixture.ts";
test("X01/X02 stored destination, claim generation and target gate submission", async () => {
    const f = deliveryFixture();
    try {
        const valid = f.submission({ spaceId: f.destination.spaceId, text: "ok" });
        await expect(submitOutbound({ ...valid, payload: { ...valid.payload, spaceId: "another-space" } }, f)).rejects.toThrow("DESTINATION_MISMATCH");
        await expect(submitOutbound({ ...valid, claim: { ...valid.claim, generation: 999 } }, f)).rejects.toThrow();
        for (const kind of ["reply", "react", "app_update"] as const) {
            const payload = kind === "reply" ? { kind, spaceId: f.destination.spaceId, targetMessageId: "elsewhere", text: "hi" } : kind === "react" ? { kind, spaceId: f.destination.spaceId, targetMessageId: "elsewhere", emoji: "❤️" } : { kind, spaceId: f.destination.spaceId, targetMessageId: "elsewhere", url: "https://example.test/app" };
            await expect(submitOutbound(f.submission(payload), f)).rejects.toThrow("TARGET_CONTEXT_MISMATCH");
        }
        expect(f.store.listOutbound()).toHaveLength(0);
    }
    finally {
        f.cleanup();
    }
});
test("X03 every original staged path validated before any conversion", async () => { const f = deliveryFixture(); try {
    let conversions = 0;
    const secret = join(f.paths.secretsDir, "bridge.env");
    writeFileSync(secret, "SYNTHETIC_SECRET", { mode: 0o600 });
    const link = join(f.paths.outboundAssetsDir, "linked.png");
    symlinkSync(secret, link);
    const dir = join(f.paths.outboundAssetsDir, "directory.png");
    mkdirSync(dir, { mode: 0o700 });
    const valid = f.asset();
    for (const path of [secret, link, dir, join(f.paths.outboundAssetsDir, "..", "secrets", "x")]) {
        await expect(submitOutbound(f.submission({ kind: "attachment_group", spaceId: f.destination.spaceId, attachmentPaths: [valid, path] }), { ...f, normalize: async (input) => { conversions++; return input; } })).rejects.toThrow();
    }
    expect(conversions).toBe(0);
    expect(f.store.listOutbound()).toHaveLength(0);
}
finally {
    f.cleanup();
} });
test("source and task revision mismatches reject before attachment normalization can create side effects", async () => {
    const f = deliveryFixture();
    try {
        let conversions = 0;
        const options: SubmitOptions = { ...f, normalize: async (input) => { conversions++; return input; } };
        const original = f.submission({ kind: "attachment_group", spaceId: f.destination.spaceId, attachmentPaths: [f.asset(), f.asset()] }, "revision-boundary");
        const revision = f.store.readBatch(f.batch.batchId).inputRevision!;
        await expect(submitOutbound({ ...original, inputRevision: revision + 1 }, options)).rejects.toThrow("STALE_INPUT_REVISION");
        const task = { taskId: "local-revision-boundary", batchId: f.batch.batchId, destination: f.destination, owner: "worker", finalOwner: "front-door", state: "intent" as const };
        f.store.bindTask(f.claim, task);
        f.store.bindTask(f.claim, { ...task, state: "accepted", nativeRef: "native-after-intent", receipt: "native invocation accepted" });
        const taskInputRevision = f.store.getTask(task.taskId)!.inputs![0]!.inputRevision;
        const permitted = { ...original, inputRevision: revision, taskId: task.taskId, taskInputRevision };
        await expect(submitOutbound({ ...permitted, taskInputRevision: taskInputRevision + 1 }, options)).rejects.toThrow("TASK_CONTEXT_MISMATCH");
        await expect(submitOutbound({ ...original, taskInputRevision }, options)).rejects.toThrow("TASK_CONTEXT_MISMATCH");
        const unrelated = createClaimedBatch(f.store, f.destination.spaceId);
        await expect(submitOutbound({ ...permitted, batchId: unrelated.batch.batchId, claim: unrelated.claim }, options)).rejects.toThrow("TASK_CONTEXT_MISMATCH");
        await expect(submitOutbound({ ...permitted, claim: unrelated.claim }, options)).rejects.toThrow("CLAIM_BATCH_MISMATCH");
        await expect(submitOutbound({ ...permitted, scope: "caller-authored-scope" }, options)).rejects.toThrow("UNKNOWN_FIELD");
        expect(conversions).toBe(0);
        expect(f.store.listOutbound()).toHaveLength(0);
        expect(await submitOutbound(permitted, options)).toHaveLength(1);
        expect(conversions).toBe(1);
    }
    finally { f.cleanup(); }
});
test("X04/X05 strict JSON and legacy context preserve shell text as data", async () => {
    const f = deliveryFixture();
    try {
        const s = f.submission({ spaceId: f.destination.spaceId, text: '$(touch no) `echo hi` "quoted"' });
        for (const extra of [{ authorized: true }, { role: "Front Door" }, { lineId: "another" }])
            expect(() => parseSubmission({ ...s, ...extra })).toThrow("UNKNOWN_FIELD");
        expect(() => parseSubmission({ ...s, payload: { ...s.payload, effect: "disco" } })).toThrow();
        expect(() => parseLegacyArgs(["--space-id", "space", "--text", "hi"])).toThrow("FENCED_CONTEXT_REQUIRED");
        const flags = ["--space-id", f.destination.spaceId, "--batch-id", s.batchId, "--run-id", s.claim.runId, "--generation", String(s.claim.generation), "--action-key", "key", "--purpose", "final"];
        for (const args of [["--voice", "file", "--text", "x", "--effect", "confetti"], ["--text", "hi", "--unknown", "x"], ["--text"], ["--text", "a", "--text", "b"]])
            expect(() => parseLegacyArgs([...flags, ...args])).toThrow();
        const parsed = parseLegacyArgs([...flags, "--text", s.payload.kind === undefined ? s.payload.text : "unexpected"]);
        const result = await submitOutbound(parsed, f);
        expect(result).toHaveLength(1);
        expect((f.store.listOutbound()[0] as {
            text: string;
        }).text).toBe(s.payload.kind === undefined ? s.payload.text : "unexpected");
    }
    finally {
        f.cleanup();
    }
});
test("same action/payload reuses ids; changed payload conflicts", async () => { const f = deliveryFixture(); try {
    const s = f.submission({ spaceId: f.destination.spaceId, text: "one" }, "stable");
    const first = await submitOutbound(s, f);
    expect(await submitOutbound(s, f)).toEqual(first);
    await expect(submitOutbound({ ...s, payload: { spaceId: f.destination.spaceId, text: "two" } }, f)).rejects.toThrow("ACTION_PAYLOAD_CONFLICT");
    expect(f.store.listOutbound()).toHaveLength(1);
}
finally {
    f.cleanup();
} });
test("operator staging rejects private secrets and creates no send authority", async () => { const f = deliveryFixture(); try {
    const p = join(f.paths.secretsDir, "private");
    writeFileSync(p, "secret", { mode: 0o600 });
    await expect(stageOutboundFile(p, f.paths)).rejects.toThrow("STAGE_PRIVATE_INSTANCE_REJECTED");
    expect(f.store.listOutbound()).toHaveLength(0);
}
finally {
    f.cleanup();
} });
test("task-card URL cannot bypass canonical original-task presentation binding", async () => {
    const f = deliveryFixture();
    try {
        const origin = "https://cards.example.test";
        const url = `${origin}/live-1/card-1?k=synthetic-capability`;
        f.store.setMetadata("live-mini-host", "configured", { origin });
        await expect(submitOutbound(f.submission({ kind: "app", spaceId: f.destination.spaceId, url, live: true }), f)).rejects.toThrow("TASK_CARD_PRESENTATION_REQUIRED");
        const binding = { taskId: "task-1", batchId: f.batch.batchId, destination: f.destination, owner: "executor", finalOwner: "executor", state: "intent" as const };
        f.store.bindTask(f.claim, binding);
        f.store.bindTask(f.claim, { ...binding, state: "accepted", receipt: "synthetic-native-receipt" });
        f.store.registerPresentation(f.claim, { cardId: "card-1", taskId: "task-1", batchId: f.batch.batchId, destination: f.destination, viewUrl: url });
        const valid = { ...f.submission({ kind: "app", spaceId: f.destination.spaceId, url, live: true }, "present", "presentation"), taskId: "task-1", presentation: { cardId: "card-1", taskId: "task-1", viewUrl: url, claimId: "host-claim-1" } };
        const ids = await submitOutbound(valid, f);
        expect(f.store.getMetadata("presentation-submission", ids[0]!.id)).toBeDefined();
        expect(await submitOutbound(valid, f)).toEqual(ids);
    const accepted = f.store.claimOutbound()!;
    f.store.settleOutbound(accepted.item.id, accepted.attemptId, { state: "accepted", evidence: "synthetic-app-reference", reference: { messageId: "task-app-message", miniAppCardSession: { chatGuid:f.destination.spaceId,messageGuid:"task-app-message",sessionId:"session",targetMessageGuid:"task-app-message" } } });
    await expect(submitOutbound(f.submission({kind:"app_update",spaceId:f.destination.spaceId,targetMessageId:"task-app-message",url:"https://unrelated.example.test/static"}),f)).rejects.toThrow("TASK_CARD_JSON_UPDATES_ONLY");
        await expect(submitOutbound({ ...valid, actionKey: "edit-bypass", payload: { kind: "app_update", spaceId: f.destination.spaceId, targetMessageId: "task-app-message", url, live: true } }, f)).rejects.toThrow("TASK_CARD_JSON_UPDATES_ONLY");
        await expect(submitOutbound({ ...valid, actionKey: "second-card" }, f)).rejects.toThrow("TASK_CARD_OPERATION_CONFLICT");
        await expect(submitOutbound({ ...valid, actionKey: "changed-claim", presentation: { ...valid.presentation, claimId: "second-host-claim" } }, f)).rejects.toThrow("TASK_CARD_OPERATION_CONFLICT");
        await expect(submitOutbound({ ...valid, payload: { ...valid.payload, live: false } }, f)).rejects.toThrow();
        expect(f.store.listOutbound()).toHaveLength(1);
        await expect(submitOutbound({ ...valid, presentation: { ...valid.presentation, claimId: "changed" } }, f)).rejects.toThrow();
        await expect(submitOutbound({ ...valid, actionKey: "wrong", payload: { ...valid.payload, url: `${url}-changed` } }, f)).rejects.toThrow("TASK_CARD_CONTEXT_MISMATCH");
        f.store.setMetadata("live-mini-host", "configured", { origin: "https://new-host.example.test" });
        await expect(submitOutbound(f.submission({ kind: "app", spaceId: f.destination.spaceId, url }), f)).rejects.toThrow("TASK_CARD_PRESENTATION_REQUIRED");
        expect(await submitOutbound(f.submission({ kind: "app", spaceId: f.destination.spaceId, url: "https://unrelated.example.test/static" }), f)).toHaveLength(1);
        const staticCard = f.store.claimOutbound()!;
        f.store.settleOutbound(staticCard.item.id, staticCard.attemptId, { state: "accepted", evidence: "synthetic-static-app", reference: { messageId: "static-app-message", miniAppCardSession: { chatGuid: f.destination.spaceId, messageGuid: "static-app-message", sessionId: "static-session", targetMessageGuid: "static-app-message" } } });
        expect(await submitOutbound(f.submission({ kind: "app_update", spaceId: f.destination.spaceId, targetMessageId: "static-app-message", url: "https://unrelated.example.test/static-updated" }), f)).toHaveLength(1);
    }
    finally {
        f.cleanup();
    }
});
test("explicit operator staging creates a private artifact usable only with claim", async () => { const f = deliveryFixture(); const sourceRoot = mkdtempSync(join(realpathSync(tmpdir()), "photon-stage-source-")); try {
    const source = join(sourceRoot, "report.pdf");
    writeFileSync(source, "synthetic report");
    const staged = await stageOutboundFile(source, f.paths);
    expect(staged.startsWith(f.paths.outboundAssetsDir)).toBe(true);
    expect(readFileSync(staged, "utf8")).toBe("synthetic report");
    expect(await submitOutbound(f.submission({ spaceId: f.destination.spaceId, text: "report", attachmentPath: staged }), f)).toHaveLength(2);
}
finally {
    rmSync(sourceRoot, { recursive: true, force: true });
    f.cleanup();
} });
