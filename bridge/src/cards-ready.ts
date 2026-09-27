/**
 * Durable Photon Image Cards final-enqueue path.
 *
 * Front Door releases the turn after SendToAgent handoff (no wait loop).
 * Image Cards writes PNGs under data/outbound-assets/. Without a callback,
 * typing stops and nothing enqueues until a manual FD ping.
 *
 * Contract:
 * 1. Prefer explicit marker: data/cards-ready/<batchId>.json
 * 2. Fallback: scan outbound-assets for <batchId>-NN-*.{png,jpg,jpeg}
 *    when orchestrator-handled marks an image-stack / {{IMAGE_CARDS_BOT_ID}} route.
 * 3. Runtime final-enqueues ONE attachment_group (all ≥4 cards) and marks
 *    delivery — FD remains policy owner; this is the durable callback.
 * 4. Idempotent: skip if deliveryStatus set, marker consumed, or outbound
 *    already references the batchId.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { DATA_DIR, type CardOptionMeta } from "./types.ts";
import {
  enqueueOutbound,
  loadOutboundQueue,
} from "./storage.ts";

export const IMAGE_CARDS_BOT_ID = "{{IMAGE_CARDS_BOT_ID}}";
export const CARDS_READY_DIR = join(DATA_DIR, "cards-ready");
export const OUTBOUND_ASSETS_DIR = join(DATA_DIR, "outbound-assets");
export const ORCHESTRATOR_HANDLED_DIR = join(DATA_DIR, "orchestrator-handled");

/** Wait after last card mtime before treating a disk scan as complete. */
export const CARDS_STABLE_MS = 12_000;
/** Minimum cards for an image stack (policy). */
export const MIN_STACK_CARDS = 4;

export type CardsReadyMarker = {
  batchId: string;
  spaceId: string;
  attachmentPaths: string[];
  expectedCount?: number;
  caption?: string;
  readyAt: string;
  source?: string;
  /**
   * Parallel to attachmentPaths — option identity (title/url/…) for
   * reaction→option resolve after attachment_group send.
   */
  cards?: CardOptionMeta[];
  /** Set when runtime (or FD) has final-enqueued. */
  consumedAt?: string;
  consumedBy?: string;
  outboundIds?: string[];
};

export type ImageStackHandled = {
  batchId: string;
  spaceId: string;
  expectedCount?: number;
  caption?: string;
  routedTo?: string;
  action?: string;
  modality?: string;
  deliveryStatus?: string;
  path: string;
  raw: Record<string, unknown>;
};

function isImageStackRoute(raw: Record<string, unknown>): boolean {
  const action = String(raw.action ?? "");
  const routed =
    String(raw.routedTo ?? raw.specialistId ?? raw.taskOwner ?? "");
  const modality = String(raw.modality ?? "");
  const specialist = String(raw.specialist ?? raw.specialistName ?? "");
  if (raw.deliveryStatus && String(raw.deliveryStatus).startsWith("enqueued")) {
    return false;
  }
  if (modality === "image-stack") return true;
  if (
    action === "forward-to-specialist" &&
    (routed === IMAGE_CARDS_BOT_ID ||
      /image\s*cards/i.test(specialist) ||
      /image\s*cards/i.test(String(raw.specialistName ?? "")))
  ) {
    return true;
  }
  return false;
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(tmp, path);
}

export function cardsReadyMarkerPath(batchId: string): string {
  return join(CARDS_READY_DIR, `${batchId}.json`);
}

export async function writeCardsReadyMarker(
  marker: CardsReadyMarker,
): Promise<string> {
  const path = cardsReadyMarkerPath(marker.batchId);
  await atomicWriteJson(path, marker);
  return path;
}

export async function readCardsReadyMarker(
  batchId: string,
): Promise<CardsReadyMarker | null> {
  const path = cardsReadyMarkerPath(batchId);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, "utf8")) as CardsReadyMarker;
  } catch {
    return null;
  }
}

export async function listImageStackHandled(
  handledDir = ORCHESTRATOR_HANDLED_DIR,
): Promise<ImageStackHandled[]> {
  if (!existsSync(handledDir)) return [];
  const names = await readdir(handledDir);
  const out: ImageStackHandled[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const path = join(handledDir, name);
    try {
      const raw = JSON.parse(await readFile(path, "utf8")) as Record<
        string,
        unknown
      >;
      if (!isImageStackRoute(raw)) continue;
      const batchId = String(raw.batchId ?? name.replace(/\.json$/, ""));
      const spaceId = String(raw.spaceId ?? "");
      if (!batchId || !spaceId) continue;
      const expected =
        typeof raw.expectedCardCount === "number"
          ? raw.expectedCardCount
          : typeof raw.expectedCount === "number"
            ? raw.expectedCount
            : typeof raw.cardCount === "number"
              ? raw.cardCount
              : undefined;
      out.push({
        batchId,
        spaceId,
        expectedCount: expected,
        caption: typeof raw.caption === "string" ? raw.caption : undefined,
        routedTo: String(
          raw.routedTo ?? raw.specialistId ?? IMAGE_CARDS_BOT_ID,
        ),
        action: String(raw.action ?? ""),
        modality: String(raw.modality ?? ""),
        deliveryStatus:
          typeof raw.deliveryStatus === "string"
            ? raw.deliveryStatus
            : undefined,
        path,
        raw,
      });
    } catch {
      // skip corrupt
    }
  }
  return out;
}

