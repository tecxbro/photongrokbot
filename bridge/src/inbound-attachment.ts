import { mkdir, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { heifToJpeg } from "heif2jpeg";
import {
  DATA_DIR,
  INBOUND_ATTACHMENT_MAX_BYTES,
} from "./types.ts";

export const INBOUND_ATTACHMENTS_DIR = join(DATA_DIR, "inbound-attachments");

export class InboundAttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InboundAttachmentError";
  }
}

/** Readable attachment-like Spectrum content (attachment or voice). */
export type ReadableAttachmentContent = {
  type: string;
  id?: string;
  name?: string;
  mimeType?: string;
  size?: number;
  read?: () => Promise<Buffer | Uint8Array>;
};

export type SavedInboundAttachment = {
  path: string;
  bytes: number;
  name: string;
  mimeType: string;
  attachmentId?: string;
  /** Present when HEIC/HEIF was converted; original bytes kept on disk. */
  originalPath?: string;
  originalMimeType?: string;
  convertedFromHeif?: boolean;
};

function sanitizeFileName(name: string): string {
  const base = basename(name).replace(/[^\w.\-()+ ]+/g, "_").trim();
  return base.length > 0 ? base.slice(0, 180) : "attachment";
}

function extensionForMime(mimeType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/heic": ".heic",
    "image/heif": ".heif",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
    "audio/mp4": ".m4a",
    "audio/m4a": ".m4a",
    "audio/mpeg": ".mp3",
    "audio/x-caf": ".caf",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
  };
  return map[mimeType] ?? "";
}

function looksLikeHeif(mimeType: string, name: string, buf: Buffer): boolean {
  const mime = mimeType.toLowerCase();
  if (mime === "image/heic" || mime === "image/heif" || mime === "image/heic-sequence") {
    return true;
  }
  const lower = name.toLowerCase();
  if (lower.endsWith(".heic") || lower.endsWith(".heif")) return true;
  // ISO BMFF: bytes 4..8 often "ftyp", then brand heic/heif/mif1
  if (buf.byteLength >= 12) {
    const brand = buf.subarray(4, 8).toString("ascii");
    if (brand === "ftyp") {
      const major = buf.subarray(8, 12).toString("ascii");
      if (
        major === "heic" ||
        major === "heix" ||
        major === "heif" ||
        major === "mif1" ||
        major === "msf1"
      ) {
        return true;
      }
    }
  }
  return false;
}

function jpegNameFrom(name: string): string {
  const base = name.replace(/\.(heic|heif)$/i, "");
  const stem = extname(base) ? base.slice(0, -extname(base).length) : base;
  return `${stem || "photo"}.jpg`;
}

/**
 * Download attachment bytes via content.read() and write under
 * data/inbound-attachments/<messageId>/.
 * HEIC/HEIF is converted to JPEG (heif2jpeg); original kept alongside.
 */
export async function persistInboundAttachment(
  messageId: string,
  content: ReadableAttachmentContent,
  opts?: {
    /** Fallback reader when content.read is missing/fails (e.g. im.getAttachment). */
    fallbackRead?: () => Promise<Buffer | Uint8Array>;
    maxBytes?: number;
    heifJpegQuality?: number;
  },
): Promise<SavedInboundAttachment> {
  const maxBytes = opts?.maxBytes ?? INBOUND_ATTACHMENT_MAX_BYTES;
  let mimeType =
    typeof content.mimeType === "string" && content.mimeType.length > 0
      ? content.mimeType
      : "application/octet-stream";
  let name =
    typeof content.name === "string" && content.name.trim().length > 0
      ? sanitizeFileName(content.name.trim())
      : "attachment";
  if (!extname(name)) {
    const ext = extensionForMime(mimeType);
    if (ext) name = `${name}${ext}`;
  }

  if (typeof content.size === "number" && content.size > maxBytes) {
    throw new InboundAttachmentError(
      `attachment too large: ${content.size} bytes (max ${maxBytes})`,
    );
  }

  let bytes: Buffer | Uint8Array | undefined;
  let lastErr: unknown;
  if (typeof content.read === "function") {
    try {
      bytes = await content.read();
    } catch (err) {
      lastErr = err;
    }
  }
  if (bytes === undefined && opts?.fallbackRead) {
    try {
      bytes = await opts.fallbackRead();
    } catch (err) {
      lastErr = err;
    }
  }
  if (bytes === undefined) {
    throw new InboundAttachmentError(
      `failed to read attachment bytes: ${String(lastErr ?? "no reader")}`,
    );
  }

  let buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buf.byteLength === 0) {
    throw new InboundAttachmentError("attachment download returned empty bytes");
  }
  if (buf.byteLength > maxBytes) {
    throw new InboundAttachmentError(
      `attachment too large after download: ${buf.byteLength} bytes (max ${maxBytes})`,
    );
  }

  const safeMsg = messageId.replace(/[^\w.\-:+]/g, "_").slice(0, 120);
  const dir = join(INBOUND_ATTACHMENTS_DIR, safeMsg);
  await mkdir(dir, { recursive: true });

  let originalPath: string | undefined;
  let originalMimeType: string | undefined;
  let convertedFromHeif = false;

  if (looksLikeHeif(mimeType, name, buf)) {
    const heicPath = join(dir, name.endsWith(".heic") || name.endsWith(".heif") ? name : `${name}.heic`);
    await writeFile(heicPath, buf, { mode: 0o600 });
    originalPath = heicPath;
    originalMimeType = mimeType.startsWith("image/") ? mimeType : "image/heic";
    try {
      const jpeg = await heifToJpeg(buf, {
        quality: opts?.heifJpegQuality ?? 85,
      });
      buf = Buffer.isBuffer(jpeg) ? jpeg : Buffer.from(jpeg);
      name = jpegNameFrom(name);
      mimeType = "image/jpeg";
      convertedFromHeif = true;
    } catch (err) {
      // Keep HEIC as the delivered file if conversion fails.
      return {
        path: heicPath,
        bytes: buf.byteLength,
        name: basename(heicPath),
        mimeType: originalMimeType,
        ...(typeof content.id === "string" && content.id
          ? { attachmentId: content.id }
          : {}),
      };
    }
  }

  const path = join(dir, name);
  await writeFile(path, buf, { mode: 0o600 });

  return {
    path,
    bytes: buf.byteLength,
    name,
    mimeType,
    ...(typeof content.id === "string" && content.id
      ? { attachmentId: content.id }
      : {}),
    ...(originalPath ? { originalPath } : {}),
    ...(originalMimeType ? { originalMimeType } : {}),
    ...(convertedFromHeif ? { convertedFromHeif: true } : {}),
  };
}

export function attachmentDisplayText(
  name: string,
  mimeType: string,
  bytes?: number,
): string {
  const size =
    typeof bytes === "number" && bytes > 0
      ? `, ${bytes} bytes`
      : "";
  return `[attachment] ${name} (${mimeType}${size})`;
}
