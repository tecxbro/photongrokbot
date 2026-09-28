import { resolveInstancePaths } from "../../shared/instance-paths.mjs";

export const PREFIX = "photon";
export const DEBOUNCE_MS = 2000;
/** Finite best-effort typing lifetime while a verified claim remains active. */
export const TYPING_TIMEOUT_MS = 120_000;
/** Re-send startTyping so iMessage indicator does not die mid-wait. */
export const TYPING_HEARTBEAT_MS = 20_000;
// Pure resolution only. Tests must inject a guarded temporary instance.
export const DATA_DIR = resolveInstancePaths().dataDir;
export const ENV_PATH = resolveInstancePaths().bridgeEnv;

/** One card / option in an image stack (parallel to attachmentPaths). */
export type CardOptionMeta = {
  optionId?: string;
  title?: string;
  url?: string;
  caption?: string;
  details?: string;
  price?: string;
  priceQualifier?: string;
};

/** Part→option row persisted on attachment_group send (Spectrum child id). */
export type AttachmentGroupPart = {
  partIndex: number;
  path: string;
  /** Spectrum formatChildId: `p:{partIndex}/{parentGuid}`. */
  childId: string;
  optionId?: string;
  title?: string;
  url?: string;
  caption?: string;
  details?: string;
  price?: string;
  priceQualifier?: string;
};

export type InboundRecord = {
  id: string;
  spaceId: string;
  senderId: string;
  lineId?: string;
  replyToMessageId?: string;
  pollMessageId?: string;
  pollOptionId?: string;
  reactionSelected?: boolean;
  mediaState?: "pending" | "processing" | "ready" | "failed" | "unavailable";
  mediaJobId?: string;
  mediaError?: string;
  /** Display text; for reactions a short summary like `reacted ❤️`. */
  text: string;
  timestamp: string;
  receivedAt: string;
  /** Defaults to text when omitted (backward compat). */
  kind?: "text" | "reaction" | "poll_vote" | "attachment" | "voice";
  emoji?: string;
  /** Message id the reaction targets. */
  targetMessageId?: string;
  /** Poll title when kind is poll_vote. */
  pollTitle?: string;
  /** Selected option label when kind is poll_vote. */
  pollOption?: string;
  /** true = voted / changed vote; false = unvoted. */
  pollSelected?: boolean;
  /** Absolute path under data/inbound-attachments when kind is attachment. */
  attachmentPath?: string;
  /** Provider attachment id / GUID when available. */
  attachmentId?: string;
  attachmentName?: string;
  attachmentMimeType?: string;
  attachmentBytes?: number;
  /** HEIC/HEIF original when converted to JPEG. */
  attachmentOriginalPath?: string;
  attachmentOriginalMimeType?: string;
  /** Seconds, when Spectrum provides voice duration. */
  attachmentDuration?: number;
  /** Moonshine STT transcript when kind is voice (may be empty on failure). */
  transcript?: string;
  /**
   * Resolved attachment_group option fields (kind=reaction).
   * Set by runtime via reaction-option resolver — never guess when ambiguous.
   */
  reactedPartIndex?: number;
  reactedParentMessageId?: string;
  reactedChildId?: string;
  optionId?: string;
  optionTitle?: string;
  optionUrl?: string;
  optionCaption?: string;
  optionDetails?: string;
  optionPrice?: string;
  optionPriceQualifier?: string;
  optionBatchId?: string;
  /** true when part→option map missing / batch-only / incomplete. */
  optionAmbiguous?: boolean;
  /** Option titles (or ids) when ambiguous — for one clarification ask. */
  optionNames?: string[];
};


/** Max bytes we will download for one inbound attachment (Photon upload default). */
export const INBOUND_ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024;


export type UnreadBatch = {
  batchId: string;
  inputRevision?: number;
  acknowledgedRevision?: number;
  continuationReason?: "inbound" | "media_ready" | "media_failed" | "media_unavailable" | "task_result";
  originalSources?: Array<{eventId: string; messageId: string}>;
  sources?: Array<{ eventId?: string; messageId?: string; mediaJobId?: string; taskId?: string; taskInputRevision?: number; resultId?: string }>;
  taskResults?: import("./contracts.ts").TaskResult[];
  flushedAt: string;
  destination?: import("./contracts.ts").Destination;
  media?: import("./contracts.ts").MediaJob[];
  tasks?: import("./contracts.ts").TaskBinding[];
  messages: InboundRecord[];
  /** Set when runtime already answered (skip Front Door / Chatty). */
  handledBy?: "runtime-greeting";
};