/** Paths under outbound-assets matching <batchId>-NN-slug.ext */
export async function listBatchAssetPaths(
  batchId: string,
  assetsDir = OUTBOUND_ASSETS_DIR,
): Promise<{ paths: string[]; newestMtimeMs: number }> {
  if (!existsSync(assetsDir)) return { paths: [], newestMtimeMs: 0 };
  const names = await readdir(assetsDir);
  const prefix = `${batchId}-`;
  const matched: { path: string; nn: number; mtimeMs: number }[] = [];
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    if (!/\.(png|jpe?g|webp)$/i.test(name)) continue;
    if (name.startsWith("_")) continue;
    const rest = name.slice(prefix.length);
    const m = /^(\d{2})-/.exec(rest);
    if (!m) continue;
    const full = join(assetsDir, name);
    try {
      const st = await stat(full);
      matched.push({
        path: full,
        nn: Number(m[1]),
        mtimeMs: st.mtimeMs,
      });
    } catch {
      // skip
    }
  }
  matched.sort((a, b) => a.nn - b.nn || a.path.localeCompare(b.path));
  const newestMtimeMs = matched.reduce((n, x) => Math.max(n, x.mtimeMs), 0);
  return { paths: matched.map((x) => x.path), newestMtimeMs };
}

export function assetsAreComplete(opts: {
  paths: string[];
  expectedCount?: number;
  newestMtimeMs: number;
  nowMs?: number;
  stableMs?: number;
  minCards?: number;
}): boolean {
  const now = opts.nowMs ?? Date.now();
  const stableMs = opts.stableMs ?? CARDS_STABLE_MS;
  const minCards = opts.minCards ?? MIN_STACK_CARDS;
  if (opts.paths.length < minCards) return false;
  if (opts.expectedCount != null && opts.paths.length < opts.expectedCount) {
    return false;
  }
  if (!opts.newestMtimeMs) return false;
  if (now - opts.newestMtimeMs < stableMs) return false;
  return true;
}

export async function outboundAlreadyCoversBatch(
  batchId: string,
): Promise<boolean> {
  const items = await loadOutboundQueue();
  const needle = batchId;
  for (const item of items) {
    if (item.kind === "attachment_group") {
      if (item.attachmentPaths.some((p) => p.includes(needle))) return true;
    } else if ("attachmentPath" in item && item.attachmentPath) {
      if (String(item.attachmentPath).includes(needle)) return true;
    }
  }
  return false;
}

export type ReadyStack = {
  batchId: string;
  spaceId: string;
  attachmentPaths: string[];
  caption?: string;
  cards?: CardOptionMeta[];
  source: "marker" | "disk-scan";
  markerPath?: string;
  handledPath?: string;
};

/**
 * Resolve stacks that are ready to final-enqueue (not yet delivered).
 */
