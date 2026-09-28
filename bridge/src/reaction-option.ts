import type { BridgeStore, Destination } from "./contracts.ts";
import type { CardOptionMeta, InboundRecord, OutboundItem } from "./types.ts";

export function formatChildId(partIndex: number, parentGuid: string): string { if (!Number.isSafeInteger(partIndex) || partIndex < 0 || !parentGuid) throw new Error("PART_ID_INVALID"); return `p:${partIndex}/${parentGuid}`; }
export function parseChildTargetId(target: string): { partIndex: number; parentGuid: string } | null {
  const match = /^p:(0|[1-9]\d*)\/(.+)$/.exec(target);
  if (!match || !Number.isSafeInteger(Number(match[1]))) return null;
  return { partIndex: Number(match[1]), parentGuid: match[2]! };
}
export type PresentationPart = CardOptionMeta & { partIndex: number; path: string; childId: string };
export type PresentationRecord = { batchId: string; spaceId: string; lineId: string; messageId: string; outboundId?: string; savedAt: string; parts: PresentationPart[] };
export function optionNamesFromParts(parts: Array<{ title?: string; optionId?: string }>): string[] { return parts.map((p) => p.title?.trim() || p.optionId?.trim() || "").filter(Boolean); }
export function buildAttachmentGroupParts(opts: { parentMessageId: string; paths: string[]; cards?: CardOptionMeta[] }): PresentationPart[] {
  if (opts.cards && opts.cards.length !== opts.paths.length) throw new Error("CARD_ALIGNMENT_INVALID");
  return opts.paths.map((path, partIndex) => ({ ...opts.cards?.[partIndex], partIndex, path, childId: formatChildId(partIndex, opts.parentMessageId) }));
}
export function loadPresentationByBatchId(store: BridgeStore, destination: Destination, batchId: string): PresentationRecord | null {
  const record = store.getMetadata<PresentationRecord>("presentation", batchId);
  return record?.spaceId === destination.spaceId && record.lineId === destination.lineId ? record : null;
}
export function loadPresentationByMessageId(store: BridgeStore, destination: Destination, messageId: string): PresentationRecord | null {
  const index = store.getMetadata<{ batchId: string }>("presentation-index", messageId);
  if (!index) return null;
  const record = loadPresentationByBatchId(store, destination, index.batchId);
  return record?.messageId === messageId ? record : null;
}
export type ResolvedReactionOption = CardOptionMeta & { ambiguous: false; partIndex: number; parentMessageId: string; childId: string; path: string; batchId: string };
export type AmbiguousReactionOption = { ambiguous: true; optionNames: string[]; reason: string; partIndex?: number; parentMessageId?: string; childId?: string; batchId?: string };
export type ResolveReactionOptionResult = ResolvedReactionOption | AmbiguousReactionOption;
export function resolveReactionOption(store: BridgeStore, destination: Destination, target: string | undefined | null): ResolveReactionOptionResult {
  if (!target) return { ambiguous: true, optionNames: [], reason: "missing-target" };
  const parsed = parseChildTargetId(target);
  const parent = parsed?.parentGuid ?? target;
  const presentation = loadPresentationByMessageId(store, destination, parent);
  const common = { parentMessageId: parent, ...(parsed ? { partIndex: parsed.partIndex, childId: target } : {}), ...(presentation ? { batchId: presentation.batchId } : {}) };
  if (!presentation) return { ambiguous: true, optionNames: [], reason: "missing-presentation", ...common };
  if (!parsed) return { ambiguous: true, optionNames: optionNamesFromParts(presentation.parts), reason: "batch-only-target", ...common };
  // Require a complete, exact ordered map; never accept a shifted surviving subset.
  if (!presentation.parts.every((p, i) => p.partIndex === i && p.childId === formatChildId(i, parent))) return { ambiguous: true, optionNames: optionNamesFromParts(presentation.parts), reason: "incomplete-presentation", ...common };
  const part = presentation.parts[parsed.partIndex];
  if (!part || part.childId !== target || ![part.optionId, part.title, part.url].some((value) => value?.trim())) return { ambiguous: true, optionNames: optionNamesFromParts(presentation.parts), reason: part ? "part-missing-option-identity" : "part-out-of-range", ...common };
  return { ...part, ambiguous: false, parentMessageId: parent, batchId: presentation.batchId };
}
export function applyResolvedOptionToInbound(record: InboundRecord, resolved: ResolveReactionOptionResult): InboundRecord {
  if (record.kind !== "reaction" || record.reactionSelected === false) return record;
  if (resolved.ambiguous) return { ...record, optionAmbiguous: true, optionNames: resolved.optionNames, reactedPartIndex: resolved.partIndex, reactedParentMessageId: resolved.parentMessageId, reactedChildId: resolved.childId, optionBatchId: resolved.batchId };
  return { ...record, optionAmbiguous: false, reactedPartIndex: resolved.partIndex, reactedParentMessageId: resolved.parentMessageId, reactedChildId: resolved.childId, optionBatchId: resolved.batchId, optionId: resolved.optionId, optionTitle: resolved.title, optionUrl: resolved.url, optionCaption: resolved.caption, optionDetails: resolved.details, optionPrice: resolved.price, optionPriceQualifier: resolved.priceQualifier };
}
/** Emoji sentiment never changes option selection. Missing price stays absent. */
export function formatOptionSelection(record: InboundRecord): string | undefined {
  if (record.kind !== "reaction" || record.reactionSelected === false || !record.optionBatchId) return;
  if (record.optionAmbiguous) return `Which option did you mean?${record.optionNames?.length ? ` ${record.optionNames.join(" / ")}` : ""}`;
  return [record.optionTitle, record.optionDetails ?? record.optionCaption, record.optionPrice ? `${record.optionPrice}${record.optionPriceQualifier ? ` ${record.optionPriceQualifier}` : ""}` : undefined, record.optionUrl].filter(Boolean).join("\n") || undefined;
}
/** Feed this to the same fenced submission API. Ambiguous target has one stable
 * operation key across repeated emoji, while selections bind the original event.
 */
export function optionSelectionActionKey(record: InboundRecord): string { return record.optionAmbiguous ? `option-clarify:${record.optionBatchId}:${record.targetMessageId ?? "missing"}` : `option-select:${record.id}`; }
export function cardsFromOutboundItem(item: Extract<OutboundItem, { kind: "attachment_group" }>): CardOptionMeta[] { return item.cards ?? []; }
