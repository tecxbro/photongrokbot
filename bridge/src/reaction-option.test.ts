import { test, expect } from "bun:test";
import { deliveryFixture } from "./delivery-fixture.ts";
import { openStore } from "./storage.ts";
import { batch } from "./tests/storage/fixture.ts";
import { submitOutbound } from "./submit.ts";
import { formatChildId, parseChildTargetId, buildAttachmentGroupParts, resolveReactionOption, applyResolvedOptionToInbound, formatOptionSelection, optionSelectionActionKey, optionNamesFromParts } from "./reaction-option.ts";
function presentation(f: ReturnType<typeof deliveryFixture>) { const paths = Array.from({ length: 5 }, () => f.asset()); const cards = paths.map((_, i) => ({ optionId: `id-${i}`, title: `Title ${i}`, details: `Detailed description ${i}`, url: `https://example.test/original/${i}?original=1`, ...(i === 2 ? { price: "$42", priceQualifier: "per night" } : {}) })); const items = f.store.enqueue({ kind: "attachment_group", spaceId: f.destination.spaceId, attachmentPaths: paths, cards, batchId: f.batch.batchId }, { destination: f.destination, claim: f.claim, actionKey: "cards", purpose: "final" }); const c = f.store.claimOutbound()!; f.store.settleOutbound(c.item.id, c.attemptId, { state: "accepted", evidence: "synthetic-returned-reference", reference: { messageId: "parent-guid", parts: buildAttachmentGroupParts({ parentMessageId: "parent-guid", paths, cards }) } }); return { items, paths, cards }; }
test("child IDs roundtrip and malformed/unsafe indexes rejected", () => { expect(parseChildTargetId(formatChildId(2, "parent"))).toEqual({ partIndex: 2, parentGuid: "parent" }); for (const s of ["parent", "p:-1/parent", "p:1/", "p:99999999999999999999/x", "p:01/x"])
    expect(parseChildTargetId(s)).toBeNull(); expect(() => buildAttachmentGroupParts({ parentMessageId: "p", paths: ["a", "b"], cards: [{ title: "one" }] })).toThrow("CARD_ALIGNMENT_INVALID"); });
test("K04 parent/part mapping retained in canonical database and exact conversation/line", () => { const f = deliveryFixture(); try {
    presentation(f);
    const reopened = openStore({ paths: f.paths });
    try {
        const result = resolveReactionOption(reopened, f.destination, "p:2/parent-guid");
        expect(result.ambiguous).toBe(false);
        if (!result.ambiguous) {
            expect(result.title).toBe("Title 2");
            expect(result.price).toBe("$42");
            expect(result.url).toBe("https://example.test/original/2?original=1");
        }
        expect(resolveReactionOption(reopened, { ...f.destination, lineId: "other" }, "p:2/parent-guid").ambiguous).toBe(true);
        expect(resolveReactionOption(reopened, { ...f.destination, spaceId: "other" }, "p:2/parent-guid").ambiguous).toBe(true);
    }
    finally {
        reopened.close();
    }
}
finally {
    f.cleanup();
} });
test("K05 any added emoji returns same exact known details/price/original URL", () => { const f = deliveryFixture(); try {
    presentation(f);
    for (const emoji of ["❤️", "👎", "😂", "❓", "🔥"]) {
        const record = applyResolvedOptionToInbound({ ...f.batch.messages[0]!, kind: "reaction", reactionSelected: true, emoji, targetMessageId: "p:2/parent-guid" }, resolveReactionOption(f.store, f.destination, "p:2/parent-guid"));
        expect(formatOptionSelection(record)).toBe("Title 2\nDetailed description 2\n$42 per night\nhttps://example.test/original/2?original=1");
    }
}
finally {
    f.cleanup();
} });
test("K06 ambiguous asks once by stable action identity, removal not selection, no invented price", () => { const f = deliveryFixture(); try {
    presentation(f);
    const resolved = resolveReactionOption(f.store, f.destination, "parent-guid");
    expect(resolved.ambiguous).toBe(true);
    const one = applyResolvedOptionToInbound({ ...f.batch.messages[0]!, id: "reaction-one", kind: "reaction", targetMessageId: "parent-guid" }, resolved);
    const two = { ...one, id: "reaction-two" };
    expect(formatOptionSelection(one)).toContain("Which option");
    expect(optionSelectionActionKey(one)).toBe(optionSelectionActionKey(two));
    const removed = applyResolvedOptionToInbound({ ...one, reactionSelected: false }, resolveReactionOption(f.store, f.destination, "p:2/parent-guid"));
    expect(formatOptionSelection(removed)).toBeUndefined();
    const noPrice = applyResolvedOptionToInbound({ ...one, targetMessageId: "p:1/parent-guid" }, resolveReactionOption(f.store, f.destination, "p:1/parent-guid"));
    expect(noPrice.optionPrice).toBeUndefined();
    expect(formatOptionSelection(noPrice)).not.toContain("$");
    expect(resolveReactionOption(f.store, f.destination, "p:99/parent-guid").ambiguous).toBe(true);
    expect(resolveReactionOption(f.store, f.destination, "p:0/missing").ambiguous).toBe(true);
    expect(optionNamesFromParts([{ title: " A " }, { optionId: "id" }, {}])).toEqual(["A", "id"]);
}
finally {
    f.cleanup();
} });
test("incomplete/shifted map and missing option identity stay ambiguous", () => { const f = deliveryFixture(); try {
    presentation(f);
    const record = f.store.getMetadata<any>("presentation", f.batch.batchId);
    record.parts.splice(1, 1);
    f.store.setMetadata("presentation", f.batch.batchId, record);
    expect(resolveReactionOption(f.store, f.destination, "p:2/parent-guid").ambiguous).toBe(true);
    record.parts = [{ partIndex: 0, childId: "p:0/parent-guid", path: "test" }];
    f.store.setMetadata("presentation", f.batch.batchId, record);
    expect(resolveReactionOption(f.store, f.destination, "p:0/parent-guid").ambiguous).toBe(true);
}
finally {
    f.cleanup();
} });

