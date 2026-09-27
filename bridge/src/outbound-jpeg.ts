import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { spawn } from "node:child_process";
import { DATA_DIR } from "./types.ts";

/** Converted outbound images land here (PNG/WebP/… → JPEG). */
export const OUTBOUND_JPEG_DIR = join(DATA_DIR, "outbound-jpeg");

const JPEG_EXTS = new Set([".jpg", ".jpeg"]);
/** Raster formats we re-encode to JPEG before Photon send. */
const CONVERT_EXTS = new Set([
  ".png",
  ".webp",
  ".gif",
  ".tif",
  ".tiff",
  ".bmp",
  ".heic",
  ".heif",
]);

export class OutboundJpegError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboundJpegError";
  }
}

export function needsOutboundJpeg(path: string): boolean {
  return CONVERT_EXTS.has(extname(path).toLowerCase());
}

function runFfmpeg(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-i",
      input,
      // High-quality still JPEG; first frame only (covers animated GIF/WebP).
      "-frames:v",
      "1",
      "-q:v",
      "2",
      output,
    ];
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      reject(new OutboundJpegError(`ffmpeg failed to start: ${err.message}`));
    });
    child.on("close", (code) => {
      if (code === 0 && existsSync(output)) {
        resolve();
        return;
      }
      const tip = stderr.trim().split("\n").slice(-4).join(" | ");
      reject(
        new OutboundJpegError(
          `ffmpeg convert failed (exit ${code}) for ${input}: ${tip || "no stderr"}`,
        ),
      );
    });
  });
}

/**
 * Ensure an outbound image path is JPEG for Photon/iMessage.
 * Already-.jpg/.jpeg and non-raster files (pdf, etc.) pass through unchanged.
 * PNG/WebP/GIF/… are re-encoded under data/outbound-jpeg/.
 */
export async function ensureOutboundJpeg(path: string): Promise<string> {
  const trimmed = path.trim();
  if (!trimmed) {
    throw new OutboundJpegError("outbound attachment path is empty");
  }
  if (!existsSync(trimmed)) {
    throw new OutboundJpegError(`outbound attachment not found: ${trimmed}`);
  }
  const ext = extname(trimmed).toLowerCase();
  if (JPEG_EXTS.has(ext) || !CONVERT_EXTS.has(ext)) {
    return trimmed;
  }

  await mkdir(OUTBOUND_JPEG_DIR, { recursive: true });
  const st = await stat(trimmed);
  const key = createHash("sha1")
    .update(trimmed)
    .update("\0")
    .update(String(st.size))
    .update("\0")
    .update(String(st.mtimeMs))
    .digest("hex")
    .slice(0, 12);
  const stem =
    basename(trimmed, ext)
      .replace(/[^\w.\-()+ ]+/g, "_")
      .trim()
      .slice(0, 120) || "image";
  const out = join(OUTBOUND_JPEG_DIR, `${stem}-${key}.jpg`);
  if (existsSync(out)) {
    return out;
  }
  await runFfmpeg(trimmed, out);
  return out;
}

/** Rewrite attachment path(s) on an enqueue input to JPEG when needed. */
export async function normalizeEnqueueAttachments<T extends {
  kind?: string;
  attachmentPath?: string;
  attachmentPaths?: string[];
}>(input: T): Promise<T> {
  if (input.kind === "attachment_group" && Array.isArray(input.attachmentPaths)) {
    const attachmentPaths = await Promise.all(
      input.attachmentPaths.map((p) => ensureOutboundJpeg(p)),
    );
    return { ...input, attachmentPaths };
  }
  if (input.attachmentPath) {
    return {
      ...input,
      attachmentPath: await ensureOutboundJpeg(input.attachmentPath),
    };
  }
  return input;
}
