import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { createMediaWorker, pendingMediaPatch } from "../../media-worker.ts";
import type { MediaReference } from "../../contracts.ts";
import { fixture, record } from "./fixture.ts";
const fixtures: ReturnType<typeof fixture>[] = [];
const setup = () => {
  const f = fixture();
  fixtures.push(f);
  return f;
};
afterEach(() => {
  for (const f of fixtures.splice(0)) f.cleanup();
});
function acceptedMedia(
  f: ReturnType<typeof fixture>,
  options: Partial<MediaReference> = {},
) {
  const reference: MediaReference = {
    messageId: crypto.randomUUID(),
    attachmentId: crypto.randomUUID(),
    spaceId: "space-1",
    lineId: "line-1",
    kind: "attachment",
    name: "fixture.pdf",
    mimeType: "application/pdf",
    ...options,
  };
  f.store.accept({
    eventKey: reference.messageId,
    record: {
      ...record(reference.messageId, reference.spaceId),
      ...pendingMediaPatch(reference),
    },
    destination: { spaceId: reference.spaceId, lineId: reference.lineId },
    media: reference,
  });
  return { reference, batch: f.store.formBatches()[0]! };
}
test("actual attachment worker commits ready patch into the original SQLite event", async () => {
  const f = setup();
  const { reference, batch } = acceptedMedia(f);
  const errors: string[] = [];
  const worker = createMediaWorker({
    store: f.store,
    attachmentOptions: { paths: f.paths },
    onError: (code) => errors.push(code),
    resolveReference: async () => ({
      type: "attachment",
      id: reference.attachmentId,
      name: reference.name,
      mimeType: reference.mimeType,
      read: async () => Buffer.from("synthetic local PDF"),
    }),
  });
  try {
    worker.notify();
    await worker.drain();
    const updated = f.store.readBatch(batch.batchId);
    const message = updated.messages[0]!;
    expect(errors).toEqual([]);
    expect(message.id).toBe(reference.messageId);
    expect(message.kind).toBe("attachment");
    expect(message.mediaState).toBe("ready");
    expect(message.mediaJobId).toBe(updated.media?.[0]?.id);
    expect(message.mediaError).toBeUndefined();
    expect(
      message.attachmentPath?.startsWith(f.paths.inboundAttachmentsDir),
    ).toBe(true);
    expect(existsSync(message.attachmentPath!)).toBe(true);
    expect(message.text).not.toContain("pending");
    expect(updated.media?.[0]?.state).toBe("ready");
    expect(f.store.formBatches()).toHaveLength(0);
  } finally {
    await worker.stop();
  }
});
test("actual worker preserves ready conversion warning when original HEIC remains available", async () => {
  const f = setup();
  const { reference, batch } = acceptedMedia(f, {
    name: "broken.heic",
    mimeType: "image/heic",
  });
  const errors: string[] = [];
  const worker = createMediaWorker({
    store: f.store,
    attachmentOptions: { paths: f.paths, decodeTimeoutMs: 3000 },
    onError: (code) => errors.push(code),
    resolveReference: async () => ({
      type: "attachment",
      id: reference.attachmentId,
      name: reference.name,
      mimeType: reference.mimeType,
      read: async () => Buffer.from("synthetic invalid HEIC"),
    }),
  });
  try {
    worker.notify();
    await worker.drain();
    const message = f.store.readBatch(batch.batchId).messages[0]!;
    expect(errors).toEqual([]);
    expect(message.mediaState).toBe("ready");
    expect(message.mediaError).toBe("heif_conversion_failed");
    expect(existsSync(message.attachmentPath!)).toBe(true);
    expect(message.text).toContain("original preserved");
  } finally {
    await worker.stop();
  }
});
test("actual worker failure without a patch replaces pending media with durable explicit failure", async () => {
  const f = setup();
  const { reference, batch } = acceptedMedia(f);
  const errors: string[] = [];
  const worker = createMediaWorker({
    store: f.store,
    attachmentOptions: { paths: f.paths },
    onError: (code) => errors.push(code),
    resolveReference: async () => ({
      type: "attachment",
      id: reference.attachmentId,
      read: async () => {
        throw new Error("fixture private decoder details");
      },
    }),
  });
  try {
    worker.notify();
    await worker.drain();
    const updated = f.store.readBatch(batch.batchId);
    const message = updated.messages[0]!;
    expect(errors).toEqual([]);
    expect(message.mediaState).toBe("failed");
    expect(message.mediaError).toBe("attachment_read_unavailable");
    expect(message.mediaJobId).toBe(updated.media?.[0]?.id);
    expect(message.text).toContain("attachment failed");
    expect(message.text).toContain("resend or text");
    expect(message.text).not.toContain("pending");
    expect(message.text).not.toContain("private decoder");
    expect(updated.media?.[0]?.state).toBe("failed");
  } finally {
    await worker.stop();
  }
});
test("actual worker cancellation commits failed state and error even without a patch", async () => {
  const f = setup();
  const { batch } = acceptedMedia(f, {
    kind: "voice",
    name: "voice.caf",
    mimeType: "audio/x-caf",
  });
  let began: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  const errors: string[] = [];
  const worker = createMediaWorker({
    store: f.store,
    attachmentOptions: { paths: f.paths },
    onError: (code) => errors.push(code),
    resolveReference: async (_ref, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new Error("fixture cancellation")),
          { once: true },
        );
        began();
      }),
  });
  worker.notify();
  await started;
  await worker.stop();
  const updated = f.store.readBatch(batch.batchId);
  const message = updated.messages[0]!;
  expect(errors).toEqual([]);
  expect(message.mediaState).toBe("failed");
  expect(message.mediaError).toBe("media_aborted");
  expect(message.mediaJobId).toBe(updated.media?.[0]?.id);
  expect(message.text).toContain("voice failed");
  expect(message.text).not.toContain("pending");
  expect(updated.media?.[0]?.state).toBe("failed");
});
test("actual worker missing restart reference commits explicit unavailable state", async () => {
  const f = setup();
  const { batch } = acceptedMedia(f);
  const errors: string[] = [];
  const worker = createMediaWorker({
    store: f.store,
    attachmentOptions: { paths: f.paths },
    onError: (code) => errors.push(code),
    resolveReference: async () => undefined,
  });
  try {
    worker.notify();
    await worker.drain();
    const message = f.store.readBatch(batch.batchId).messages[0]!;
    expect(errors).toEqual([]);
    expect(message.mediaState).toBe("unavailable");
    expect(message.mediaError).toBe("media_reference_unavailable_resend");
    expect(message.text).toContain("attachment unavailable");
    expect(message.text).not.toContain("pending");
  } finally {
    await worker.stop();
  }
});
test("media settlement derives identity and outcome while rejecting mismatched patch identity", () => {
  const f = setup();
  const { batch } = acceptedMedia(f);
  const job = f.store.claimMedia()!;
  for (const patch of [
    { kind: "voice" as const },
    { mediaJobId: "another-job" },
    { mediaState: "pending" as const },
    { id: "another-message" },
  ])
    expect(() =>
      f.store.settleMedia(job.id, { state: "ready", patch }, job.attempts),
    ).toThrow("MEDIA_IDENTITY_PATCH_FORBIDDEN");
  f.store.settleMedia(
    job.id,
    {
      state: "failed",
      code: "fixture_failed",
      patch: { mediaError: "stale_warning" },
    },
    job.attempts,
  );
  const message = f.store.readBatch(batch.batchId).messages[0]!;
  expect(message.mediaJobId).toBe(job.id);
  expect(message.mediaState).toBe("failed");
  expect(message.mediaError).toBe("fixture_failed");
  expect(message.kind).toBe("attachment");
});
