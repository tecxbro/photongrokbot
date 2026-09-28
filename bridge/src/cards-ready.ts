import { createHash } from "node:crypto";
import { canonical } from "./storage.contract.ts";
import { resolveInstancePaths } from "../../shared/instance-paths.mjs";
import type { BridgeStore, Destination, OutboundStatus, Submission } from "./contracts.ts";
import { authorizeArtifactPaths, authorizeSubmission } from "./authorization.ts";
import { keys, object, parseSubmission, string, submitOutbound } from "./submit.ts";
export const MIN_STACK_CARDS = 4;
export const CARDS_STABLE_MS = 12000;
export type CardsReadyMarker = {
    submission: Submission;
    expectedCount: number;
    revision: string;
    readyAt: string;
};
export type ReadyStack = CardsReadyMarker;
export function cardsActionKey(batchId: string, revision: string): string { if (!batchId || !revision || revision.length > 120)
    throw new Error("CARD_REVISION_INVALID"); return `cards:${batchId}:${revision}`; }
export function parseCardsReadyMarker(raw: unknown): CardsReadyMarker {
    const row = object(raw);
    keys(row, ["submission", "expectedCount", "revision", "readyAt"]);
    string(row.revision, 120);
    string(row.readyAt, 64);
    if (!Number.isFinite(Date.parse(row.readyAt as string)))
        throw new Error("CARD_READY_TIME_INVALID");
    const marker = { ...row, submission: parseSubmission(row.submission) } as CardsReadyMarker;
    validateMarker(marker);
    return marker;
}
function validateMarker(marker: CardsReadyMarker): Submission {
    const submission = parseSubmission(marker.submission);
    if (submission.payload.kind !== "attachment_group" || submission.purpose !== "final" || submission.payload.batchId !== submission.batchId || submission.actionKey !== cardsActionKey(submission.batchId, marker.revision))
        throw new Error("CARD_CONTEXT_INVALID");
    if (!Number.isInteger(marker.expectedCount) || marker.expectedCount < MIN_STACK_CARDS || marker.expectedCount !== submission.payload.attachmentPaths.length || !submission.payload.cards || submission.payload.cards.length !== marker.expectedCount)
        throw new Error("CARD_ALIGNMENT_INVALID");
    return submission;
}
export function writeCardsReadyMarker(marker: CardsReadyMarker, store: BridgeStore): string {
    marker = parseCardsReadyMarker(marker);
    const inputRevision = store.assertWork(marker.submission.claim, marker.submission.inputRevision);
    marker = {...marker, submission: {...marker.submission, inputRevision, optionSetRevision: marker.revision}};
    const submission = marker.submission;
    const destination = authorizeSubmission(submission, store);
    const key = JSON.stringify([destination.spaceId, destination.lineId, submission.actionKey]);
    const existing = store.getMetadata<CardsReadyMarker>("cards-ready-pending", key);
    // Claim leases and producer timing may refresh; the logical payload cannot.
    const logical = ({ submission: { claim: _claim, ...submission }, readyAt: _readyAt, ...rest }: CardsReadyMarker) => ({ ...rest, submission: {...submission, inputRevision: submission.inputRevision ?? 1, optionSetRevision: submission.optionSetRevision ?? rest.revision} });
    if (existing && canonical(logical(existing)) !== canonical(logical(marker)))
        throw new Error("CARD_MARKER_CONFLICT");
    const scopeKey = canonical([submission.batchId, inputRevision, marker.revision, destination]);
    const payloadHash = createHash("sha256").update(canonical(submission.payload)).digest("hex");
    const registered = store.getMetadata<{payloadHash:string}>("option-set-context", scopeKey);
    if (registered && registered.payloadHash !== payloadHash) throw new Error("CARD_MARKER_CONFLICT");
    store.setMetadata("option-set-context", scopeKey, {payloadHash});
    store.setMetadata("cards-ready-pending", key, marker);
    return key;
}
export function readCardsReadyMarker(key: string, store: BridgeStore): CardsReadyMarker | null { return store.getMetadata<CardsReadyMarker>("cards-ready-pending", key) ?? null; }
export function outboundAlreadyCoversBatch(store: BridgeStore, destination: Destination, batchId: string, revision: string, inputRevision = store.readBatch(batchId).inputRevision ?? 1): OutboundStatus[] {
    if (!store.getMetadata("option-set-context", canonical([batchId, inputRevision, revision, destination]))) return [];
    return store.operationStatus(destination, "final", cardsActionKey(batchId, revision), {batchId, inputRevision, optionSetRevision: revision});
}
export function assetsAreComplete(opts: {
    paths: string[];
    expectedCount?: number;
    newestMtimeMs: number;
    nowMs?: number;
    stableMs?: number;
    minCards?: number;
}): boolean {
    return opts.paths.length >= (opts.minCards ?? MIN_STACK_CARDS) && opts.expectedCount !== undefined && opts.paths.length === opts.expectedCount && opts.newestMtimeMs > 0 && (opts.nowMs ?? Date.now()) - opts.newestMtimeMs >= (opts.stableMs ?? CARDS_STABLE_MS);
}
export type CardsOptions = {
    store: BridgeStore;
    paths?: ReturnType<typeof resolveInstancePaths>;
    signal?: AbortSignal;
    maxPerTick?: number;
};
const pendingCursors = new WeakMap<BridgeStore, string>();
export async function findReadyImageStacks(opts: CardsOptions): Promise<Array<ReadyStack & {
    pendingKey: string;
}>> {
    const limit = opts.maxPerTick ?? 4;
    if (!Number.isInteger(limit) || limit < 1 || limit > 16)
        throw new Error("CARD_TICK_LIMIT_INVALID");
    const ready: Array<ReadyStack & {
        pendingKey: string;
    }> = [];
    // Advance past blocked rows, inspecting a bounded page per tick. The cursor
    // is only scheduling state: each operation and marker remains durable in DB.
    const after = pendingCursors.get(opts.store);
    let page = opts.store.listMetadata<CardsReadyMarker>("cards-ready-pending", limit, after);
    if (page.length === 0 && after !== undefined)
        page = opts.store.listMetadata<CardsReadyMarker>("cards-ready-pending", limit);
    if (page.length)
        pendingCursors.set(opts.store, page.at(-1)!.key);
    else
        pendingCursors.delete(opts.store);
    for (const { key, value } of page) {
        opts.signal?.throwIfAborted();
        try {
            const submission = validateMarker(value);
            authorizeSubmission(submission, opts.store);
            authorizeArtifactPaths(opts.paths ?? resolveInstancePaths(), submission.payload);
            ready.push({ ...value, pendingKey: key });
        }
        catch { /* Missing or unsafe file: keep original metadata/order pending. */ }
    }
    return ready;
}
export async function finalEnqueueReadyStack(stack: ReadyStack, opts: CardsOptions): Promise<{
    outboundIds: string[];
    statuses: OutboundStatus[];
}> {
    const pendingKey = writeCardsReadyMarker({submission: stack.submission, expectedCount: stack.expectedCount, revision: stack.revision, readyAt: stack.readyAt}, opts.store);
    const submission = validateMarker(opts.store.getMetadata<CardsReadyMarker>("cards-ready-pending", pendingKey)!);
    const statuses = await submitOutbound(submission, opts);
    return { outboundIds: statuses.map((s) => s.id), statuses };
}
export async function drainCardsReady(opts: CardsOptions): Promise<number> {
    let count = 0;
    for (const stack of await findReadyImageStacks(opts)) {
        opts.signal?.throwIfAborted();
        try {
            await finalEnqueueReadyStack(stack, opts);
            opts.store.deleteMetadata("cards-ready-pending", stack.pendingKey);
            count++;
        }
        catch {
            if (opts.signal?.aborted)
                throw opts.signal.reason; /* Keep recoverable pending context. */
        }
    }
    return count;
}
