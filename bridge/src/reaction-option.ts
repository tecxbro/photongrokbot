/**
 * Attachment-group part → option mapping for inbound Tapbacks.
 *
 * Spectrum child ids: formatChildId(partIndex, parentGuid) => `p:{partIndex}/{parentGuid}`.
 * Persist at attachment_group send; resolve on inbound reaction without visual reanalysis.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { DATA_DIR } from "./types.ts";
import type { InboundRecord, OutboundItem } from "./types.ts";
import { loadOutboundQueue } from "./storage.ts";

export const PRESENTATIONS_DIR = join(DATA_DIR, "presentations");
export const PRESENTATION_INDEX_PATH = join(
  DATA_DIR,
  "presentation-index.json",
);

/** Spectrum multipart child id: p:{partIndex}/{parentGuid} */
export function formatChildId(partIndex: number, parentGuid: string): string {
  return `p:${partIndex}/${parentGuid}`;
}

export function parseChildTargetId(
  targetMessageId: string,
): { partIndex: number; parentGuid: string } | null {
  const trimmed = targetMessageId.trim();
  const m = /^p:(\d+)\/(.+)$/.exec(trimmed);
  if (!m) return null;
  const partIndex = Number(m[1]);
  const parentGuid = m[2]!;
  if (!Number.isFinite(partIndex) || partIndex < 0 || !parentGuid) return null;
  return { partIndex, parentGuid };
}

export type PresentationPart = {
  partIndex: number;
  path: string;
  childId: string;
  optionId?: string;
  title?: string;
  url?: string;
  caption?: string;
};

export type PresentationRecord = {
  batchId: string;
  spaceId: string;
  messageId: string;
  outboundId?: string;
  savedAt: string;
  parts: PresentationPart[];
};

type PresentationIndexFile = {
  byMessageId: Record<
    string,
    { batchId: string; outboundId?: string; savedAt: string }
  >;
};

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(tmp, path);
}

export function presentationPath(batchId: string): string {
  return join(PRESENTATIONS_DIR, `${batchId}.json`);
}

export function optionNamesFromParts(
  parts: Array<{ title?: string; optionId?: string; path?: string }>,
): string[] {
  const names: string[] = [];
  for (const p of parts) {
    const name =
      (typeof p.title === "string" && p.title.trim()) ||
      (typeof p.optionId === "string" && p.optionId.trim()) ||
      "";
    if (name) names.push(name);
  }
  return names;
}

function partHasOptionIdentity(part: {
  optionId?: string;
  title?: string;
  url?: string;
}): boolean {
  return Boolean(
    (part.optionId && part.optionId.trim()) ||
      (part.title && part.title.trim()) ||
      (part.url && part.url.trim()),
  );
}

export function buildAttachmentGroupParts(opts: {
  parentMessageId: string;
  paths: string[];
  cards?: Array<{
    optionId?: string;
    title?: string;
    url?: string;
    caption?: string;
  }>;
}): PresentationPart[] {
  return opts.paths.map((path, partIndex) => {
    const card = opts.cards?.[partIndex];
    const part: PresentationPart = {
      partIndex,
      path,
      childId: formatChildId(partIndex, opts.parentMessageId),
    };
    if (card?.optionId?.trim()) part.optionId = card.optionId.trim();
    if (card?.title?.trim()) part.title = card.title.trim();
    if (card?.url?.trim()) part.url = card.url.trim();
    if (card?.caption?.trim()) part.caption = card.caption.trim();
    return part;
  });
}

/**
 * Persist presentation under data/presentations/{batchId}.json and index by
 * parent messageId for reaction lookup.
 */
export async function savePresentation(
  record: PresentationRecord,
): Promise<string> {
  const path = presentationPath(record.batchId);
  await atomicWriteJson(path, record);
  await indexPresentationByMessageId(record);
  return path;
}

async function indexPresentationByMessageId(
  record: PresentationRecord,
): Promise<void> {
  let file: PresentationIndexFile = { byMessageId: {} };
  if (existsSync(PRESENTATION_INDEX_PATH)) {
    try {
      file = JSON.parse(
        await readFile(PRESENTATION_INDEX_PATH, "utf8"),
      ) as PresentationIndexFile;
      if (!file.byMessageId) file.byMessageId = {};
    } catch {
      file = { byMessageId: {} };
    }
  }
  file.byMessageId[record.messageId] = {
    batchId: record.batchId,
    savedAt: record.savedAt,
    ...(record.outboundId ? { outboundId: record.outboundId } : {}),
  };
  await atomicWriteJson(PRESENTATION_INDEX_PATH, file);
}

