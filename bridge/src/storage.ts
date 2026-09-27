import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  EnqueueOutboundInput,
  InboundRecord,
  OutboundItem,
  UnreadBatch,
} from "./types.ts";
import { prepareOutboundText } from "./outbound-text.ts";
import { prepareOutboundPoll } from "./outbound-poll.ts";
import { prepareOutboundApp } from "./outbound-app.ts";
import { prepareOutboundEffect } from "./outbound-effect.ts";
import { normalizeEnqueueAttachments } from "./outbound-jpeg.ts";
import { DATA_DIR, PREFIX } from "./types.ts";
import { INBOUND_ATTACHMENTS_DIR } from "./inbound-attachment.ts";

const HANDLED_PATH = join(DATA_DIR, "handled-ids.json");
const PENDING_PATH = join(DATA_DIR, "pending-batch.json");
const WEBHOOK_PENDING_PATH = join(DATA_DIR, "webhook-pending.json");
const OUTBOUND_QUEUE_PATH = join(DATA_DIR, "outbound-queue.json");
const INBOUND_LOG = join(DATA_DIR, "inbound.jsonl");
const OUTBOUND_LOG = join(DATA_DIR, "outbound.jsonl");
const POLL_META_PATH = join(DATA_DIR, "poll-meta.json");
const APP_CARD_SESSIONS_PATH = join(DATA_DIR, "app-card-sessions.json");
const UNREAD_DIR = join(DATA_DIR, "unread");

let chain: Promise<void> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function atomicWrite(path: string, body: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, body, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, path);
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function appendJsonl(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const fh = await open(path, "a", 0o600);
  try {
    await fh.write(`${JSON.stringify(value)}\n`);
    await fh.sync();
  } finally {
    await fh.close();
  }
}

export async function ensureDataDir(): Promise<void> {
  await mkdir(UNREAD_DIR, { recursive: true });
  await mkdir(INBOUND_ATTACHMENTS_DIR, { recursive: true });
}

