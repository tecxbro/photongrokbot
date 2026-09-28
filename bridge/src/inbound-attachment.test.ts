import { test, expect, afterAll } from "bun:test";
import { mkdtemp, readFile, readdir, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveInstancePaths, ensureInstancePaths } from "../../shared/instance-paths.mjs";
import { attachmentDisplayText, persistInboundAttachment, sanitizeFileName } from "./inbound-attachment.ts";

if (process.env.PHOTON_TEST_MODE !== "1") throw new Error("TEST_GUARD_REQUIRED");
const root = await mkdtemp(join(await realpath(tmpdir()), "photon-attachment-test-"));
const paths = resolveInstancePaths({ instanceDir: root, env: { PHOTON_TEST_MODE: "1" } });
ensureInstancePaths(paths);
afterAll(() => rm(root, { recursive: true, force: true }));

test("display and atomic private save preserve metadata; jobs cannot collide", async () => {
  expect(attachmentDisplayText("photo.jpg", "image/jpeg", 12)).toBe("[attachment] photo.jpg (image/jpeg, 12 bytes)");
  const content = { type: "attachment", id: "guid-1", name: "hello world.png", mimeType: "image/png", read: async () => Buffer.from([137, 80, 78, 71]) };
  const one = await persistInboundAttachment("msg-1", content, { paths });
  const two = await persistInboundAttachment("msg-1", content, { paths });
  expect(one.path).not.toBe(two.path);
  expect(one.name).toBe(content.name);
  expect(one.attachmentId).toBe("guid-1");
  expect(one.bytes).toBe(4);
  expect([...await readFile(one.path)]).toEqual([137, 80, 78, 71]);
  const inferred = await persistInboundAttachment("msg-2", { type: "attachment", mimeType: "image/jpeg", read: async () => Buffer.from("abc") }, { paths });
  expect(inferred.name).toBe("attachment.jpg");
});

test("declared, streamed and buffered oversize fail; stream is cancelled", async () => {
  let read = false;
  await expect(persistInboundAttachment("too-big", { type: "attachment", size: 9, read: async () => { read = true; return Buffer.from("x"); } }, { paths, maxBytes: 8 })).rejects.toThrow("attachment_too_large");
  expect(read).toBe(false);
  await expect(persistInboundAttachment("buffer", { type: "attachment", read: async () => Buffer.alloc(9) }, { paths, maxBytes: 8 })).rejects.toThrow("attachment_too_large");
  let cancelled = false;
  await expect(persistInboundAttachment("stream", { type: "attachment", stream: () => new ReadableStream({ pull(c) { c.enqueue(Buffer.alloc(5)); }, cancel() { cancelled = true; } }) }, { paths, maxBytes: 8 })).rejects.toThrow("attachment_too_large");
  expect(cancelled).toBe(true);
});

test("stalled stream gets a deadline and cancellation", async () => {
  let cancelled = false;
  await expect(persistInboundAttachment("stuck", { type: "attachment", stream: () => new ReadableStream({ cancel() { cancelled = true; } }) }, { paths, downloadTimeoutMs: 20 })).rejects.toThrow("media_timeout");
  expect(cancelled).toBe(true);
});

test("bounded buffer fallback remains supported; empty download fails", async () => {
  const saved = await persistInboundAttachment("fallback", { type: "attachment", read: async () => { throw new Error("do not surface raw provider details"); } }, { paths, fallbackRead: async () => Buffer.from("fallback-ok") });
  expect(await readFile(saved.path, "utf8")).toBe("fallback-ok");
  await expect(persistInboundAttachment("empty", { type: "attachment", read: async () => Buffer.alloc(0) }, { paths })).rejects.toThrow("attachment_empty");
});

test("unsafe dot names and symlinked private directory are rejected", async () => {
  expect(() => sanitizeFileName("..")).toThrow("unsafe_attachment_name");
  expect(() => sanitizeFileName(".")).toThrow("unsafe_attachment_name");
  expect(sanitizeFileName("../../abc.txt")).toBe("abc.txt");
  const other = await mkdtemp(join(await realpath(tmpdir()), "photon-symlink-test-"));
  try {
    const unsafe = resolveInstancePaths({ instanceDir: other, env: { PHOTON_TEST_MODE: "1" } });
    ensureInstancePaths(unsafe);
    await rm(unsafe.inboundAttachmentsDir, { recursive: true });
    await symlink(paths.inboundAttachmentsDir, unsafe.inboundAttachmentsDir);
    await expect(persistInboundAttachment("symlink", { type: "attachment", read: async () => Buffer.from("x") }, { paths: unsafe })).rejects.toThrow("INSTANCE_SYMLINK_REJECTED");
  } finally { await rm(other, { recursive: true, force: true }); }
});

test("interrupted atomic write never publishes a ready output", async () => {
  const before = await readdir(paths.inboundAttachmentsDir);
  const controller = new AbortController();
  const promise = persistInboundAttachment("interrupted", { type: "attachment", read: async () => Buffer.alloc(32 * 1024 * 1024) }, { paths, signal: controller.signal });
  const timer = setTimeout(() => controller.abort(), 1);
  await expect(promise).rejects.toThrow();
  clearTimeout(timer);
  expect(await readdir(paths.inboundAttachmentsDir)).toEqual(before);
});

test("failed isolated HEIF conversion retains original with degraded status", async () => {
  const saved = await persistInboundAttachment("heif", { type: "attachment", name: "iphone.heic", mimeType: "image/heic", read: async () => Buffer.from("xxxxftypheic-not-real") }, { paths, decodeTimeoutMs: 2_000 });
  expect(saved.mimeType).toBe("image/heic");
  expect(saved.conversionError).toBe("heif_conversion_failed");
  expect(await readFile(saved.path, "utf8")).toBe("xxxxftypheic-not-real");
  expect((await readdir(join(saved.path, ".."))).some((name) => name.includes("partial"))).toBe(false);
});
