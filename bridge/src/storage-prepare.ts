import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { EnqueueOutboundInput, OutboundItem } from "./types.ts";
import { prepareOutboundText } from "./outbound-text.ts";
import { prepareOutboundPoll } from "./outbound-poll.ts";
import { prepareOutboundApp } from "./outbound-app.ts";
import { prepareOutboundEffect } from "./outbound-effect.ts";
function newId(_kind: string) {
  return `o-${randomUUID()}`;
}
export function buildOutboundItems(
  input: EnqueueOutboundInput,
): OutboundItem[] {
  const createdAt = new Date().toISOString();

  if (input.kind === "attachment_group") {
    if (
      !Array.isArray(input.attachmentPaths) ||
      input.attachmentPaths.some((p) => typeof p !== "string" || !p.trim())
    )
      throw new Error("ATTACHMENT_PATH_INVALID");
    const paths = input.attachmentPaths.map((p) => p.trim());
    if (input.cards && input.cards.length !== paths.length)
      throw new Error("ATTACHMENT_CARD_ALIGNMENT_REQUIRED");
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
