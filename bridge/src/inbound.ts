import type { InboundRecord } from "./types.ts";
import { attachmentDisplayText } from "./inbound-attachment.ts";

/** Minimal shape we read from Spectrum message.content. */
export type ContentLike = {
  type: string;
  text?: string;
  markdown?: string;
  content?: ContentLike;
  emoji?: string;
  target?: { id?: string; space?: { id?: string; phone?: string } };
  title?: string;
  selected?: boolean;
  option?: { title?: string };
  poll?: { type?: string; title?: string; options?: { title?: string }[] };
  options?: { title?: string }[];
  id?: string;
  name?: string;
  mimeType?: string;
  size?: number;
  duration?: number;
  read?: () => Promise<Buffer | Uint8Array>;
};

export type ShapedInbound = {
  kind: "text" | "reaction" | "poll_vote" | "attachment" | "voice";
  text: string;
  replyToMessageId?: string;
  emoji?: string;
  targetMessageId?: string;
  pollTitle?: string;
  pollOption?: string;
  pollSelected?: boolean;
  attachmentId?: string;
  attachmentName?: string;
  attachmentMimeType?: string;
  attachmentBytes?: number;
  /** True when content has a .read() we can download. */
  hasReadableBytes?: boolean;
  attachmentDuration?: number;
};

/**
 * Shape inbound Spectrum content into a record payload Grok can read.
 * Returns null for unsupported kinds (caller may still mark handled).
 * Attachment/voice bytes are downloaded later by the runtime.
 */
export function shapeInboundContent(
  content: ContentLike | undefined,
  depth = 0,
): ShapedInbound | null {
  if (depth > 8) return null;
  if (!content) return null;

  if (content.type === "text" && typeof content.text === "string") {
    return { kind: "text", text: content.text };
  }
  if (content.type === "markdown" && typeof content.markdown === "string") {
    return { kind: "text", text: content.markdown };
  }
  if (content.type === "reply") {
    const shaped = shapeInboundContent(content.content, depth + 1);
    if (!shaped) return null;
    return { ...shaped, ...(typeof content.target?.id === "string" && content.target.id ? { replyToMessageId: content.target.id } : {}) };
  }
  if (content.type === "reaction") {
    const emoji =
      typeof content.emoji === "string" && content.emoji.length > 0
        ? content.emoji
        : "?";
    const targetMessageId =
      content.target && typeof content.target.id === "string"
        ? content.target.id
        : undefined;
    return {
      kind: "reaction",
      text: `reacted ${emoji}`,
      emoji,
      ...(targetMessageId ? { targetMessageId } : {}),
    };
  }
  if (content.type === "poll_option") {
    const optionTitle =
      (typeof content.title === "string" && content.title.trim()) ||
      (content.option && typeof content.option.title === "string"
        ? content.option.title.trim()
        : "") ||
      "?";
    const pollTitle =
      content.poll && typeof content.poll.title === "string"
        ? content.poll.title.trim()
        : undefined;
    const selected = content.selected !== false;
    const verb = selected ? "voted" : "unvoted";
    const text = pollTitle
      ? `${verb} ${optionTitle} on "${pollTitle}"`
      : `${verb} ${optionTitle}`;
    return {
      kind: "poll_vote",
      text,
      pollOption: optionTitle,
      pollSelected: selected,
      ...(pollTitle ? { pollTitle } : {}),
    };
  }
  if (content.type === "attachment" || content.type === "voice") {
    const isVoice = content.type === "voice";
    const name =
      typeof content.name === "string" && content.name.trim().length > 0
        ? content.name.trim()
        : isVoice
          ? "voice-note"
          : "attachment";
    const mimeType =
      typeof content.mimeType === "string" && content.mimeType.length > 0
        ? content.mimeType
        : isVoice
          ? "audio/mp4"
          : "application/octet-stream";
    const size =
      typeof content.size === "number" && Number.isFinite(content.size) && content.size >= 0
        ? content.size
        : undefined;
    const duration =
      typeof content.duration === "number" && Number.isFinite(content.duration) && content.duration >= 0
        ? content.duration
        : undefined;
    const label = isVoice
      ? `[voice] ${name} (${mimeType}${size !== undefined ? `, ${size} bytes` : ""}${duration !== undefined ? `, ${duration}s` : ""})`
      : attachmentDisplayText(name, mimeType, size);
    return {
      kind: isVoice ? "voice" : "attachment",
      text: label,
      attachmentName: name,
      attachmentMimeType: mimeType,
      ...(typeof content.id === "string" && content.id
        ? { attachmentId: content.id }
        : {}),
      ...(size !== undefined ? { attachmentBytes: size } : {}),
      ...(duration !== undefined ? { attachmentDuration: duration } : {}),
      hasReadableBytes: typeof content.read === "function",
    };
  }
  // Echo of a poll we (or someone) created — not a user reply; ignore for wake.
  if (content.type === "poll") {
    return null;
  }
  // Inbound read receipts (recipient read our outbound) — not a user message.
  if (content.type === "read") {
    return null;
  }
  return null;
}

