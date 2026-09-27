import { Spectrum, app, attachment, edit, group, poll, voice, type Message, type Space } from "spectrum-ts";
import { effect, imessage } from "spectrum-ts/providers/imessage";
import type { AttachmentGroupPart, Config, InboundRecord, OutboundItem } from "./types.ts";
import { sendReplyWithFallback } from "./reply-fallback.ts";
import {
  DEBOUNCE_MS,
  TYPING_HEARTBEAT_MS,
  TYPING_TIMEOUT_MS,
} from "./types.ts";
import {
  shapeInboundContent,
  toInboundRecord,
  type ContentLike,
} from "./inbound.ts";
import {
  attachmentDisplayText,
  persistInboundAttachment,
  InboundAttachmentError,
  type ReadableAttachmentContent,
} from "./inbound-attachment.ts";
import {
  transcribeInboundVoice,
  voiceDisplayText,
} from "./voice-stt.ts";
import {
  addHandledId,
  addWebhookPending,
  appendInbound,
  enqueueOutbound,
  ensureDataDir,
  listWebhookPending,
  loadHandledIds,
  loadOutboundQueue,
  loadPendingBatch,
  newId,
  removeWebhookPending,
  savePendingBatch,
  updateOutbound,
  writeUnreadBatch,
  savePollMeta,
  loadPollMeta,
  saveAppCardSession,
  loadAppCardSession,
  type AppCardSession,
} from "./storage.ts";
import { drainCardsReady } from "./cards-ready.ts";
import {
  applyResolvedOptionToInbound,
  persistAttachmentGroupMapping,
  resolveReactionOption,
} from "./reaction-option.ts";
import {
  GREETING_DEBOUNCE_MS,
  batchCasualKind,
  isGreetingOnlyBatch,
  pickCannedReply,
} from "./greeting.ts";

function log(message: string): void {
  console.log(`[{{DEPLOY_ID_PREFIX}}] ${message}`);
}

function outboundKind(
  item: OutboundItem,
): "text" | "reply" | "react" | "poll" | "voice" | "typing" | "attachment_group" | "app" | "app_update" {
  return item.kind ?? "text";
}

/** Resolve short effect name → Spectrum imessage.effect.message constant. */
function resolveMessageEffect(name: string): string {
  const map = imessage.effect.message as Record<string, string>;
  const value = map[name];
  if (!value) {
    throw new Error(`unknown message effect: ${name}`);
  }
  return value;
}


type MessageWithAppSession = Message & {
  miniAppCardSession?: AppCardSession;
};

function extractAppCardSession(message: unknown): AppCardSession | undefined {
  if (!message || typeof message !== "object") return undefined;
  const raw = (message as MessageWithAppSession).miniAppCardSession;
  if (!raw || typeof raw !== "object") return undefined;
  const { chatGuid, messageGuid, sessionId, targetMessageGuid } = raw as AppCardSession;
  if (
    typeof chatGuid !== "string" ||
    typeof messageGuid !== "string" ||
    typeof sessionId !== "string" ||
    typeof targetMessageGuid !== "string"
  ) {
    return undefined;
  }
  return { chatGuid, messageGuid, sessionId, targetMessageGuid };
}

/** Attach persisted miniAppCardSession onto the Message when getMessage lacks it. */
async function ensureAppCardSession(
  message: Message,
  messageId: string,
): Promise<Message> {
  const existing = extractAppCardSession(message);
  if (existing) return message;
  const stored = await loadAppCardSession(messageId);
  if (!stored) return message;
  (message as MessageWithAppSession).miniAppCardSession = stored;
  return message;
}

