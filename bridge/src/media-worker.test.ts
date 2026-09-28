import { test, expect, afterAll } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveInstancePaths } from "../../shared/instance-paths.mjs";
import { createMediaWorker, pendingMediaPatch, type MediaStore } from "./media-worker.ts";
import type { MediaJob, MediaReference, MediaResult } from "./contracts.ts";
import type { InboundRecord } from "./types.ts";
if (process.env.PHOTON_TEST_MODE !== "1") throw new Error("TEST_GUARD_REQUIRED");
const root = await mkdtemp(join(await realpath(tmpdir()), "photon-worker-test-"));
const paths = resolveInstancePaths({ instanceDir: root, env: { PHOTON_TEST_MODE: "1" } });
afterAll(() => rm(root, { recursive: true, force: true }));
const reference = (id: string): MediaReference => ({ messageId: `message-${id}`, attachmentId: `attachment-${id}`, spaceId: "space-A", lineId: "actual-line-A", kind: "voice", name: "voice.caf" });
function fixture(refs: MediaReference[]) {
  const jobs: MediaJob[] = refs.map((reference, i) => ({ id: `job-${i}`, eventId: `event-${i}`, reference, attempts: 0, state: "pending" }));
  const records: InboundRecord[] = refs.map((ref, i) => ({ id: `event-${i}`, spaceId: ref.spaceId, senderId: "sender", receivedAt: "now", timestamp: "now", text: "", ...pendingMediaPatch(ref) }));
  const settled: { id: string; result: MediaResult }[] = [];
  const store: MediaStore = {
    claimMedia() { const job = jobs.find((j) => j.state === "pending"); if (!job) return; job.state = "processing"; job.attempts++; return { ...job }; },
    settleMedia(id, result, attempt) {
      const job = jobs.find((j) => j.id === id)!;
      expect(attempt).toBe(job.attempts);
      job.state = result.state;
      Object.assign(records.find((r) => r.id === job.eventId)!, result.patch ?? {}, { mediaState: result.state });
      settled.push({ id, result });
    },
  };
  return { jobs, records, settled, store };
}

test("stalled media leaves receive/text synchronous and correlated completion patches once", async () => {
  const ref = reference("stuck");
  const f = fixture([ref]);
  let release: (value: { type: string; read: () => Promise<Buffer> }) => void = () => {};
  const stalled = new Promise<{ type: string; read: () => Promise<Buffer> }>((resolve) => { release = resolve; });
  const worker = createMediaWorker({ store: f.store, resolveReference: async () => stalled, attachmentOptions: { paths }, transcribe: async (path) => ({ text: "do the original task", wavPath: path }) });
  expect(worker.notify()).toBeUndefined();
  await Promise.resolve();
  f.records.push({ id: "later-text", spaceId: "space-A", senderId: "sender", text: "the task in that voice", receivedAt: "now", timestamp: "now" });
  f.records.push({ id: "other-text", spaceId: "space-B", senderId: "sender", text: "independent text", receivedAt: "now", timestamp: "now" });
  expect(f.records[0]!.mediaState).toBe("pending");
  expect(f.records).toHaveLength(3);
  release({ type: "voice", read: async () => Buffer.from("synthetic voice") });
  await worker.drain();
  expect(f.settled).toHaveLength(1);
  expect(f.records).toHaveLength(3);
  expect(f.records[0]!.transcript).toBe("do the original task");
  expect(f.records[0]!.id).toBe("event-0");
  expect(f.records[1]!.text).toBe("the task in that voice");
  await worker.stop();
});

test("worker concurrency bounded; abort cancels in-flight resolution", async () => {
  const f = fixture(Array.from({ length: 6 }, (_, i) => reference(String(i))));
  let inflight = 0, maximum = 0, aborted = 0;
  const worker = createMediaWorker({ store: f.store, concurrency: 2, jobTimeoutMs: 60, resolveTimeoutMs: 30, attachmentOptions: { paths }, resolveReference: async (_ref, signal) => new Promise((_, reject) => { inflight++; maximum = Math.max(maximum, inflight); signal.addEventListener("abort", () => { inflight--; aborted++; reject(new Error("cancelled")); }, { once: true }); }) });
  worker.notify(); await worker.drain();
  expect(maximum).toBe(2);
  expect(aborted).toBe(6);
  expect(f.settled).toHaveLength(6);
  expect(f.settled.every((s) => s.result.state === "failed")).toBe(true);
  await worker.stop();
});

test("restart without exact attachment GUID reports unavailable, never guesses", async () => {
  const ref = reference("no-guid"); delete ref.attachmentId;
  const f = fixture([ref]); let requests = 0;
  const worker = createMediaWorker({ store: f.store, attachmentOptions: { paths }, resolveReference: async () => { requests++; throw new Error("must never call"); } });
  worker.notify(); await worker.drain();
  expect(requests).toBe(0);
  expect(f.settled[0]!.result).toEqual({ state: "unavailable", code: "media_reference_unavailable_resend" });
  await worker.stop();
});

test("exact restart reference includes original line; mismatched GUID rejected", async () => {
  const ref = reference("exact"); const f = fixture([ref]);
  const worker = createMediaWorker({ store: f.store, attachmentOptions: { paths }, resolveReference: async (got) => { expect(got).toEqual(ref); return { type: "voice", id: "wrong-guid", read: async () => Buffer.from("x") }; } });
  worker.notify(); await worker.drain();
  expect(f.settled[0]!.result.state).toBe("unavailable");
  await worker.stop();
});

test("remembered reader is optional; failed STT preserves audio and later text", async () => {
  const ref = reference("voice-error"); delete ref.attachmentId;
  const f = fixture([ref]);
  const worker = createMediaWorker({ store: f.store, resolveReference: async () => { throw new Error("not expected"); }, attachmentOptions: { paths }, transcribe: async (path) => ({ text: "", wavPath: path, error: "moonshine_empty_transcript" }) });
  worker.remember(ref, { type: "voice", read: async () => Buffer.from("audio") });
  worker.notify(); await worker.drain();
  expect(f.settled[0]!.result.state).toBe("failed");
  expect(f.records[0]!.attachmentPath?.startsWith(paths.inboundAttachmentsDir)).toBe(true);
  expect(f.records[0]!.mediaError).toBe("moonshine_empty_transcript");
  expect(f.records).toHaveLength(1);
  await worker.stop();
});