export async function loadPresentationByBatchId(
  batchId: string,
): Promise<PresentationRecord | null> {
  const path = presentationPath(batchId);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, "utf8")) as PresentationRecord;
  } catch {
    return null;
  }
}

export async function loadPresentationByMessageId(
  messageId: string,
): Promise<PresentationRecord | null> {
  if (existsSync(PRESENTATION_INDEX_PATH)) {
    try {
      const file = JSON.parse(
        await readFile(PRESENTATION_INDEX_PATH, "utf8"),
      ) as PresentationIndexFile;
      const row = file.byMessageId?.[messageId];
      if (row?.batchId) {
        const fromFile = await loadPresentationByBatchId(row.batchId);
        if (fromFile) return fromFile;
      }
    } catch {
      // fall through to outbound scan
    }
  }
  return presentationFromOutboundQueue(messageId);
}

async function presentationFromOutboundQueue(
  messageId: string,
): Promise<PresentationRecord | null> {
  const items = await loadOutboundQueue();
  for (const item of items) {
    if (item.kind !== "attachment_group") continue;
    if (item.messageId !== messageId) continue;
    if (!item.parts || item.parts.length === 0) continue;
    const batchId =
      item.batchId ??
      `outbound-${item.id}`;
    return {
      batchId,
      spaceId: item.spaceId,
      messageId,
      outboundId: item.id,
      savedAt: item.sentAt ?? item.createdAt,
      parts: item.parts.map((p) => ({
        partIndex: p.partIndex,
        path: p.path,
        childId: p.childId,
        ...(p.optionId ? { optionId: p.optionId } : {}),
        ...(p.title ? { title: p.title } : {}),
        ...(p.url ? { url: p.url } : {}),
        ...(p.caption ? { caption: p.caption } : {}),
      })),
    };
  }
  return null;
}

/**
 * After a successful attachment_group send: write parts onto the outbound
 * item shape (caller updates queue) and durable presentation + index.
 */
export async function persistAttachmentGroupMapping(opts: {
  outboundId: string;
  spaceId: string;
  parentMessageId: string;
  paths: string[];
  batchId?: string;
  cards?: Array<{
    optionId?: string;
    title?: string;
    url?: string;
    caption?: string;
  }>;
}): Promise<{
  parts: PresentationPart[];
  batchId: string;
  presentationPath: string;
}> {
  const parts = buildAttachmentGroupParts({
    parentMessageId: opts.parentMessageId,
    paths: opts.paths,
    cards: opts.cards,
  });
  const batchId =
    opts.batchId?.trim() ||
    inferBatchIdFromPaths(opts.paths) ||
    `outbound-${opts.outboundId}`;
  const savedAt = new Date().toISOString();
  const record: PresentationRecord = {
    batchId,
    spaceId: opts.spaceId,
    messageId: opts.parentMessageId,
    outboundId: opts.outboundId,
    savedAt,
    parts,
  };
  const path = await savePresentation(record);
  return { parts, batchId, presentationPath: path };
}

/** Best-effort batchId from outbound-assets / jpeg filenames. */
export function inferBatchIdFromPaths(paths: string[]): string | undefined {
  for (const p of paths) {
    const base = p.split("/").pop() ?? "";
    const m = /^({{DEPLOY_ID_PREFIX}}-b-\d+-[a-f0-9]+)-\d{2}-/i.exec(base);
    if (m) return m[1];
  }
  return undefined;
}

export type ResolvedReactionOption = {
  ambiguous: false;
  partIndex: number;
  parentMessageId: string;
  childId: string;
  path: string;
  optionId?: string;
  title?: string;
  url?: string;
  caption?: string;
  batchId: string;
};

export type AmbiguousReactionOption = {
  ambiguous: true;
  optionNames: string[];
  reason: string;
  partIndex?: number;
  parentMessageId?: string;
  childId?: string;
  batchId?: string;
};

export type ResolveReactionOptionResult =
  | ResolvedReactionOption
  | AmbiguousReactionOption;

/**
 * Resolve an inbound reaction targetMessageId to a card option.
 * Never guesses: missing/partial maps return { ambiguous: true, optionNames }.
 */