export class GpProofRuntime {
  private readonly config: Config;
  private readonly spaces = new Map<string, Space>();
  private handled = new Set<string>();
  private pending: InboundRecord[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private outboundTimer: ReturnType<typeof setInterval> | null = null;
  private webhookTimer: ReturnType<typeof setInterval> | null = null;
  private cardsReadyTimer: ReturnType<typeof setInterval> | null = null;
  private sending = new Set<string>();
  private flushing = false;
  private app: Awaited<ReturnType<typeof Spectrum>> | undefined;
  private stopped = false;
  /** Spaces where we showed typing after flush; cleared on first outbound or timeout. */
  private typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Refresh startTyping while waiting for first text/reply. */
  private typingHeartbeats = new Map<string, ReturnType<typeof setInterval>>();

  constructor(config: Config) {
    this.config = config;
  }

  async start(): Promise<void> {
    await ensureDataDir();
    this.handled = await loadHandledIds();
    this.pending = await loadPendingBatch();
    if (this.pending.length > 0) this.scheduleFlush();

    const app = await Spectrum({
      projectId: this.config.projectId,
      projectSecret: this.config.projectSecret,
      providers: [imessage.config()],
    });
    this.app = app;
    log("hosted iMessage provider connected");

    this.outboundTimer = setInterval(() => {
      void this.drainOutbound();
    }, 500);
    this.webhookTimer = setInterval(() => {
      void this.drainWebhooks();
    }, 2000);
    this.cardsReadyTimer = setInterval(() => {
      void this.drainCardsReadyWatchdog();
    }, 3000);
    void this.drainOutbound();
    void this.drainWebhooks();
    void this.drainCardsReadyWatchdog();

    const onStop = () => {
      void this.stop();
    };
    process.on("SIGINT", onStop);
    process.on("SIGTERM", onStop);

    for await (const [space, message] of app.messages) {
      if (this.stopped) break;
      try {
        await this.onMessage(space, message);
      } catch (err) {
        console.error("[{{DEPLOY_ID_PREFIX}}] inbound handler error", err);
      }
    }
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.outboundTimer) clearInterval(this.outboundTimer);
    if (this.webhookTimer) clearInterval(this.webhookTimer);
    if (this.cardsReadyTimer) clearInterval(this.cardsReadyTimer);
    for (const spaceId of [...this.typingTimers.keys()]) {
      await this.stopTypingBestEffort(spaceId);
    }
    await this.flushPending();
    await this.app?.stop();
    log("stopped");
    process.exit(0);
  }