type OutboundBase = {
  id: string;
  spaceId: string;
  createdAt: string;
  status: import("./contracts.ts").DeliveryState | "sent";
  lineId?: string;
  messageId?: string;
  actionKey?: string;
  purpose?: string;
  operationId?: string;
  partIndex?: number;
  attempts: number;
  sentAt?: string;
  failedAt?: string;
  lastError?: string;
  nextAttemptAt?: string;
};

/** Missing `kind` is treated as text for backward compatibility. */
export type OutboundItem =
  | (OutboundBase & {
      kind?: "text";
      text: string;
      attachmentPath?: string;
      /** iMessage bubble/screen effect short name (see outbound-effect.ts). */
      effect?: string;
    })
  | (OutboundBase & {
      kind: "reply";
      targetMessageId: string;
      text: string;
    })
  | (OutboundBase & {
      kind: "react";
      targetMessageId: string;
      emoji: string;
    })
  | (OutboundBase & {
      kind: "poll";
      title: string;
      options: string[];
      /** Set after successful send when Spectrum returns a message id. */
      messageId?: string;
    })
  | (OutboundBase & {
      kind: "voice";
      /** Absolute path to audio (m4a/mp3/wav preferred; Spectrum may remux to m4a). */
      audioPath: string;
      text?: string;
      durationSeconds?: number;
      messageId?: string;
    })
  | (OutboundBase & {
      kind: "typing";
      state: "start" | "stop";
    })
  | (OutboundBase & {
      /** Multiple images as one Spectrum group → iMessage sendMultipart. */
      kind: "attachment_group";
      /** Absolute paths; length ≥ 2. Prefer batches of 4 for card stacks. */
      attachmentPaths: string[];
      /** Cards-ready / Image Cards batch id when this group is a card stack. */
      batchId?: string;
      /** Parallel to attachmentPaths — option identity for reaction resolve. */
      cards?: CardOptionMeta[];
      /** Parent Spectrum message id after successful send. */
      messageId?: string;
      /** Part→option map written on successful send (formatChildId child ids). */
      parts?: AttachmentGroupPart[];
    })
  | (OutboundBase & {
      /** Spectrum app(url) — full-sheet iMessage app card. */
      kind: "app";
      url: string;
      /** When true, Spectrum app(url, { live: true }). Default false. */
      live?: boolean;
      /** Set after successful send when Spectrum returns a message id. */
      messageId?: string;
    })
  | (OutboundBase & {
      /** In-place edit of a previously sent live app card. */
      kind: "app_update";
      url: string;
      live?: boolean;
      /** Message id of the previously sent app card. */
      targetMessageId: string;
    });

export type EnqueueOutboundInput =
  | {
      kind?: "text";
      spaceId: string;
      text: string;
      attachmentPath?: string;
      /** Optional iMessage effect short name (confetti, slam, …). */
      effect?: string;
    }
  | {
      kind: "attachment_group";
      spaceId: string;
      attachmentPaths: string[];
      /** Optional caption sent as its own text bubble before the group. */
      text?: string;
      /** Cards-ready batch id — used for presentations/{batchId}.json. */
      batchId?: string;
      /** Parallel to attachmentPaths (title/url/optionId/caption). */
      cards?: CardOptionMeta[];
    }
  | {
      kind: "reply";
      spaceId: string;
      targetMessageId: string;
      text: string;
    }
  | {
      kind: "react";
      spaceId: string;
      targetMessageId: string;
      emoji: string;
    }
  | {
      kind: "poll";
      spaceId: string;
      title: string;
      options: string[];
    }
  | {
      kind: "voice";
      spaceId: string;
      audioPath: string;
      text?: string;
      durationSeconds?: number;
    }
  | {
      kind: "typing";
      spaceId: string;
      state: "start" | "stop";
    }
  | {
      kind: "app";
      spaceId: string;
      url: string;
      live?: boolean;
    }
  | {
      kind: "app_update";
      spaceId: string;
      url: string;
      live?: boolean;
      targetMessageId: string;
    };

export type Config = {
  projectId: string;
  projectSecret: string;
  authorizedSenderId: string;
  webhookUrl: string;
  webhookKey: string;
};
