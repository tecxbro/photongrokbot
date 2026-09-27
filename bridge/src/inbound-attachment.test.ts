import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  InboundAttachmentError,
  attachmentDisplayText,
  persistInboundAttachment,
  INBOUND_ATTACHMENTS_DIR,
} from "./inbound-attachment.ts";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

function assertEqual(a: unknown, b: unknown, msg: string): void {
  const as = JSON.stringify(a);
  const bs = JSON.stringify(b);
  if (as !== bs) throw new Error(`${msg}\n got: ${as}\nwant: ${bs}`);
}

assertEqual(
  attachmentDisplayText("photo.jpg", "image/jpeg", 12),
  "[attachment] photo.jpg (image/jpeg, 12 bytes)",
  "display",
);

const tmpRoot = join(INBOUND_ATTACHMENTS_DIR, "_test_cleanup");
await rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);

const saved = await persistInboundAttachment("msg-test-1", {
  type: "attachment",
  id: "att-guid-1",
  name: "hello world.png",
  mimeType: "image/png",
  read: async () => Buffer.from([137, 80, 78, 71]),
});
assert(saved.path.includes("msg-test-1"), "path has message id");
assertEqual(saved.name, "hello world.png", "name");
assertEqual(saved.bytes, 4, "bytes");
assertEqual(saved.attachmentId, "att-guid-1", "id");
const disk = await readFile(saved.path);
assertEqual([...disk], [137, 80, 78, 71], "disk bytes");

// empty name + mime gets extension
const saved2 = await persistInboundAttachment("msg-test-2", {
  type: "attachment",
  mimeType: "image/jpeg",
  read: async () => Buffer.from("abc"),
});
assert(saved2.name.endsWith(".jpg"), `ext ${saved2.name}`);

// too large declared size
let rejected = false;
try {
  await persistInboundAttachment("msg-test-3", {
    type: "attachment",
    name: "big.bin",
    mimeType: "application/octet-stream",
    size: 200 * 1024 * 1024,
    read: async () => Buffer.from("x"),
  });
} catch (err) {
  assert(err instanceof InboundAttachmentError, "err type");
  rejected = true;
}
assert(rejected, "size reject");

// fallback reader
const saved3 = await persistInboundAttachment(
  "msg-test-4",
  {
    type: "attachment",
    id: "guid-x",
    name: "via-fallback.txt",
    mimeType: "text/plain",
    read: async () => {
      throw new Error("primary fail");
    },
  },
  {
    fallbackRead: async () => Buffer.from("fallback-ok"),
  },
);
assertEqual(await readFile(saved3.path, "utf8"), "fallback-ok", "fallback");

await rm(join(INBOUND_ATTACHMENTS_DIR, "msg-test-1"), { recursive: true, force: true });
await rm(join(INBOUND_ATTACHMENTS_DIR, "msg-test-2"), { recursive: true, force: true });
await rm(join(INBOUND_ATTACHMENTS_DIR, "msg-test-4"), { recursive: true, force: true });


// HEIC mime: conversion may fail on fake bytes; original must still be saved
const heicFake = await persistInboundAttachment("msg-test-heic", {
  type: "attachment",
  name: "iphone.heic",
  mimeType: "image/heic",
  read: async () => {
    // ftyp/heic brand so detector trips; not a real HEIF payload
    const buf = Buffer.alloc(32);
    buf.write("xxxxftypheic", 0);
    return buf;
  },
});
assert(heicFake.path.includes("msg-test-heic"), "heic dir");
assert(
  heicFake.mimeType === "image/jpeg" || heicFake.mimeType === "image/heic",
  `heic result mime ${heicFake.mimeType}`,
);
if (heicFake.convertedFromHeif) {
  assertEqual(heicFake.mimeType, "image/jpeg", "converted jpeg");
  assert(!!heicFake.originalPath, "kept original");
}
await rm(join(INBOUND_ATTACHMENTS_DIR, "msg-test-heic"), { recursive: true, force: true });

console.log("ALL_INBOUND_ATTACHMENT_TESTS_PASSED");