test("ordinary reactions remain unchanged without known option presentation evidence", () => {
    const f = deliveryFixture();
    try {
        for (const target of [undefined, "ordinary-message", "p:0/ordinary-group"]) {
            const inbound = { ...f.batch.messages[0]!, kind: "reaction" as const, emoji: "❤️", targetMessageId: target };
            const applied = applyResolvedOptionToInbound(inbound, resolveReactionOption(f.store, f.destination, target));
            expect(applied).toBe(inbound);
            expect(Object.hasOwn(applied, "optionAmbiguous")).toBe(false);
            expect(formatOptionSelection(applied)).toBeUndefined();
        }
        presentation(f);
        const ordinary = f.store.getMetadata<any>("presentation", f.batch.batchId);
        ordinary.parts = ordinary.parts.map(({ partIndex, path, childId }: {partIndex: number; path: string; childId: string}) => ({ partIndex, path, childId }));
        f.store.setMetadata("presentation", f.batch.batchId, ordinary);
        const inbound = { ...f.batch.messages[0]!, kind: "reaction" as const, emoji: "😂", targetMessageId: "p:0/parent-guid" };
        expect(applyResolvedOptionToInbound(inbound, resolveReactionOption(f.store, f.destination, inbound.targetMessageId))).toBe(inbound);
    } finally { f.cleanup(); }
});

test("K06 distinct ambiguous option reactions each receive their own clarification", async () => {
    const f = deliveryFixture();
    try {
        presentation(f);
        const ids: string[] = [];
        for (const emoji of ["❤️", "👎"]) {
            const context = batch(f.store, f.destination.spaceId);
            const record = applyResolvedOptionToInbound({ ...context.batch.messages[0]!, kind: "reaction", emoji, targetMessageId: "parent-guid" }, resolveReactionOption(f.store, f.destination, "parent-guid"));
            const statuses = await submitOutbound({ version: 1, batchId: context.batch.batchId, claim: context.claim, purpose: "final", actionKey: optionSelectionActionKey(record), payload: { kind: "text", spaceId: context.destination.spaceId, text: formatOptionSelection(record)! } }, f);
            ids.push(statuses[0]!.id);
        }
        expect(ids[0]).not.toBe(ids[1]);
        expect(f.store.listOutbound()).toHaveLength(3); // Original card group and one clarification per new request.
    } finally { f.cleanup(); }
});
