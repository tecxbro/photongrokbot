import { createHash, randomUUID } from "node:crypto";
import { constants, lstat, mkdir, open, rm } from "node:fs/promises";
import { extname, join } from "node:path";
import { resolveInstancePaths, ensureInstancePaths, assertPrivateFile } from "../../shared/instance-paths.mjs";
import { runBoundedProcess, publishMediaFile, type ProcessOptions } from "./subprocess.ts";

export const OUTBOUND_JPEG_DIR = join(resolveInstancePaths().outboundAssetsDir, "converted");
const CONVERT_EXTS = new Set([".png", ".webp", ".gif", ".tif", ".tiff", ".bmp", ".heic", ".heif"]);
export class OutboundJpegError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "OutboundJpegError"; }
}
export type OutboundJpegOptions = ProcessOptions & { paths?: ReturnType<typeof resolveInstancePaths>; ffmpegBin?: string; maxBytes?: number };
export function needsOutboundJpeg(path: string): boolean { return CONVERT_EXTS.has(extname(path).toLowerCase()); }

/** Only staged private files can enter a native decoder. Even passthrough files
 * are validated. Fresh temp + JPEG signature + atomic rename publishes output.
 */
export async function ensureOutboundJpeg(path: string, opts: OutboundJpegOptions = {}): Promise<string> {
  const paths = opts.paths ?? resolveInstancePaths();
  const safe = await assertPrivateFile(path.trim(), paths.outboundAssetsDir);
  const maxBytes = opts.maxBytes ?? 100 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > 100 * 1024 * 1024) throw new OutboundJpegError("invalid_outbound_byte_limit");
  const stat = await lstat(safe);
  if (stat.size <= 0 || stat.size > maxBytes) throw new OutboundJpegError("outbound_attachment_size");
  if (!needsOutboundJpeg(safe)) return safe;
  await ensureInstancePaths(paths);
  const dir = join(paths.outboundAssetsDir, "converted");
  await mkdir(dir, { mode: 0o700 }).catch((error) => { if (error.code !== "EEXIST") throw error; });
  const dirStat = await lstat(dir);
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink() || (dirStat.mode & 0o077) !== 0) throw new OutboundJpegError("unsafe_jpeg_directory");
  const source = await open(safe, constants.O_RDONLY | constants.O_NOFOLLOW);
  const hash = createHash("sha256").update("photon-jpeg-v1\0");
  try {
    const block = Buffer.alloc(1024 * 1024);
    let bytesHashed = 0;
    for (;;) {
      const { bytesRead } = await source.read(block, 0, block.length, null);
      if (!bytesRead) break;
      bytesHashed += bytesRead;
      if (bytesHashed > maxBytes) throw new OutboundJpegError("outbound_attachment_size");
      hash.update(block.subarray(0, bytesRead));
    }
  } finally { await source.close(); }
  const output = join(dir, `${hash.digest("hex")}.jpg`);
  try {
    await assertPrivateFile(output, paths.outboundAssetsDir);
    const cached = await open(output, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const size = (await cached.stat()).size;
      const markers = Buffer.alloc(4);
      await cached.read(markers, 0, 2, 0); await cached.read(markers, 2, 2, size - 2);
      if (size < 4 || size >= maxBytes || !markers.equals(Buffer.from([255,216,255,217]))) throw new OutboundJpegError("outbound_jpeg_invalid");
    } finally { await cached.close(); }
    return output;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const id = randomUUID();
  const temporary = join(dir, `.${id}.partial.jpg`);
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  await handle.close();
  try {
    const result = await runBoundedProcess([
      opts.ffmpegBin ?? "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-threads", "1", "-max_alloc", "67108864", "-protocol_whitelist", "file,pipe", "-format_whitelist", "image2,image2pipe,png_pipe,jpeg_pipe,webp_pipe,gif,tiff_pipe,bmp_pipe,heif,mov", "-i", safe,
      "-frames:v", "1", "-q:v", "2", "-threads", "1", "-fs", String(maxBytes), "-f", "image2", temporary,
    ], { ...opts, timeoutMs: opts.timeoutMs ?? 30_000 });
    if (result.code !== 0) throw new OutboundJpegError("outbound_jpeg_decode_failed");
    const unchanged = await lstat(safe);
    if (unchanged.size !== stat.size || unchanged.mtimeMs !== stat.mtimeMs) throw new OutboundJpegError("outbound_source_changed");
    await assertPrivateFile(temporary, paths.outboundAssetsDir);
    const resultSize = (await lstat(temporary)).size;
    if (resultSize < 4 || resultSize >= maxBytes) throw new OutboundJpegError("outbound_jpeg_size");
    const file = await open(temporary, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const first = Buffer.alloc(2), last = Buffer.alloc(2);
      await file.read(first, 0, 2, 0); await file.read(last, 0, 2, resultSize - 2);
      if (first[0] !== 255 || first[1] !== 216 || last[0] !== 255 || last[1] !== 217) throw new OutboundJpegError("outbound_jpeg_invalid");
      await file.sync();
    } finally { await file.close(); }
    opts.signal?.throwIfAborted();
    await publishMediaFile(temporary, output);
    return output;
  } finally { await rm(temporary, { force: true }); }
}

/** Sequential conversion prevents attachment groups spawning unlimited decoders. */
export async function normalizeEnqueueAttachments<T extends { kind?: string; attachmentPath?: string; attachmentPaths?: string[] }>(input: T, opts: OutboundJpegOptions = {}): Promise<T> {
  if (input.kind === "attachment_group" && Array.isArray(input.attachmentPaths)) {
    const attachmentPaths: string[] = [];
    for (const path of input.attachmentPaths) attachmentPaths.push(await ensureOutboundJpeg(path, opts));
    return { ...input, attachmentPaths };
  }
  if (input.attachmentPath) return { ...input, attachmentPath: await ensureOutboundJpeg(input.attachmentPath, opts) };
  return input;
}