export function toInboundRecord(
  shaped: ShapedInbound,
  meta: {
    id: string;
    spaceId: string;
    senderId: string;
    timestamp: string;
    receivedAt: string;
    lineId?: string;
    pollMessageId?: string;
    pollOptionId?: string;
    reactionSelected?: boolean;
  },
  extras?: {
    attachmentPath?: string;
    attachmentBytes?: number;
    attachmentOriginalPath?: string;
    attachmentOriginalMimeType?: string;
    transcript?: string;
  },
): InboundRecord {
  return {
    id: meta.id,
    spaceId: meta.spaceId,
    senderId: meta.senderId,
    text: shaped.text,
    timestamp: meta.timestamp,
    receivedAt: meta.receivedAt,
    kind: shaped.kind,
    ...(meta.lineId ? { lineId: meta.lineId } : {}),
    ...(shaped.replyToMessageId ? { replyToMessageId: shaped.replyToMessageId } : {}),
    ...(meta.pollMessageId ? { pollMessageId: meta.pollMessageId } : {}),
    ...(meta.pollOptionId ? { pollOptionId: meta.pollOptionId } : {}),
    ...(meta.reactionSelected !== undefined ? { reactionSelected: meta.reactionSelected } : {}),
    ...(shaped.emoji ? { emoji: shaped.emoji } : {}),
    ...(shaped.targetMessageId
      ? { targetMessageId: shaped.targetMessageId }
      : {}),
    ...(shaped.pollTitle ? { pollTitle: shaped.pollTitle } : {}),
    ...(shaped.pollOption ? { pollOption: shaped.pollOption } : {}),
    ...(shaped.pollSelected !== undefined
      ? { pollSelected: shaped.pollSelected }
      : {}),
    ...(shaped.attachmentId ? { attachmentId: shaped.attachmentId } : {}),
    ...(shaped.attachmentName ? { attachmentName: shaped.attachmentName } : {}),
    ...(shaped.attachmentMimeType
      ? { attachmentMimeType: shaped.attachmentMimeType }
      : {}),
    ...(extras?.attachmentPath
      ? { attachmentPath: extras.attachmentPath }
      : {}),
    ...(extras?.attachmentBytes !== undefined
      ? { attachmentBytes: extras.attachmentBytes }
      : shaped.attachmentBytes !== undefined
        ? { attachmentBytes: shaped.attachmentBytes }
        : {}),
    ...(extras?.attachmentOriginalPath
      ? { attachmentOriginalPath: extras.attachmentOriginalPath }
      : {}),
    ...(extras?.attachmentOriginalMimeType
      ? { attachmentOriginalMimeType: extras.attachmentOriginalMimeType }
      : {}),
    ...(shaped.attachmentDuration !== undefined
      ? { attachmentDuration: shaped.attachmentDuration }
      : {}),
    ...(extras?.transcript ? { transcript: extras.transcript } : {}),
  };
}
