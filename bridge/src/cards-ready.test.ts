import { test, expect } from "bun:test";
import { unlinkSync, writeFileSync } from "node:fs";
import { deliveryFixture } from "./delivery-fixture.ts";
import { batch } from "./tests/storage/fixture.ts";
import { assetsAreComplete, cardsActionKey, writeCardsReadyMarker, findReadyImageStacks, finalEnqueueReadyStack, drainCardsReady, outboundAlreadyCoversBatch, type CardsReadyMarker } from "./cards-ready.ts";
function marker(f: ReturnType<typeof deliveryFixture>, count = 5): CardsReadyMarker { const paths = Array.from({ length: count }, () => f.asset()); return { submission: f.submission({ kind: "attachment_group", spaceId: f.destination.spaceId, batchId: f.batch.batchId, attachmentPaths: paths, cards: paths.map((_, i) => ({ optionId: `option-${i}`, title: `Choice ${i}`, details: `Details ${i}` })) }, cardsActionKey(f.batch.batchId, "v1")), expectedCount: count, revision: "v1", readyAt: new Date().toISOString() }; }
test("K01 concurrent Front Door/watchdog inserts one logical grouped operation", async () => { const f = deliveryFixture(); try {
    const m = marker(f);
    writeCardsReadyMarker(m, f.store);
    const [front] = await Promise.all([finalEnqueueReadyStack(m, f), drainCardsReady(f)]);
    expect(front.outboundIds).toHaveLength(1);
    expect(f.store.listOutbound()).toHaveLength(1);
    expect(await findReadyImageStacks(f)).toHaveLength(0);
    expect(f.store.operationStatus(f.destination, "final", m.submission.actionKey, {batchId: f.batch.batchId, inputRevision: 1, optionSetRevision: "v1"})[0]!.id).toBe(front.outboundIds[0]!);
}
finally {
    f.cleanup();
} });
test("K02 exact operation states never equated to delivered by filenames", async () => { for (const state of ["unknown", "failed"] as const) {
    const f = deliveryFixture();
    try {
        const m = marker(f);
        const result = await finalEnqueueReadyStack(m, f);
        expect(outboundAlreadyCoversBatch(f.store, f.destination, f.batch.batchId, "v1")[0]!.state).toBe("queued");
        const claimed = f.store.claimOutbound()!;
        f.store.settleOutbound(claimed.item.id, claimed.attemptId, { state, code: "test-evidence" });
        writeCardsReadyMarker(m, f.store);
        await drainCardsReady(f);
        expect(f.store.listOutbound()).toHaveLength(1);
        expect(outboundAlreadyCoversBatch(f.store, f.destination, f.batch.batchId, "v1")[0]!.state).toBe(state);
        expect(outboundAlreadyCoversBatch(f.store, f.destination, f.batch.batchId, "v2")).toEqual([]);
    }
    finally {
        f.cleanup();
    }
} });
test("K03 missing middle card waits without shifting metadata; complete five remains group", async () => { const f = deliveryFixture(); try {
    const m = marker(f);
    if (m.submission.payload.kind !== "attachment_group")
        throw new Error("fixture");
    const middle = m.submission.payload.attachmentPaths[2]!;
    unlinkSync(middle);
    writeCardsReadyMarker(m, f.store);
    expect(await findReadyImageStacks(f)).toHaveLength(0);
    expect(await drainCardsReady(f)).toBe(0);
    expect(f.store.listOutbound()).toHaveLength(0);
    writeFileSync(middle, Buffer.from([255, 216, 0, 255, 217]), { mode: 0o600 });
    expect(await drainCardsReady(f)).toBe(1);
    const item = f.store.listOutbound()[0]!;
    expect(item.kind).toBe("attachment_group");
    if (item.kind === "attachment_group") {
        expect(item.attachmentPaths).toHaveLength(5);
        expect(item.cards?.[2]?.title).toBe("Choice 2");
    }
}
finally {
    f.cleanup();
} });
test("card metadata/count conflicts fail closed; stability helper requires exact expected count", async () => { const f = deliveryFixture(); try {
    const m = marker(f);
    expect(() => writeCardsReadyMarker({ ...m, expectedCount: 4 }, f.store)).toThrow("CARD_ALIGNMENT_INVALID");
    expect(() => writeCardsReadyMarker({ ...m, submission: { ...m.submission, actionKey: "random" } }, f.store)).toThrow("CARD_CONTEXT_INVALID");
    expect(assetsAreComplete({ paths: ["a", "b", "c", "d"], expectedCount: 5, newestMtimeMs: 1, nowMs: 20000 })).toBe(false);
    expect(assetsAreComplete({ paths: ["a", "b", "c", "d"], expectedCount: 4, newestMtimeMs: 1, nowMs: 20000 })).toBe(true);
}
finally {
    f.cleanup();
} });
test("historical completed markers do not block pending kind enumeration", async () => { const f = deliveryFixture(); try {
    for (let i = 0; i < 1005; i++)
        f.store.setMetadata("cards-ready-completed", String(i), { done: true });
    const m = marker(f);
    writeCardsReadyMarker(m, f.store);
    expect(await drainCardsReady(f)).toBe(1);
    expect(f.store.listMetadata("cards-ready-pending")).toEqual([]);
}
finally {
    f.cleanup();
} });