export function newId(kind: "b" | "o"): string {
  return `${PREFIX}-${kind}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

type HandledFile = { ids: string[] };

export async function loadHandledIds(): Promise<Set<string>> {
  return withLock(async () => {
    const file = await readJson<HandledFile>(HANDLED_PATH, { ids: [] });
    return new Set(file.ids);
  });
}

export async function addHandledId(id: string): Promise<void> {
  await withLock(async () => {
    const file = await readJson<HandledFile>(HANDLED_PATH, { ids: [] });
    if (!file.ids.includes(id)) file.ids.push(id);
    await atomicWriteJson(HANDLED_PATH, file);
  });
}

export async function appendInbound(record: InboundRecord): Promise<void> {
  await withLock(async () => {
    await appendJsonl(INBOUND_LOG, record);
    await atomicWriteJson(join(DATA_DIR, "inbound", `${record.id}.json`), record);
  });
}

export async function loadPendingBatch(): Promise<InboundRecord[]> {
  return withLock(async () => {
    const file = await readJson<{ messages: InboundRecord[] }>(
      PENDING_PATH,
      { messages: [] },
    );
    return file.messages;
  });
}

export async function savePendingBatch(messages: InboundRecord[]): Promise<void> {
  await withLock(async () => {
    if (messages.length === 0) {
      if (existsSync(PENDING_PATH)) await unlink(PENDING_PATH);
      return;
    }
    await atomicWriteJson(PENDING_PATH, { messages });
  });
}

export async function writeUnreadBatch(batch: UnreadBatch): Promise<string> {
  const path = join(UNREAD_DIR, `${batch.batchId}.json`);
  await withLock(async () => {
    await atomicWriteJson(path, batch);
  });
  return path;
}

export async function readUnreadBatch(batchId: string): Promise<UnreadBatch> {
  const path = join(UNREAD_DIR, `${batchId}.json`);
  if (!existsSync(path)) {
    throw new Error(`unread batch not found: ${batchId}`);
  }
  return JSON.parse(await readFile(path, "utf8")) as UnreadBatch;
}

type WebhookPendingFile = { batchIds: string[] };

export async function addWebhookPending(batchId: string): Promise<void> {
  await withLock(async () => {
    const file = await readJson<WebhookPendingFile>(WEBHOOK_PENDING_PATH, {
      batchIds: [],
    });
    if (!file.batchIds.includes(batchId)) file.batchIds.push(batchId);
    await atomicWriteJson(WEBHOOK_PENDING_PATH, file);
  });
}

export async function removeWebhookPending(batchId: string): Promise<void> {
  await withLock(async () => {
    const file = await readJson<WebhookPendingFile>(WEBHOOK_PENDING_PATH, {
      batchIds: [],
    });
    file.batchIds = file.batchIds.filter((id) => id !== batchId);
    await atomicWriteJson(WEBHOOK_PENDING_PATH, file);
  });
}

export async function listWebhookPending(): Promise<string[]> {
  return withLock(async () => {
    const file = await readJson<WebhookPendingFile>(WEBHOOK_PENDING_PATH, {
      batchIds: [],
    });
    return file.batchIds;
  });
}

type QueueFile = { items: OutboundItem[] };

export async function loadOutboundQueue(): Promise<OutboundItem[]> {
  return withLock(async () => {
    const file = await readJson<QueueFile>(OUTBOUND_QUEUE_PATH, { items: [] });
    return file.items;
  });
}

function buildOutboundItems(input: EnqueueOutboundInput): OutboundItem[] {
  const createdAt = new Date().toISOString();

  if (input.kind === "attachment_group") {
    const paths = input.attachmentPaths
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    if (paths.length < 2) {
      throw new Error(
        "attachment_group requires at least 2 attachmentPaths (use kind text for a single file)",
      );
    }
    for (const p of paths) {
      if (!existsSync(p)) {
        throw new Error(`attachment_group path not found: ${p}`);
      }
    }
    const items: OutboundItem[] = [];
    const caption = input.text?.trim() ?? "";
    if (caption.length > 0 && !caption.startsWith("[attachment]")) {
      items.push({
        id: newId("o"),
        kind: "text",
        spaceId: input.spaceId,
        text: caption,
        createdAt,
        status: "queued",
        attempts: 0,
      });
    }
    items.push({
      id: newId("o"),
      kind: "attachment_group",
      spaceId: input.spaceId,
      attachmentPaths: paths,
      createdAt,
      status: "queued",
      attempts: 0,
      ...(input.batchId?.trim() ? { batchId: input.batchId.trim() } : {}),
      ...(input.cards && input.cards.length > 0 ? { cards: input.cards } : {}),
    });
    return items;
  }

  if (input.kind === "typing") {
    return [
      {
        id: newId("o"),
        kind: "typing",
        spaceId: input.spaceId,
        state: input.state,
        createdAt,
        status: "queued",
        attempts: 0,
      },
    ];
  }

  if (input.kind === "poll") {
    const prepared = prepareOutboundPoll(input.title, input.options);
    return [
      {
        id: newId("o"),
        kind: "poll",
        spaceId: input.spaceId,
        title: prepared.title,
        options: prepared.options,
        createdAt,
        status: "queued",
        attempts: 0,
      },
    ];
  }

  if (input.kind === "voice") {
    const audioPath = input.audioPath.trim();
    if (!audioPath) {
      throw new Error("voice enqueue requires audioPath");
    }
    return [
      {
        id: newId("o"),
        kind: "voice",
        spaceId: input.spaceId,
        audioPath,
        ...(input.text?.trim() ? { text: input.text.trim() } : {}),
        ...(typeof input.durationSeconds === "number"
          ? { durationSeconds: input.durationSeconds }
          : {}),
        createdAt,
        status: "queued",
        attempts: 0,
      },
    ];
  }

  if (input.kind === "app") {
    const prepared = prepareOutboundApp(input.url, input.live ?? false);
    return [
      {
        id: newId("o"),
        kind: "app",
        spaceId: input.spaceId,
        url: prepared.url,
        live: prepared.live,
        createdAt,
        status: "queued",
        attempts: 0,
      },
    ];
  }

  if (input.kind === "app_update") {
    const prepared = prepareOutboundApp(input.url, input.live ?? false);
    const targetMessageId = input.targetMessageId.trim();
    if (!targetMessageId) {
      throw new Error("app_update enqueue requires targetMessageId");
    }
    return [
      {
        id: newId("o"),
        kind: "app_update",
        spaceId: input.spaceId,
        url: prepared.url,
        live: prepared.live,
        targetMessageId,
        createdAt,
        status: "queued",
        attempts: 0,
      },
    ];
  }

  if (input.kind === "react") {
    return [
      {
        id: newId("o"),
        kind: "react",
        spaceId: input.spaceId,
        targetMessageId: input.targetMessageId,
        emoji: input.emoji,
        createdAt,
        status: "queued",
        attempts: 0,
      },
    ];
  }

  if (input.kind === "reply") {
    const prepared = prepareOutboundText(input.text);
    if (prepared.kind !== "text") {
      throw new Error("reply enqueue unexpected attachment prepare result");
    }
    // Replies stay a single bubble (threading); join if multi-paragraph.
    const text =
      prepared.bubbles.length === 1
        ? prepared.bubbles[0]!
        : prepared.bubbles.join("\n\n");
    return [
      {
        id: newId("o"),
        kind: "reply",
        spaceId: input.spaceId,
        targetMessageId: input.targetMessageId,
        text,
        createdAt,
        status: "queued",
        attempts: 0,
      },
    ];
  }

  // text (default; missing kind treated as text)
  const effectName =
    input.kind === "text" || input.kind === undefined
      ? (input as { effect?: string }).effect
      : undefined;
  const effect =
    effectName !== undefined && effectName !== ""
      ? prepareOutboundEffect(effectName)
      : undefined;

  const prepared = prepareOutboundText(input.text, input.attachmentPath);
  if (prepared.kind === "attachment") {
    const items: OutboundItem[] = [];
    // Caption (real text, not the placeholder) goes as its own bubble first.
    const caption = input.text.trim();
    const hasCaption =
      caption.length > 0 && !caption.startsWith("[attachment]");
    if (hasCaption) {
      items.push({
        id: newId("o"),
        kind: "text",
        spaceId: input.spaceId,
        text: caption,
        createdAt,
        status: "queued",
        attempts: 0,
        // At most one effect: put it on the caption bubble when present.
        ...(effect ? { effect } : {}),
      });
    }
    items.push({
      id: newId("o"),
      kind: "text",
      spaceId: input.spaceId,
      text: prepared.text,
      attachmentPath: prepared.attachmentPath,
      createdAt,
      status: "queued",
      attempts: 0,
      // Attachment-only (no caption): effect wraps the attachment send.
      ...(!hasCaption && effect ? { effect } : {}),
    });
    return items;
  }
  // Multi-bubble: effect only on the first bubble (one effect per turn).
  return prepared.bubbles.map((bubble, index) => ({
    id: newId("o"),
    kind: "text" as const,
    spaceId: input.spaceId,
    text: bubble,
    createdAt,
    status: "queued" as const,
    attempts: 0,
    ...(effect && index === 0 ? { effect } : {}),
  }));
}

export async function enqueueOutbound(
  input: EnqueueOutboundInput,
): Promise<OutboundItem[]> {
  const normalized = await normalizeEnqueueAttachments(input);
  const items = buildOutboundItems(normalized);

  await withLock(async () => {
    const file = await readJson<QueueFile>(OUTBOUND_QUEUE_PATH, { items: [] });
    file.items.push(...items);
    await atomicWriteJson(OUTBOUND_QUEUE_PATH, file);
    for (const item of items) {
      await appendJsonl(OUTBOUND_LOG, { event: "enqueue", item });
    }
  });
  return items;
}

export async function updateOutbound(
  id: string,
  patch: Partial<OutboundItem>,
): Promise<OutboundItem | undefined> {
  return withLock(async () => {
    const file = await readJson<QueueFile>(OUTBOUND_QUEUE_PATH, { items: [] });
    const item = file.items.find((row) => row.id === id);
    if (!item) return undefined;
    Object.assign(item, patch);
    await atomicWriteJson(OUTBOUND_QUEUE_PATH, file);
    await appendJsonl(OUTBOUND_LOG, { event: "update", item });
    return item;
  });
}

type PollMetaFile = {
  byMessageId: Record<
    string,
    { title: string; options: string[]; savedAt: string }
  >;
};

export async function savePollMeta(
  messageId: string,
  title: string,
  options: string[],
): Promise<void> {
  await withLock(async () => {
    const file = await readJson<PollMetaFile>(POLL_META_PATH, {
      byMessageId: {},
    });
    file.byMessageId[messageId] = {
      title,
      options,
      savedAt: new Date().toISOString(),
    };
    await atomicWriteJson(POLL_META_PATH, file);
  });
}

export async function loadPollMeta(
  messageId: string,
): Promise<{ title: string; options: string[] } | undefined> {
  return withLock(async () => {
    const file = await readJson<PollMetaFile>(POLL_META_PATH, {
      byMessageId: {},
    });
    const row = file.byMessageId[messageId];
    if (!row) return undefined;
    return { title: row.title, options: row.options };
  });
}

export type AppCardSession = {
  chatGuid: string;
  messageGuid: string;
  sessionId: string;
  targetMessageGuid: string;
};

type AppCardSessionsFile = {
  byMessageId: Record<
    string,
    { session: AppCardSession; savedAt: string; live?: boolean; url?: string }
  >;
};

/** Persist iMessage miniAppCardSession for later in-place app edits. */
export async function saveAppCardSession(
  messageId: string,
  session: AppCardSession,
  meta?: { live?: boolean; url?: string },
): Promise<void> {
  await withLock(async () => {
    const file = await readJson<AppCardSessionsFile>(APP_CARD_SESSIONS_PATH, {
      byMessageId: {},
    });
    file.byMessageId[messageId] = {
      session,
      savedAt: new Date().toISOString(),
      ...(meta?.live !== undefined ? { live: meta.live } : {}),
      ...(meta?.url ? { url: meta.url } : {}),
    };
    await atomicWriteJson(APP_CARD_SESSIONS_PATH, file);
  });
}

export async function loadAppCardSession(
  messageId: string,
): Promise<AppCardSession | undefined> {
  return withLock(async () => {
    const file = await readJson<AppCardSessionsFile>(APP_CARD_SESSIONS_PATH, {
      byMessageId: {},
    });
    return file.byMessageId[messageId]?.session;
  });
}
