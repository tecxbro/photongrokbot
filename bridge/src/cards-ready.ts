import { stat } from "node:fs/promises";
import { resolveInstancePaths } from "../../shared/instance-paths.mjs";
import type { BridgeStore, Destination, OutboundStatus, Submission } from "./contracts.ts";
import { authorizeArtifactPaths, authorizeSubmission } from "./authorization.ts";
import { parseSubmission, submitOutbound } from "./submit.ts";

export const MIN_STACK_CARDS = 4;
export const CARDS_STABLE_MS = 12_000;
export type CardsReadyMarker = { submission: Submission; expectedCount: number; revision: string; readyAt: string };
export type ReadyStack = CardsReadyMarker;
export function cardsActionKey(batchId: string, revision: string): string { if (!batchId || !revision || revision.length > 120) throw new Error("CARD_REVISION_INVALID"); return `cards:${batchId}:${revision}`; }
function validateMarker(marker: CardsReadyMarker): Submission {
  const submission = parseSubmission(marker.submission);
  if (submission.payload.kind !== "attachment_group" || submission.purpose !== "final" || submission.payload.batchId !== submission.batchId || submission.actionKey !== cardsActionKey(submission.batchId, marker.revision)) throw new Error("CARD_CONTEXT_INVALID");
  if (!Number.isInteger(marker.expectedCount) || marker.expectedCount < MIN_STACK_CARDS || marker.expectedCount !== submission.payload.attachmentPaths.length || !submission.payload.cards || submission.payload.cards.length !== marker.expectedCount) throw new Error("CARD_ALIGNMENT_INVALID");
  return submission;
}
export function writeCardsReadyMarker(marker: CardsReadyMarker, store: BridgeStore): string {
  const submission = validateMarker(marker); const destination = authorizeSubmission(submission, store);
  const key = JSON.stringify([destination.spaceId,destination.lineId,submission.actionKey]);
  const existing = store.getMetadata<CardsReadyMarker>("cards-ready-pending", key);
  if (existing && JSON.stringify(existing) !== JSON.stringify(marker)) throw new Error("CARD_MARKER_CONFLICT");
  store.setMetadata("cards-ready-pending", key, marker); return key;
}
export function readCardsReadyMarker(key: string, store: BridgeStore): CardsReadyMarker | null { return store.getMetadata<CardsReadyMarker>("cards-ready-pending", key) ?? null; }
export function outboundAlreadyCoversBatch(store: BridgeStore, destination: Destination, batchId: string, revision: string): OutboundStatus[] { return store.operationStatus(destination, "final", cardsActionKey(batchId, revision)); }
export function assetsAreComplete(opts: { paths: string[]; expectedCount?: number; newestMtimeMs: number; nowMs?: number; stableMs?: number; minCards?: number }): boolean {
  return opts.paths.length >= (opts.minCards ?? MIN_STACK_CARDS) && opts.expectedCount !== undefined && opts.paths.length === opts.expectedCount && opts.newestMtimeMs > 0 && (opts.nowMs ?? Date.now()) - opts.newestMtimeMs >= (opts.stableMs ?? CARDS_STABLE_MS);
}
export type CardsOptions = { store: BridgeStore; paths?: ReturnType<typeof resolveInstancePaths>; signal?: AbortSignal; maxPerTick?: number };
export async function findReadyImageStacks(opts: CardsOptions): Promise<Array<ReadyStack & { pendingKey: string }>> {
  const limit = opts.maxPerTick ?? 4;
  if (!Number.isInteger(limit) || limit < 1 || limit > 16) throw new Error("CARD_TICK_LIMIT_INVALID");
  const ready: Array<ReadyStack & { pendingKey: string }> = [];
  for (const { key, value } of opts.store.listMetadata<CardsReadyMarker>("cards-ready-pending", limit)) {
    opts.signal?.throwIfAborted();
    try { const submission = validateMarker(value); authorizeSubmission(submission, opts.store); authorizeArtifactPaths(opts.paths ?? resolveInstancePaths(), submission.payload); ready.push({ ...value, pendingKey: key }); }
    catch { /* Missing or unsafe file: keep original metadata/order pending. */ }
  }
  return ready;
}
export async function finalEnqueueReadyStack(stack: ReadyStack, opts: CardsOptions): Promise<{ outboundIds: string[]; statuses: OutboundStatus[] }> {
  const submission = validateMarker(stack);
  const statuses = await submitOutbound(submission, opts);
  return { outboundIds: statuses.map((s) => s.id), statuses };
}
export async function drainCardsReady(opts: CardsOptions): Promise<number> {
  let count = 0;
  for (const stack of await findReadyImageStacks(opts)) {
    opts.signal?.throwIfAborted();
    try { await finalEnqueueReadyStack(stack, opts); opts.store.deleteMetadata("cards-ready-pending", stack.pendingKey); count++; }
    catch { if (opts.signal?.aborted) throw opts.signal.reason; /* Keep recoverable pending context. */ }
  }
  return count;
}