test("bounded watchdog pages past four blocked conversations and wraps fairly", async () => {
    const f = deliveryFixture();
    try {
        for (let i = 0; i < 5; i++) {
            const context = batch(f.store, `fair-space-${i}`);
            const paths = Array.from({ length: 4 }, () => f.asset());
            const m: CardsReadyMarker = {
                submission: {
                    version: 1, batchId: context.batch.batchId, claim: context.claim,
                    purpose: "final", actionKey: cardsActionKey(context.batch.batchId, "v1"),
                    payload: { kind: "attachment_group", spaceId: context.destination.spaceId,
                        batchId: context.batch.batchId, attachmentPaths: paths,
                        cards: paths.map((_, n) => ({ optionId: `option-${n}` })) },
                }, expectedCount: 4, revision: "v1", readyAt: new Date().toISOString(),
            };
            if (i < 4) unlinkSync(paths[1]!);
            writeCardsReadyMarker(m, f.store);
        }
        expect(await drainCardsReady(f)).toBe(0);
        expect(await drainCardsReady(f)).toBe(1);
        expect(f.store.listOutbound()[0]!.spaceId).toBe("fair-space-4");
        expect(await drainCardsReady(f)).toBe(0);
        expect(f.store.listMetadata("cards-ready-pending")).toHaveLength(4);
    } finally { f.cleanup(); }
});

test("semantic marker replay refreshes current claim and time but rejects changed payload and stale claim", async () => {
    const f = deliveryFixture();
    try {
        const m = marker(f);
        const key = writeCardsReadyMarker(m, f.store);
        // Metadata persistence canonicalizes object keys; producer key order is irrelevant.
        expect(writeCardsReadyMarker({ readyAt: m.readyAt, revision: m.revision, expectedCount: m.expectedCount, submission: m.submission }, f.store)).toBe(key);
        f.store.renewClaim(f.claim, 1);
        await Bun.sleep(10);
        const current = f.store.claimBatch(f.batch.batchId);
        if (current.status !== "acquired") throw new Error("claim fixture failed");
        const refreshed = { ...m, readyAt: new Date().toISOString(), submission: { ...m.submission, claim: current.token } };
        expect(writeCardsReadyMarker(refreshed, f.store)).toBe(key);
        expect(f.store.getMetadata<CardsReadyMarker>("cards-ready-pending", key)!.submission.claim).toEqual(current.token);
        expect(() => writeCardsReadyMarker(m, f.store)).toThrow("STALE_CLAIM");
        const originalPayload = refreshed.submission.payload;
        if (originalPayload.kind !== "attachment_group") throw new Error("fixture");
        expect(() => writeCardsReadyMarker({ ...refreshed, submission: { ...refreshed.submission, payload: { ...originalPayload, text: "changed" } } }, f.store)).toThrow("CARD_MARKER_CONFLICT");
        expect(await drainCardsReady(f)).toBe(1);
    } finally { f.cleanup(); }
});

test("preserved v1 pending card marker acquires its trusted scope and drains once", async () => {
    const f = deliveryFixture();
    try {
        const legacy = marker(f);
        // Schema v1 persisted this shape; the migration preserves metadata.
        expect(legacy.submission.inputRevision).toBeUndefined();
        expect(legacy.submission.optionSetRevision).toBeUndefined();
        const key = JSON.stringify([f.destination.spaceId, f.destination.lineId, legacy.submission.actionKey]);
        f.store.setMetadata("cards-ready-pending", key, legacy);
        expect(await drainCardsReady(f)).toBe(1);
        const original = f.store.listOutbound()[0]!;
        expect(outboundAlreadyCoversBatch(f.store, f.destination, f.batch.batchId, "v1").map(item => item.id)).toEqual([original.id]);
        // A producer with the old envelope still replays the migrated operation.
        const replay = await finalEnqueueReadyStack(legacy, f);
        expect(replay.outboundIds).toEqual([original.id]);
        expect(await drainCardsReady(f)).toBe(1);
        expect(f.store.listOutbound()).toHaveLength(1);
        expect(f.store.listMetadata("cards-ready-pending")).toEqual([]);
    } finally { f.cleanup(); }
});
