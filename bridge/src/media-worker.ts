import { rm } from "node:fs/promises";
import { assertPrivateFile, resolveInstancePaths } from "../../shared/instance-paths.mjs";
import type { BridgeStore, MediaJob, MediaReference, MediaResult } from "./contracts.ts";
import type { InboundRecord } from "./types.ts";
import { attachmentDisplayText, persistInboundAttachment, withMediaDeadline, InboundAttachmentError, type AttachmentOptions, type ReadableAttachmentContent } from "./inbound-attachment.ts";
import { transcribeInboundVoice, voiceDisplayText, type VoiceOptions, type VoiceSttResult } from "./voice-stt.ts";

export type MediaStore = Pick<BridgeStore, "claimMedia" | "settleMedia">;
export type MediaWorkerOptions = {
  store: MediaStore;
  /** Resolve this exact attachment GUID and actual Spectrum line (space.phone).
   * undefined is unavailable. Never resolve a message's "latest" attachment.
   */
  resolveReference: (reference: MediaReference, signal: AbortSignal) => Promise<ReadableAttachmentContent | undefined>;
  concurrency?: number; jobTimeoutMs?: number; resolveTimeoutMs?: number;
  attachmentOptions?: AttachmentOptions; voiceOptions?: VoiceOptions;
  transcribe?: (path: string, options: VoiceOptions) => Promise<VoiceSttResult>;
  onError?: (code: string) => void;
};
const key = (ref: MediaReference) => JSON.stringify([ref.spaceId, ref.lineId, ref.messageId, ref.attachmentId ?? ""]);
function validReference(ref: MediaReference): boolean {
  return [ref.messageId, ref.spaceId, ref.lineId].every((id) => typeof id === "string" && id.length > 0 && id.length <= 1024) && ["voice", "attachment"].includes(ref.kind);
}
export function pendingMediaPatch(reference: MediaReference): Partial<InboundRecord> {
  return { kind: reference.kind, mediaState: "pending", text: `[${reference.kind} pending] ${reference.name ?? "media"}; processing this message`, ...(reference.attachmentId ? { attachmentId: reference.attachmentId } : {}) };
}

/** Bounded worker consuming durable jobs. notify() never waits on IO. Results
 * enrich only their original event through settleMedia; no accept/enqueue/wake.
 */
