import { constants, lstat, mkdir, open, rm } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { resolveInstancePaths, ensureInstancePaths, assertPrivateFile } from "../../shared/instance-paths.mjs";
import { INBOUND_ATTACHMENT_MAX_BYTES } from "./types.ts";
import { convertHeifIsolated, publishMediaFile } from "./subprocess.ts";

type InstancePaths = ReturnType<typeof resolveInstancePaths>;
/** Compatibility path; resolver is pure and performs no IO mutation. */
export const INBOUND_ATTACHMENTS_DIR = resolveInstancePaths().inboundAttachmentsDir;
export class InboundAttachmentError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "InboundAttachmentError"; }
}

/** Locked Spectrum 12.8.0 exposes stream() with cancellation and read(). */
export type ReadableAttachmentContent = {
  type: string; id?: string; name?: string; mimeType?: string; size?: number;
  read?: (signal?: AbortSignal) => Promise<Buffer | Uint8Array>;
  stream?: () => Promise<ReadableStream<Uint8Array>> | ReadableStream<Uint8Array>;
};
export type SavedInboundAttachment = {
  path: string; bytes: number; name: string; mimeType: string; attachmentId?: string;
  originalPath?: string; originalMimeType?: string; convertedFromHeif?: boolean;
  conversionError?: string;
};
export type AttachmentOptions = {
  paths?: InstancePaths; jobId?: string; signal?: AbortSignal;
  fallbackRead?: (signal?: AbortSignal) => Promise<Buffer | Uint8Array>;
  maxBytes?: number; downloadTimeoutMs?: number; decodeTimeoutMs?: number;
  heifJpegQuality?: number; cgroup?: string;
};

export function sanitizeFileName(name: string): string {
  const base = basename(name).replace(/[^\w.\-()+ ]+/g, "_").trim();
  if (base === "." || base === "..") throw new InboundAttachmentError("unsafe_attachment_name");
  return base ? base.slice(0, 180) : "attachment";
}
function extensionForMime(mime: string): string {
  const extensions: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/heic": ".heic", "image/heif": ".heif", "image/webp": ".webp", "application/pdf": ".pdf", "audio/mp4": ".m4a", "audio/m4a": ".m4a", "audio/mpeg": ".mp3", "audio/x-caf": ".caf", "audio/wav": ".wav", "video/mp4": ".mp4", "video/quicktime": ".mov" };
  return extensions[mime.toLowerCase()] ?? "";
}
function looksLikeHeif(mime: string, name: string, bytes: Buffer): boolean {
  return /^image\/hei[cf]/i.test(mime) || /\.(heic|heif)$/i.test(name) || (bytes.subarray(4, 8).toString("ascii") === "ftyp" && ["heic", "heix", "heif", "mif1", "msf1"].includes(bytes.subarray(8, 12).toString("ascii")));
}

/** Abort the losing operation and clean up late returned streams. SDK metadata/read
 * calls lack AbortSignal: cap outstanding calls so timeouts cannot grow them forever.
 */
const outstandingBufferedReads = new Set<Promise<unknown>>();
export async function withMediaDeadline<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number, parent?: AbortSignal, lateCleanup?: (value: T) => void): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new InboundAttachmentError("invalid_media_deadline");
  const controller = new AbortController();
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectAbort: (reason: Error) => void = () => undefined;
  const abort = () => {
    expired = true;
    controller.abort();
    rejectAbort(new InboundAttachmentError(parent?.aborted ? "media_aborted" : "media_timeout"));
  };
  const cancelled = new Promise<never>((_, reject) => { rejectAbort = reject; });
  parent?.addEventListener("abort", abort, { once: true });
  if (parent?.aborted) abort();
  else timer = setTimeout(abort, timeoutMs);
  const work = Promise.resolve().then(() => {
    controller.signal.throwIfAborted();
    return operation(controller.signal);
  }).then((value) => { if (expired) lateCleanup?.(value); return value; });
  try { return await Promise.race([work, cancelled]); }
  finally { if (timer) clearTimeout(timer); parent?.removeEventListener("abort", abort); }
}

async function readBytes(content: ReadableAttachmentContent, opts: AttachmentOptions, maxBytes: number): Promise<Buffer> {
  return withMediaDeadline(async (signal) => {
    if (typeof content.stream === "function") {
      if (outstandingBufferedReads.size >= 2) throw new InboundAttachmentError("buffered_reader_capacity");
      const opening = Promise.resolve().then(() => content.stream!());
      outstandingBufferedReads.add(opening);
      void opening.finally(() => outstandingBufferedReads.delete(opening)).catch(() => undefined);
      const stream = await opening;
      if (signal.aborted) { void stream.cancel().catch(() => undefined); signal.throwIfAborted(); }
      const reader = stream.getReader();
      const cancel = () => { void reader.cancel().catch(() => undefined); };
      signal.addEventListener("abort", cancel, { once: true });
      const chunks: Buffer[] = [];
      let total = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          signal.throwIfAborted();
          if (done) break;
          total += value.byteLength;
          if (total > maxBytes) { cancel(); throw new InboundAttachmentError("attachment_too_large"); }
          chunks.push(Buffer.from(value));
        }
        return Buffer.concat(chunks, total);
      } finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
    }
    const readers = [content.read, opts.fallbackRead].filter((fn): fn is NonNullable<typeof content.read> => typeof fn === "function");
    for (const read of readers) {
      signal.throwIfAborted();
      if (outstandingBufferedReads.size >= 2) throw new InboundAttachmentError("buffered_reader_capacity");
      const operation = Promise.resolve().then(() => read(signal));
      outstandingBufferedReads.add(operation);
      void operation.finally(() => outstandingBufferedReads.delete(operation)).catch(() => undefined);
      try {
        const bytes = await operation;
        signal.throwIfAborted();
        if (!(bytes instanceof Uint8Array)) throw new InboundAttachmentError("invalid_attachment_bytes");
        if (bytes.byteLength > maxBytes) throw new InboundAttachmentError("attachment_too_large");
        return Buffer.from(bytes);
      } catch (error) {
        if (signal.aborted || error instanceof InboundAttachmentError) throw error;
      }
    }
    throw new InboundAttachmentError("attachment_read_unavailable");
  }, opts.downloadTimeoutMs ?? 30_000, opts.signal);
}