export async function findReadyImageStacks(opts?: {
  nowMs?: number;
  stableMs?: number;
  handledDir?: string;
  assetsDir?: string;
  cardsReadyDir?: string;
}): Promise<ReadyStack[]> {
  const nowMs = opts?.nowMs ?? Date.now();
  const stableMs = opts?.stableMs ?? CARDS_STABLE_MS;
  const handledDir = opts?.handledDir ?? ORCHESTRATOR_HANDLED_DIR;
  const assetsDir = opts?.assetsDir ?? OUTBOUND_ASSETS_DIR;
  const cardsReadyDir = opts?.cardsReadyDir ?? CARDS_READY_DIR;

  const ready: ReadyStack[] = [];
  const seen = new Set<string>();

  // 1) Explicit markers
  if (existsSync(cardsReadyDir)) {
    for (const name of await readdir(cardsReadyDir)) {
      if (!name.endsWith(".json")) continue;
      const path = join(cardsReadyDir, name);
      let marker: CardsReadyMarker;
      try {
        marker = JSON.parse(await readFile(path, "utf8")) as CardsReadyMarker;
      } catch {
        continue;
      }
      if (marker.consumedAt) continue;
      if (!marker.batchId || !marker.spaceId) continue;
      const paths = (marker.attachmentPaths ?? []).filter(
        (p) => p && existsSync(p),
      );
      const expected = marker.expectedCount ?? paths.length;
      if (paths.length < MIN_STACK_CARDS) continue;
      if (paths.length < expected) continue;
      if (await outboundAlreadyCoversBatch(marker.batchId)) {
        marker.consumedAt = new Date(nowMs).toISOString();
        marker.consumedBy = "idempotent-outbound-exists";
        await atomicWriteJson(path, marker);
        continue;
      }
      ready.push({
        batchId: marker.batchId,
        spaceId: marker.spaceId,
        attachmentPaths: paths,
        caption: marker.caption,
        ...(marker.cards && marker.cards.length > 0
          ? { cards: marker.cards }
          : {}),
        source: "marker",
        markerPath: path,
      });
      seen.add(marker.batchId);
    }
  }

  // 2) Disk scan for pending image-stack handled records
  const handled = await listImageStackHandled(handledDir);
  for (const h of handled) {
    if (seen.has(h.batchId)) continue;
    if (h.deliveryStatus?.startsWith("enqueued")) continue;
    if (await outboundAlreadyCoversBatch(h.batchId)) {
      await markHandledDelivered(h.path, h.raw, {
        deliveryStatus: "enqueued-detected-in-outbound",
        deliveredAt: new Date(nowMs).toISOString(),
      });
      continue;
    }
    const { paths, newestMtimeMs } = await listBatchAssetPaths(
      h.batchId,
      assetsDir,
    );
    if (
      !assetsAreComplete({
        paths,
        expectedCount: h.expectedCount,
        newestMtimeMs,
        nowMs,
        stableMs,
      })
    ) {
      continue;
    }
    ready.push({
      batchId: h.batchId,
      spaceId: h.spaceId,
      attachmentPaths: paths,
      caption: h.caption,
      source: "disk-scan",
      handledPath: h.path,
    });
    seen.add(h.batchId);
  }

  return ready;
}

export async function markHandledDelivered(
  handledPath: string,
  raw: Record<string, unknown>,
  patch: Record<string, unknown>,
): Promise<void> {
  await atomicWriteJson(handledPath, { ...raw, ...patch });
}

export async function consumeCardsReadyMarker(
  markerPath: string,
  patch: Partial<CardsReadyMarker>,
): Promise<void> {
  let cur: CardsReadyMarker = {
    batchId: "",
    spaceId: "",
    attachmentPaths: [],
    readyAt: new Date().toISOString(),
  };
  try {
    cur = JSON.parse(await readFile(markerPath, "utf8")) as CardsReadyMarker;
  } catch {
    // replace
  }
  await atomicWriteJson(markerPath, { ...cur, ...patch });
}

/**
 * Final-enqueue one ready stack. Returns outbound ids, or null if skipped.
 */
export async function finalEnqueueReadyStack(
  stack: ReadyStack,
): Promise<{ outboundIds: string[] } | null> {
  if (stack.attachmentPaths.length < MIN_STACK_CARDS) return null;
  if (await outboundAlreadyCoversBatch(stack.batchId)) {
    if (stack.markerPath) {
      await consumeCardsReadyMarker(stack.markerPath, {
        consumedAt: new Date().toISOString(),
        consumedBy: "idempotent-outbound-exists",
      });
    }
    if (stack.handledPath) {
      const raw = JSON.parse(
        await readFile(stack.handledPath, "utf8"),
      ) as Record<string, unknown>;
      await markHandledDelivered(stack.handledPath, raw, {
        deliveryStatus: "enqueued-detected-in-outbound",
        deliveredAt: new Date().toISOString(),
      });
    }
    return null;
  }

  const items = await enqueueOutbound({
    kind: "attachment_group",
    spaceId: stack.spaceId,
    attachmentPaths: stack.attachmentPaths,
    batchId: stack.batchId,
    ...(stack.caption ? { text: stack.caption } : {}),
    ...(stack.cards && stack.cards.length > 0 ? { cards: stack.cards } : {}),
  });
  const outboundIds = items.map((i) => i.id);
  const deliveredAt = new Date().toISOString();

  if (stack.markerPath) {
    await consumeCardsReadyMarker(stack.markerPath, {
      consumedAt: deliveredAt,
      consumedBy: "runtime-cards-ready-watchdog",
      outboundIds,
    });
  }

  const handledPath =
    stack.handledPath ??
    join(ORCHESTRATOR_HANDLED_DIR, `${stack.batchId}.json`);
  if (existsSync(handledPath)) {
    const raw = JSON.parse(await readFile(handledPath, "utf8")) as Record<
      string,
      unknown
    >;
    await markHandledDelivered(handledPath, raw, {
      deliveryStatus: "enqueued-by-runtime-watchdog",
      deliveredAt,
      deliverySource: stack.source,
      outboundIds,
      cardCount: stack.attachmentPaths.length,
    });
  }

  return { outboundIds };
}

/** Runtime drain: enqueue every ready stack. */
export async function drainCardsReady(): Promise<number> {
  const stacks = await findReadyImageStacks();
  let n = 0;
  for (const stack of stacks) {
    const result = await finalEnqueueReadyStack(stack);
    if (result) n += 1;
  }
  return n;
}