  private async onMessage(space: Space, message: Message): Promise<void> {
    if (message.direction === "outbound") return;
    if (message.platform !== "imessage") return;

    const senderId = message.sender?.id;
    if (!senderId || senderId !== this.config.authorizedSenderId) {
      log(`drop unauthorized sender id=${message.id}`);
      return;
    }
    if (this.handled.has(message.id)) {
      log(`drop duplicate id=${message.id}`);
      return;
    }

    // Recipient read our outbound — do not queue or wake Grok.
    if ((message.content as ContentLike | undefined)?.type === "read") {
      this.handled.add(message.id);
      await addHandledId(message.id);
      log(`ignore inbound read receipt id=${message.id}`);
      return;
    }

    const shaped = shapeInboundContent(message.content as ContentLike);
    if (shaped === null) {
      this.handled.add(message.id);
      await addHandledId(message.id);
      log(`ignore unsupported content type id=${message.id}`);
      return;
    }

    // Mark chat read immediately so sender sees receipt before Grok replies.
    try {
      await message.read();
      log(`marked read id=${message.id}`);
    } catch (err) {
      log(`mark read failed id=${message.id} err=${String(err)}`);
    }

    this.spaces.set(space.id, space);

    let attachmentExtras:
      | {
          attachmentPath: string;
          attachmentBytes: number;
          attachmentOriginalPath?: string;
          attachmentOriginalMimeType?: string;
          transcript?: string;
        }
      | undefined;
    if (shaped.kind === "attachment" || shaped.kind === "voice") {
      const content = message.content as ReadableAttachmentContent;
      try {
        const saved = await persistInboundAttachment(message.id, content, {
          fallbackRead: async () => {
            if (!this.app || !content.id) {
              throw new Error("no app or attachment id for fallback");
            }
            const im = imessage(this.app);
            const att = await im.getAttachment(content.id);
            if (!att) throw new Error(`getAttachment returned empty for ${content.id}`);
            return att.read();
          },
        });
        attachmentExtras = {
          attachmentPath: saved.path,
          attachmentBytes: saved.bytes,
          ...(saved.originalPath
            ? { attachmentOriginalPath: saved.originalPath }
            : {}),
          ...(saved.originalMimeType
            ? { attachmentOriginalMimeType: saved.originalMimeType }
            : {}),
        };
        shaped.attachmentName = saved.name;
        shaped.attachmentMimeType = saved.mimeType;
        if (saved.attachmentId) shaped.attachmentId = saved.attachmentId;
        log(
          `saved inbound attachment id=${message.id} path=${saved.path} bytes=${saved.bytes}` +
            (saved.convertedFromHeif ? " converted=heif2jpeg" : ""),
        );

        if (shaped.kind === "voice") {
          const stt = await transcribeInboundVoice(saved.path);
          if (stt.text) {
            attachmentExtras.transcript = stt.text;
            log(
              `moonshine stt ok id=${message.id} wav=${stt.wavPath} chars=${stt.text.length}`,
            );
          } else {
            log(
              `moonshine stt empty/fail id=${message.id} wav=${stt.wavPath} err=${stt.error ?? "no text"}`,
            );
          }
          shaped.text = voiceDisplayText(
            saved.name,
            saved.mimeType,
            saved.bytes,
            shaped.attachmentDuration,
            stt.text || undefined,
          );
        } else {
          shaped.text = attachmentDisplayText(
            saved.name,
            saved.mimeType,
            saved.bytes,
          );
        }
      } catch (err) {
        const msg =
          err instanceof InboundAttachmentError
            ? err.message
            : String(err);
        log(`inbound attachment download failed id=${message.id} err=${msg}`);
        // Still forward metadata so Front Door knows a file arrived even if bytes failed.
        shaped.text = `${shaped.text} [download failed: ${msg}]`;
      }
    }

    let record = toInboundRecord(
      shaped,
      {
        id: message.id,
        spaceId: space.id,
        senderId,
        timestamp: message.timestamp.toISOString(),
        receivedAt: new Date().toISOString(),
      },
      attachmentExtras,
    );
    if (record.kind === "poll_vote") {
      const pollMessageId = message.id.split(":")[0] ?? "";
      if (pollMessageId) {
        try {
          const meta = await loadPollMeta(pollMessageId);
          if (meta?.title && (!record.pollTitle || record.pollTitle === "Poll")) {
            record = {
              ...record,
              pollTitle: meta.title,
              text: `${record.pollSelected === false ? "unvoted" : "voted"} ${record.pollOption ?? "?"} on "${meta.title}"`,
            };
          }
        } catch (err) {
          log(`poll meta load failed id=${pollMessageId} err=${String(err)}`);
        }
      }
    }
    if (record.kind === "reaction") {
      try {
        const resolved = await resolveReactionOption(record.targetMessageId);
        record = applyResolvedOptionToInbound(record, resolved);
        if (resolved.ambiguous) {
          log(
            `reaction option ambiguous id=${message.id} reason=${resolved.reason} names=${resolved.optionNames.length}`,
          );
        } else {
          log(
            `reaction option resolved id=${message.id} part=${resolved.partIndex} title=${resolved.title ?? resolved.optionId ?? "?"}`,
          );
        }
      } catch (err) {
        log(`reaction option resolve failed id=${message.id} err=${String(err)}`);
      }
    }

    this.handled.add(message.id);
    await addHandledId(message.id);
    await appendInbound(record);
    this.pending.push(record);
    await savePendingBatch(this.pending);
    log(
      `queued inbound kind=${record.kind ?? "text"} id=${message.id} space=${space.id}`,
    );
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    const delay = isGreetingOnlyBatch(this.pending)
      ? GREETING_DEBOUNCE_MS
      : DEBOUNCE_MS;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.flushPending();
    }, delay);
  }

  private async flushPending(): Promise<void> {
    if (this.flushing) return;
    if (this.pending.length === 0) return;
    this.flushing = true;
    try {
      const messages = this.pending;
      this.pending = [];
      await savePendingBatch([]);
      const batchId = newId("b");
      const greetingOnly = isGreetingOnlyBatch(messages);

      await writeUnreadBatch({
        batchId,
        flushedAt: new Date().toISOString(),
        messages,
        ...(greetingOnly ? { handledBy: "runtime-greeting" as const } : {}),
      });
      log(`flushed unread batchId=${batchId} count=${messages.length}`);

      if (greetingOnly) {
        await this.enqueueGreetingFastPath(batchId, messages);
        return;
      }

      await addWebhookPending(batchId);

      // Best-effort typing while Grok thinks.
      const spaceIds = [...new Set(messages.map((m) => m.spaceId))];
      for (const spaceId of spaceIds) {
        void this.startTypingBestEffort(spaceId);
      }

      await this.postWebhook(batchId);
    } finally {
      this.flushing = false;
    }
  }

  /**
   * Canned reply without waking Front Door / Chatty.
   * One reply per space, threaded to the latest text inbound when possible.
   */
  private async enqueueGreetingFastPath(
    batchId: string,
    messages: InboundRecord[],
  ): Promise<void> {
    const kind = batchCasualKind(messages);
    const bySpace = new Map<string, InboundRecord[]>();
    for (const m of messages) {
      const list = bySpace.get(m.spaceId) ?? [];
      list.push(m);
      bySpace.set(m.spaceId, list);
    }

    for (const [spaceId, spaceMessages] of bySpace) {
      const texts = spaceMessages.filter((m) => (m.kind ?? "text") === "text");
      const target = texts[texts.length - 1];
      const reply = pickCannedReply(kind, Date.now() + spaceId.length);
      if (target) {
        await enqueueOutbound({
          kind: "reply",
          spaceId,
          targetMessageId: target.id,
          text: reply,
        });
      } else {
        await enqueueOutbound({ kind: "text", spaceId, text: reply });
      }
      log(
        `greeting fast-path batchId=${batchId} space=${spaceId} reply=${JSON.stringify(reply)}`,
      );
    }
  }

  private async startTypingBestEffort(spaceId: string): Promise<void> {
    try {
      const space = await this.resolveSpace(spaceId);
      await space.startTyping();
      const prev = this.typingTimers.get(spaceId);
      if (prev) clearTimeout(prev);
      this.typingTimers.set(
        spaceId,
        setTimeout(() => {
          void this.stopTypingBestEffort(spaceId);
        }, TYPING_TIMEOUT_MS),
      );
      // iMessage typing fades; refresh until first text/reply or timeout.
      if (!this.typingHeartbeats.has(spaceId)) {
        this.typingHeartbeats.set(
          spaceId,
          setInterval(() => {
            void (async () => {
              try {
                const s = await this.resolveSpace(spaceId);
                await s.startTyping();
                log(`typing heartbeat space=${spaceId}`);
              } catch (err) {
                log(`typing heartbeat failed space=${spaceId} err=${String(err)}`);
              }
            })();
          }, TYPING_HEARTBEAT_MS),
        );
      }
      log(`typing start space=${spaceId}`);
    } catch (err) {
      log(`typing start failed space=${spaceId} err=${String(err)}`);
    }
  }

  private async stopTypingBestEffort(spaceId: string): Promise<void> {
    const prev = this.typingTimers.get(spaceId);
    if (prev) clearTimeout(prev);
    this.typingTimers.delete(spaceId);
    const beat = this.typingHeartbeats.get(spaceId);
    if (beat) clearInterval(beat);
    this.typingHeartbeats.delete(spaceId);
    try {
      const space = await this.resolveSpace(spaceId);
      await space.stopTyping();
      log(`typing stop space=${spaceId}`);
    } catch (err) {
      log(`typing stop failed space=${spaceId} err=${String(err)}`);
    }
  }

  private async postWebhook(batchId: string): Promise<void> {
    try {
      const res = await fetch(this.config.webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.webhookKey}`,
        },
        body: JSON.stringify({ batchId }),
      });
      if (!res.ok) {
        log(`webhook failed batchId=${batchId} status=${res.status}`);
        return;
      }
      await removeWebhookPending(batchId);
      log(`webhook ok batchId=${batchId}`);
    } catch (err) {
      log(`webhook error batchId=${batchId} err=${String(err)}`);
    }
  }

  private async drainWebhooks(): Promise<void> {
    const pending = await listWebhookPending();
    for (const batchId of pending) {
      await this.postWebhook(batchId);
    }
  }

  /** Durable Image Cards final-enqueue when PNGs land after FD released the turn. */
  private async drainCardsReadyWatchdog(): Promise<void> {
    try {
      const n = await drainCardsReady();
      if (n > 0) {
        log(`cards-ready enqueued stacks=${n}`);
      }
    } catch (err) {
      log(`cards-ready drain error err=${String(err)}`);
    }
  }

  private async drainOutbound(): Promise<void> {
    const items = await loadOutboundQueue();
    const now = Date.now();
    for (const item of items) {
      if (item.status !== "queued") continue;
      if (this.sending.has(item.id)) continue;
      if (item.nextAttemptAt && Date.parse(item.nextAttemptAt) > now) continue;
      this.sending.add(item.id);
      try {
        await this.sendOutbound(item);
      } finally {
        this.sending.delete(item.id);
      }
    }
  }

  private async sendOutbound(item: OutboundItem): Promise<void> {
    const nextAttempts = item.attempts + 1;
    const kind = outboundKind(item);
    try {
      const space = await this.resolveSpace(item.spaceId);

      if (kind === "typing") {
        if (item.kind !== "typing") throw new Error("typing kind mismatch");
        if (item.state === "start") {
          await this.startTypingBestEffort(item.spaceId);
        } else {
          await this.stopTypingBestEffort(item.spaceId);
        }
      } else if (kind === "react") {
        if (item.kind !== "react") throw new Error("react kind mismatch");
        const target = await space.getMessage(item.targetMessageId);
        if (!target) {
          throw new Error(`target message not found: ${item.targetMessageId}`);
        }
        // undefined = platform skipped reactions → treat as done (no retry loop)
        await target.react(item.emoji);
        // Keep typing through a tapback; stop only on text/reply.
      } else if (kind === "reply") {
        if (item.kind !== "reply") throw new Error("reply kind mismatch");
        const delivery = await sendReplyWithFallback(
          space,
          item.targetMessageId,
          item.text,
        );
        if (delivery.status === "failed") {
          await updateOutbound(item.id, {
            status: "failed",
            attempts: nextAttempts,
            failedAt: new Date().toISOString(),
            lastError: delivery.reason,
            nextAttemptAt: undefined,
          });
          log(`outbound dead-letter kind=reply id=${item.id} reason=${delivery.reason}`);
          return;
        }
        if (delivery.mode === "fallback") {
          log(`outbound reply fallback id=${item.id} reason=${delivery.replyError}`);
        }
        await this.stopTypingBestEffort(item.spaceId);
      } else if (kind === "voice") {
        if (item.kind !== "voice") throw new Error("voice kind mismatch");
        const sent = await space.send(
          voice(item.audioPath, {
            ...(typeof item.durationSeconds === "number"
              ? { duration: item.durationSeconds }
              : {}),
          }),
        );
        if (sent === undefined) {
          await this.scheduleRetry(item.id, nextAttempts, "undefined-result");
          return;
        }
        await this.stopTypingBestEffort(item.spaceId);
        await updateOutbound(item.id, {
          status: "sent",
          attempts: nextAttempts,
          sentAt: new Date().toISOString(),
          lastError: undefined,
          nextAttemptAt: undefined,
          messageId: sent.id,
        });
        log(
          `outbound sent kind=voice id=${item.id} space=${item.spaceId} messageId=${sent.id} path=${item.audioPath}`,
        );
        return;
      } else if (kind === "poll") {
        if (item.kind !== "poll") throw new Error("poll kind mismatch");
        const sent = await space.send(poll(item.title, item.options));
        if (sent === undefined) {
          await this.scheduleRetry(item.id, nextAttempts, "undefined-result");
          return;
        }
        await this.stopTypingBestEffort(item.spaceId);
        await updateOutbound(item.id, {
          status: "sent",
          attempts: nextAttempts,
          sentAt: new Date().toISOString(),
          lastError: undefined,
          nextAttemptAt: undefined,
          messageId: sent.id,
        });
        try {
          await savePollMeta(sent.id, item.title, item.options);
        } catch (err) {
          log(`poll meta save failed messageId=${sent.id} err=${String(err)}`);
        }
        log(`outbound sent kind=poll id=${item.id} space=${item.spaceId} messageId=${sent.id}`);
        return;
      } else if (kind === "app") {
        if (item.kind !== "app") throw new Error("app kind mismatch");
        const live = item.live === true;
        const sent = await space.send(
          live ? app(item.url, { live: true }) : app(item.url),
        );
        if (sent === undefined) {
          await this.scheduleRetry(item.id, nextAttempts, "undefined-result");
          return;
        }
        await this.stopTypingBestEffort(item.spaceId);
        await updateOutbound(item.id, {
          status: "sent",
          attempts: nextAttempts,
          sentAt: new Date().toISOString(),
          lastError: undefined,
          nextAttemptAt: undefined,
          messageId: sent.id,
        });
        try {
          const session = extractAppCardSession(sent);
          if (session) {
            await saveAppCardSession(sent.id, session, {
              live,
              url: item.url,
            });
          }
        } catch (err) {
          log(`app session save failed messageId=${sent.id} err=${String(err)}`);
        }
        log(
          `outbound sent kind=app id=${item.id} space=${item.spaceId} messageId=${sent.id} live=${live}`,
        );
        return;
      } else if (kind === "app_update") {
        if (item.kind !== "app_update") throw new Error("app_update kind mismatch");
        const live = item.live === true;
        let target = await space.getMessage(item.targetMessageId);
        if (!target) {
          throw new Error(`target message not found: ${item.targetMessageId}`);
        }
        target = await ensureAppCardSession(target, item.targetMessageId);
        const sent = await space.send(
          edit(live ? app(item.url, { live: true }) : app(item.url), target),
        );
        // edit is fire-and-forget; providers resolve undefined
        await this.stopTypingBestEffort(item.spaceId);
        await updateOutbound(item.id, {
          status: "sent",
          attempts: nextAttempts,
          sentAt: new Date().toISOString(),
          lastError: undefined,
          nextAttemptAt: undefined,
        });
        try {
          const session = extractAppCardSession(target);
          if (session) {
            await saveAppCardSession(item.targetMessageId, session, {
              live,
              url: item.url,
            });
          }
        } catch (err) {
          log(
            `app_update session save failed messageId=${item.targetMessageId} err=${String(err)}`,
          );
        }
        log(
          `outbound sent kind=app_update id=${item.id} space=${item.spaceId} target=${item.targetMessageId} live=${live} result=${sent === undefined ? "undefined" : "ok"}`,
        );
        return;
      } else if (kind === "attachment_group") {
        if (item.kind !== "attachment_group") {
          throw new Error("attachment_group kind mismatch");
        }
        const paths = item.attachmentPaths;
        if (paths.length < 2) {
          throw new Error("attachment_group requires at least 2 paths");
        }
        // Keep as ONE Spectrum group so iMessage provider uses sendMultipart
        // (upload each → attachmentGuid parts → single sendMultipart). Do not
        // expand into space.send(attachment, attachment, ...) — that is N messages.
        const payload = group(
          attachment(paths[0]!),
          attachment(paths[1]!),
          ...paths.slice(2).map((p) => attachment(p)),
        );
        const sent = await space.send(payload);
        if (sent === undefined) {
          await this.scheduleRetry(item.id, nextAttempts, "undefined-result");
          return;
        }
        await this.stopTypingBestEffort(item.spaceId);
        const parentMessageId = sent.id;
        let parts: AttachmentGroupPart[] | undefined;
        let batchId = item.batchId;
        try {
          const mapped = await persistAttachmentGroupMapping({
            outboundId: item.id,
            spaceId: item.spaceId,
            parentMessageId,
            paths,
            batchId: item.batchId,
            cards: item.cards,
          });
          parts = mapped.parts;
          batchId = mapped.batchId;
          log(
            `attachment_group presentation saved batchId=${mapped.batchId} messageId=${parentMessageId} parts=${mapped.parts.length}`,
          );
        } catch (err) {
          log(
            `attachment_group presentation save failed id=${item.id} messageId=${parentMessageId} err=${String(err)}`,
          );
        }
        await updateOutbound(item.id, {
          status: "sent",
          attempts: nextAttempts,
          sentAt: new Date().toISOString(),
          lastError: undefined,
          nextAttemptAt: undefined,
          messageId: parentMessageId,
          ...(batchId ? { batchId } : {}),
          ...(parts ? { parts } : {}),
        });
        log(
          `outbound sent kind=attachment_group id=${item.id} space=${item.spaceId} count=${paths.length} messageId=${parentMessageId}`,
        );
        return;
      } else {
        // text (missing kind treated as text)
        const textItem = item as Extract<OutboundItem, { kind?: "text" }>;
        let payload: Parameters<Space["send"]>[0] = textItem.attachmentPath
          ? attachment(textItem.attachmentPath)
          : textItem.text;
        if (textItem.effect) {
          const effectId = resolveMessageEffect(textItem.effect);
          payload = effect(payload, effectId as never);
          log(
            `outbound effect=${textItem.effect} id=${item.id} space=${item.spaceId}`,
          );
        }
        const sent = await space.send(payload);
        if (sent === undefined) {
          await this.scheduleRetry(item.id, nextAttempts, "undefined-result");
          return;
        }
        await this.stopTypingBestEffort(item.spaceId);
      }

      await updateOutbound(item.id, {
        status: "sent",
        attempts: nextAttempts,
        sentAt: new Date().toISOString(),
        lastError: undefined,
        nextAttemptAt: undefined,
      });
      log(`outbound sent kind=${kind} id=${item.id} space=${item.spaceId}`);
    } catch (err) {
      await this.scheduleRetry(item.id, nextAttempts, String(err));
      log(`outbound throw kind=${kind} id=${item.id}`);
    }
  }

  private async scheduleRetry(
    id: string,
    nextAttempts: number,
    lastError: string,
  ): Promise<void> {
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(nextAttempts, 5));
    await updateOutbound(id, {
      attempts: nextAttempts,
      lastError,
      nextAttemptAt: new Date(Date.now() + delay).toISOString(),
    });
    if (lastError === "undefined-result") {
      log(`outbound not marked sent id=${id} reason=undefined-result`);
    }
  }

  private async resolveSpace(spaceId: string): Promise<Space> {
    const cached = this.spaces.get(spaceId);
    if (cached) return cached;
    if (!this.app) throw new Error("spectrum app not started");
    const im = imessage(this.app);
    const space = await im.space.get(spaceId);
    if (!space) throw new Error(`space not found: ${spaceId}`);
    this.spaces.set(spaceId, space);
    return space;
  }
}