export async function resolveReactionOption(
  targetMessageId: string | undefined | null,
): Promise<ResolveReactionOptionResult> {
  if (!targetMessageId || !targetMessageId.trim()) {
    return {
      ambiguous: true,
      optionNames: [],
      reason: "missing-target",
    };
  }

  const parsed = parseChildTargetId(targetMessageId);
  if (!parsed) {
    // Parent-only guid (or unknown form) — batch-level, never pick a card.
    const parentOnly = targetMessageId.trim();
    const presentation = await loadPresentationByMessageId(parentOnly);
    if (presentation) {
      return {
        ambiguous: true,
        optionNames: optionNamesFromParts(presentation.parts),
        reason: "batch-only-target",
        parentMessageId: parentOnly,
        batchId: presentation.batchId,
      };
    }
    return {
      ambiguous: true,
      optionNames: [],
      reason: "unparseable-target",
      parentMessageId: parentOnly,
    };
  }

  const { partIndex, parentGuid } = parsed;
  const childId = formatChildId(partIndex, parentGuid);
  const presentation = await loadPresentationByMessageId(parentGuid);

  if (!presentation) {
    return {
      ambiguous: true,
      optionNames: [],
      reason: "missing-presentation",
      partIndex,
      parentMessageId: parentGuid,
      childId,
    };
  }

  const part = presentation.parts.find((p) => p.partIndex === partIndex);
  if (!part) {
    return {
      ambiguous: true,
      optionNames: optionNamesFromParts(presentation.parts),
      reason: "part-out-of-range",
      partIndex,
      parentMessageId: parentGuid,
      childId,
      batchId: presentation.batchId,
    };
  }

  if (!partHasOptionIdentity(part)) {
    return {
      ambiguous: true,
      optionNames: optionNamesFromParts(presentation.parts),
      reason: "part-missing-option-identity",
      partIndex,
      parentMessageId: parentGuid,
      childId,
      batchId: presentation.batchId,
    };
  }

  return {
    ambiguous: false,
    partIndex,
    parentMessageId: parentGuid,
    childId,
    path: part.path,
    batchId: presentation.batchId,
    ...(part.optionId ? { optionId: part.optionId } : {}),
    ...(part.title ? { title: part.title } : {}),
    ...(part.url ? { url: part.url } : {}),
    ...(part.caption ? { caption: part.caption } : {}),
  };
}

/** Merge resolver result onto an inbound reaction record for Front Door. */
export function applyResolvedOptionToInbound(
  record: InboundRecord,
  resolved: ResolveReactionOptionResult,
): InboundRecord {
  if (record.kind !== "reaction") return record;

  if (resolved.ambiguous) {
    const next: InboundRecord = {
      ...record,
      optionAmbiguous: true,
      optionNames: resolved.optionNames,
      ...(resolved.partIndex !== undefined
        ? { reactedPartIndex: resolved.partIndex }
        : {}),
      ...(resolved.parentMessageId
        ? { reactedParentMessageId: resolved.parentMessageId }
        : {}),
      ...(resolved.childId ? { reactedChildId: resolved.childId } : {}),
      ...(resolved.batchId ? { optionBatchId: resolved.batchId } : {}),
    };
    return next;
  }

  const titleBit = resolved.title ? ` on "${resolved.title}"` : "";
  const text =
    record.emoji && record.text.startsWith("reacted ")
      ? `reacted ${record.emoji}${titleBit}`
      : record.text;

  return {
    ...record,
    text,
    optionAmbiguous: false,
    reactedPartIndex: resolved.partIndex,
    reactedParentMessageId: resolved.parentMessageId,
    reactedChildId: resolved.childId,
    optionBatchId: resolved.batchId,
    ...(resolved.optionId ? { optionId: resolved.optionId } : {}),
    ...(resolved.title ? { optionTitle: resolved.title } : {}),
    ...(resolved.url ? { optionUrl: resolved.url } : {}),
    ...(resolved.caption ? { optionCaption: resolved.caption } : {}),
  };
}

/** List presentation files (test / debug). */
export async function listPresentationBatchIds(): Promise<string[]> {
  if (!existsSync(PRESENTATIONS_DIR)) return [];
  const names = await readdir(PRESENTATIONS_DIR);
  return names
    .filter((n) => n.endsWith(".json"))
    .map((n) => n.replace(/\.json$/, ""));
}

/** Extract cards[] parallel to paths from an outbound attachment_group item. */
export function cardsFromOutboundItem(
  item: Extract<OutboundItem, { kind: "attachment_group" }>,
): Array<{
  optionId?: string;
  title?: string;
  url?: string;
  caption?: string;
}> {
  if (item.cards && item.cards.length > 0) return item.cards;
  return [];
}