export function createMediaWorker(opts: MediaWorkerOptions) {
  const concurrency = opts.concurrency ?? 2;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error("invalid_media_concurrency");
  const active = new Set<Promise<void>>();
  const controllers = new Set<AbortController>();
  const resolutions = new Set<Promise<unknown>>();
  const memory = new Map<string, ReadableAttachmentContent>();
  let scheduled = false;
  let stopped = false;
  function remember(reference: MediaReference, content: ReadableAttachmentContent): void {
    if (stopped) return;
    if (!validReference(reference)) throw new Error("invalid_media_reference");
    // Closures are only a bounded optimization. Eviction/restart uses exact GUID.
    if (memory.size >= 64) memory.delete(memory.keys().next().value!);
    memory.set(key(reference), content);
  }
  async function resolve(job: MediaJob, signal: AbortSignal): Promise<ReadableAttachmentContent | undefined> {
    const reference = job.reference;
    const remembered = memory.get(key(reference));
    memory.delete(key(reference));
    if (remembered) return remembered;
    if (!reference.attachmentId) return undefined;
    if (resolutions.size >= concurrency) throw new InboundAttachmentError("media_resolver_capacity");
    return withMediaDeadline(async (deadlineSignal) => {
      const pending = Promise.resolve().then(() => opts.resolveReference(reference, deadlineSignal));
      resolutions.add(pending);
      void pending.finally(() => resolutions.delete(pending)).catch(() => undefined);
      return await pending;
    }, opts.resolveTimeoutMs ?? 15_000, signal);
  }
  async function processJob(job: MediaJob, signal: AbortSignal): Promise<MediaResult> {
    const ref = job.reference;
    if (!validReference(ref)) return { state: "unavailable", code: "invalid_media_reference" };
    const content = await resolve(job, signal);
    if (!content || (ref.attachmentId && content.id && ref.attachmentId !== content.id)) return { state: "unavailable", code: "media_reference_unavailable_resend" };
    const saved = await persistInboundAttachment(ref.messageId, { ...content, name: content.name ?? ref.name, mimeType: content.mimeType ?? ref.mimeType, size: content.size ?? ref.size }, { ...opts.attachmentOptions, jobId: job.id, signal });
    const patch: Partial<InboundRecord> = {
      attachmentPath: saved.path, attachmentName: saved.name, attachmentMimeType: saved.mimeType, attachmentBytes: saved.bytes,
      ...(saved.attachmentId ? { attachmentId: saved.attachmentId } : {}),
      ...(saved.originalPath ? { attachmentOriginalPath: saved.originalPath, attachmentOriginalMimeType: saved.originalMimeType } : {}),
      mediaJobId: job.id, mediaState: "ready", mediaError: saved.conversionError,
      kind: ref.kind,
    };
    if (ref.kind === "voice") {
      const transcript = await (opts.transcribe ?? transcribeInboundVoice)(saved.path, { ...opts.voiceOptions, paths: opts.voiceOptions?.paths ?? opts.attachmentOptions?.paths, signal });
      if (transcript.wavPath !== saved.path) {
        const paths = opts.voiceOptions?.paths ?? opts.attachmentOptions?.paths ?? resolveInstancePaths();
        const intermediate = await assertPrivateFile(transcript.wavPath, paths.inboundAttachmentsDir);
        await rm(intermediate, { force: true });
      }
      patch.attachmentDuration = ref.duration;
      patch.transcript = transcript.text;
      patch.text = voiceDisplayText(saved.name, saved.mimeType, saved.bytes, ref.duration, transcript.text);
      if (transcript.error || !transcript.text.trim()) {
        patch.mediaState = "failed";
        patch.mediaError = transcript.error ?? "moonshine_empty_transcript";
        patch.text += "\n[transcription unavailable; ask for a resend or text]";
        return { state: "failed", code: patch.mediaError, patch };
      }
    } else {
      patch.text = attachmentDisplayText(saved.name, saved.mimeType, saved.bytes);
      if (saved.conversionError) patch.text += " [JPEG conversion unavailable; original preserved]";
    }
    return { state: "ready", patch };
  }
  async function run(job: MediaJob): Promise<void> {
    const controller = new AbortController();
    controllers.add(controller);
    let result: MediaResult;
    const timer = setTimeout(() => controller.abort(), opts.jobTimeoutMs ?? 180_000);
    try {
      // Await stage cleanup; do not race away from a running native decoder.
      result = await processJob(job, controller.signal);
    } catch (error) {
      result = { state: "failed", code: error instanceof InboundAttachmentError ? error.code : "media_processing_failed" };
    } finally { clearTimeout(timer); controllers.delete(controller); }
    try { opts.store.settleMedia(job.id, result, job.attempts); }
    catch { opts.onError?.("media_settle_failed"); }
  }
  function pump(): void {
    scheduled = false;
    if (stopped) return;
    while (active.size < concurrency) {
      let job: MediaJob | undefined;
      try { job = opts.store.claimMedia(); } catch { opts.onError?.("media_claim_failed"); return; }
      if (!job) break;
      const promise = run(job);
      active.add(promise);
      void promise.finally(() => { active.delete(promise); notify(); }).catch(() => opts.onError?.("media_worker_failed"));
    }
  }
  function notify(): void {
    if (stopped || scheduled) return;
    scheduled = true;
    queueMicrotask(pump);
  }
  async function drain(): Promise<void> {
    do {
      await Promise.resolve(); // let a scheduled pump claim work
      await Promise.allSettled([...active]);
    } while (active.size || scheduled);
  }
  async function stop(): Promise<void> {
    stopped = true;
    for (const controller of controllers) controller.abort();
    memory.clear();
    await drain();
  }
  return { remember, notify, drain, stop, get activeCount() { return active.size; } };
}