async function atomicMediaWrite(path: string, bytes: Buffer, signal?: AbortSignal): Promise<void> {
  const temporary = `${path}.${randomUUID()}.partial`;
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    for (let offset = 0; offset < bytes.byteLength; offset += 1024 * 1024) {
      signal?.throwIfAborted();
      await handle.writeFile(bytes.subarray(offset, offset + 1024 * 1024));
    }
    await handle.sync();
    signal?.throwIfAborted();
    await handle.close();
    await publishMediaFile(temporary, path);
  } finally {
    await handle.close().catch(() => undefined);
    await rm(temporary, { force: true });
  }
}

/** Persist a complete file atomically under a unique private job directory. */
export async function persistInboundAttachment(messageId: string, content: ReadableAttachmentContent, opts: AttachmentOptions = {}): Promise<SavedInboundAttachment> {
  if (!messageId || messageId === "." || messageId === "..") throw new InboundAttachmentError("invalid_message_id");
  const maxBytes = opts.maxBytes ?? INBOUND_ATTACHMENT_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > INBOUND_ATTACHMENT_MAX_BYTES) throw new InboundAttachmentError("invalid_byte_limit");
  if (content.size !== undefined && (!Number.isFinite(content.size) || content.size < 0 || content.size > maxBytes)) throw new InboundAttachmentError("attachment_too_large");
  let mimeType = content.mimeType?.trim() || "application/octet-stream";
  let name = sanitizeFileName(content.name?.trim() || "attachment");
  if (!extname(name)) name += extensionForMime(mimeType);
  const bytes = await readBytes(content, opts, maxBytes);
  if (!bytes.byteLength) throw new InboundAttachmentError("attachment_empty");
  opts.signal?.throwIfAborted();
  const paths = opts.paths ?? resolveInstancePaths();
  await ensureInstancePaths(paths);
  const hash = createHash("sha256").update(JSON.stringify([messageId, opts.jobId ?? content.id ?? "attachment"])).digest("hex").slice(0, 24);
  const dir = join(paths.inboundAttachmentsDir, `media-job-${hash}-${randomUUID()}`);
  await mkdir(dir, { mode: 0o700 });
  const stat = await lstat(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new InboundAttachmentError("unsafe_attachment_directory");
  let savedPath = join(dir, name);
  try {
    await atomicMediaWrite(savedPath, bytes, opts.signal);
    await assertPrivateFile(savedPath, paths.inboundAttachmentsDir);
    opts.signal?.throwIfAborted();
    const common = content.id ? { attachmentId: content.id } : {};
    if (looksLikeHeif(mimeType, name, bytes)) {
      const originalPath = savedPath;
      const originalMimeType = mimeType.startsWith("image/") ? mimeType : "image/heic";
      const jpegName = `${name.replace(/\.[^.]*$/, "") || "photo"}.jpg`;
      const jpegPath = join(dir, jpegName === name ? `converted-${jpegName}` : jpegName);
      const tempPath = join(dir, `.${randomUUID()}.partial.jpg`);
      try {
        await convertHeifIsolated(originalPath, tempPath, maxBytes, opts.heifJpegQuality ?? 85, { timeoutMs: opts.decodeTimeoutMs ?? 30_000, signal: opts.signal, cgroup: opts.cgroup });
        const verified = await assertPrivateFile(tempPath, paths.inboundAttachmentsDir);
        const convertedBytes = (await lstat(verified)).size;
        if (convertedBytes <= 0 || convertedBytes > maxBytes) throw new InboundAttachmentError("invalid_converted_size");
        opts.signal?.throwIfAborted();
        await publishMediaFile(tempPath, jpegPath);
        savedPath = jpegPath; name = basename(jpegPath); mimeType = "image/jpeg";
        return { path: savedPath, name, mimeType, bytes: convertedBytes, originalPath, originalMimeType, convertedFromHeif: true, ...common };
      } catch {
        opts.signal?.throwIfAborted();
        return { path: originalPath, name, mimeType: originalMimeType, bytes: bytes.byteLength, conversionError: "heif_conversion_failed", ...common };
      } finally { await rm(tempPath, { force: true }); }
    }
    return { path: savedPath, name, mimeType, bytes: bytes.byteLength, ...common };
  } catch (error) {
    // This is a freshly-created, randomly named directory belonging to this job.
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

export function attachmentDisplayText(name: string, mimeType: string, bytes?: number): string {
  return `[attachment] ${name} (${mimeType}${typeof bytes === "number" && bytes > 0 ? `, ${bytes} bytes` : ""})`;
}
