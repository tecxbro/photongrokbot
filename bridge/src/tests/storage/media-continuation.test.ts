import { afterEach, expect, test } from "bun:test";
import { createMediaWorker, pendingMediaPatch } from "../../media-worker.ts";
import { openStore } from "../../storage.ts";
import type { MediaReference, MediaResult } from "../../contracts.ts";
import { fixture, record } from "./fixture.ts";

const fixtures: ReturnType<typeof fixture>[] = [];
afterEach(() => { for (const f of fixtures.splice(0)) f.cleanup(); });
function setup() {
  const f = fixture(); fixtures.push(f);
  const reference: MediaReference = { messageId: "voice-original", attachmentId: "voice-attachment", spaceId: "space-1", lineId: "line-1", kind: "voice", name: "request.m4a", mimeType: "audio/mp4" };
  const accepted = f.store.accept({ eventKey: "voice-event", record: { ...record(reference.messageId), ...pendingMediaPatch(reference) }, destination: { spaceId: reference.spaceId, lineId: reference.lineId }, media: reference });
  const batch = f.store.formBatches()[0]!;
  const wake = f.store.claimWake()!;
  f.store.settleWake(wake, { state: "acknowledged" });
  const claim = f.store.claimBatch(batch.batchId);
  if (claim.status !== "acquired") throw new Error("FIXTURE_CLAIM_FAILED");
  return { ...f, reference, accepted, batch, claim };
}

test("held transcription resumes the completed original request exactly once without another inbound event", async () => {
  const f = setup();
  let started!: () => void, release!: () => void;
  const began = new Promise<void>(resolve => { started = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const errors: string[] = [];
  const worker = createMediaWorker({
    store: f.store, attachmentOptions: { paths: f.paths }, onError: code => errors.push(code),
    resolveReference: async ref => ({ type: "voice", id: ref.attachmentId, name: ref.name, mimeType: ref.mimeType, read: async () => Buffer.from("synthetic audio bytes") }),
    transcribe: async path => { started(); await held; return { text: "Build a dog app", wavPath: path }; },
  });
  try {
    worker.notify(); await began;
    const first = f.store.readBatch(f.batch.batchId, f.claim.inputRevision);
    expect(first.continuationReason).toBe("inbound");
    expect(first.messages[0]!.transcript).toBeUndefined();
    f.store.completeClaim(f.claim.token, first.inputRevision);
    expect(f.store.claimBatch(f.batch.batchId).status).toBe("completed");
    release(); await worker.drain();
    expect(errors).toEqual([]);
    const wake = f.store.claimWake()!;
    expect(wake.batchId).toBe(f.batch.batchId);
    f.store.settleWake(wake, { state: "acknowledged" });
    const resumed = f.store.claimBatch(wake.batchId);
    if (resumed.status !== "acquired") throw new Error("CONTINUATION_NOT_CLAIMABLE");
    const read = f.store.readBatch(wake.batchId, resumed.inputRevision);
    expect(read.inputRevision).toBe(first.inputRevision! + 1);
    expect(read.acknowledgedRevision).toBe(first.inputRevision);
    expect(read.continuationReason).toBe("media_ready");
    expect(read.messages).toHaveLength(1);
    expect(read.messages[0]).toMatchObject({ id: f.reference.messageId, transcript: "Build a dog app", kind: "voice" });
    expect(read.media?.[0]?.eventId).toBe(f.accepted.eventId);
    expect(read.destination).toEqual(f.batch.destination);
    expect(f.store.recentInbound()).toHaveLength(1);
    expect(f.store.listOutbound()).toHaveLength(0);
    f.store.completeClaim(resumed.token, read.inputRevision);
    expect(f.store.claimWake()).toBeUndefined();
    expect(f.store.claimBatch(wake.batchId).status).toBe("completed");
  } finally { release(); await worker.stop(); }
});

test("media arriving after the read is not acknowledged by completion of that read", () => {
  const f = setup(), first = f.store.readBatch(f.batch.batchId, f.claim.inputRevision);
  const job = f.store.claimMedia()!;
  f.store.settleMedia(job.id, { state: "ready", patch: { transcript: "late transcript" } }, job.attempts);
  // The original processing claim cannot accidentally consume a result it never read.
  expect(() => f.store.completeClaim(f.claim.token, first.inputRevision! + 1)).toThrow();
  f.store.completeClaim(f.claim.token, first.inputRevision);
  const resumed = f.store.claimBatch(f.batch.batchId);
  if (resumed.status !== "acquired") throw new Error("RACING_RESULT_LOST");
  const result = f.store.readBatch(f.batch.batchId, resumed.inputRevision);
  expect(result.acknowledgedRevision).toBe(first.inputRevision);
  expect(result.continuationReason).toBe("media_ready");
  expect(result.messages[0]!.transcript).toBe("late transcript");
  f.store.completeClaim(resumed.token, result.inputRevision);
  expect(f.store.claimBatch(f.batch.batchId).status).toBe("completed");
});

for (const state of ["ready", "failed", "unavailable"] as const) {
  test(`${state} settlement and restart preserve one actionable revision with the original destination`, () => {
    const f = setup(), job = f.store.claimMedia()!;
    f.store.completeClaim(f.claim.token, f.claim.inputRevision);
    const result: MediaResult = state === "ready" ? { state, patch: { transcript: "done" } } : { state, code: "fixture_media_failure" };
    f.store.settleMedia(job.id, result, job.attempts);
    const revision = f.store.readBatch(f.batch.batchId).inputRevision;
    f.store.settleMedia(job.id, result, job.attempts);
    expect(f.store.readBatch(f.batch.batchId).inputRevision).toBe(revision);
    expect(() => f.store.settleMedia(job.id, { state: "ready", patch: { transcript: "conflicting replacement" } }, job.attempts)).toThrow();
    f.store.close();
    const restarted = openStore({ paths: f.paths });
    try {
      restarted.recoverWork(); restarted.recoverWork(); restarted.formBatches();
      const wake = restarted.claimWake()!;
      expect(wake.batchId).toBe(f.batch.batchId);
      restarted.settleWake(wake, { state: "acknowledged" });
      const claim = restarted.claimBatch(wake.batchId);
      if (claim.status !== "acquired") throw new Error("RESTART_RESULT_LOST");
      const read = restarted.readBatch(wake.batchId, claim.inputRevision);
      expect(read.inputRevision).toBe(revision);
      expect(read.continuationReason).toBe(`media_${state}`);
      expect(read.destination).toEqual(f.batch.destination);
      expect(read.messages).toHaveLength(1);
      expect(read.messages[0]).toMatchObject({ id: f.reference.messageId, mediaState: state });
      expect(restarted.claimWake()).toBeUndefined();
      restarted.completeClaim(claim.token, read.inputRevision);
      restarted.recoverWork();
      expect(restarted.claimWake()).toBeUndefined();
      expect(restarted.recentInbound()).toHaveLength(1);
    } finally { restarted.close(); }
  });
}

test("retention protects completed input while its late media revision remains unconsumed", () => {
  const f = setup(), job = f.store.claimMedia()!;
  f.store.completeClaim(f.claim.token, f.claim.inputRevision);
  f.store.settleMedia(job.id, { state: "ready", patch: { transcript: "retain until consumed" } }, job.attempts);
  const pruned = f.store.pruneResolvedBefore({ resolvedBefore: Date.now() + 1_000, intermediateBefore: Date.now() + 1_000, apply: true });
  expect(pruned.events).toBe(0);
  expect(f.store.readBatch(f.batch.batchId).messages[0]!.transcript).toBe("retain until consumed");
});

test("retention redacts resolved snapshots while preserving the same provider ID on another line", () => {
  const f = setup(), job = f.store.claimMedia()!;
  f.store.completeClaim(f.claim.token, f.claim.inputRevision);
  f.store.settleMedia(job.id, { state: "ready", patch: { transcript: "private resolved voice content" } }, job.attempts);
  const resumed = f.store.claimBatch(f.batch.batchId);
  if (resumed.status !== "acquired") throw new Error("CONTINUATION_NOT_CLAIMABLE");
  f.store.completeClaim(resumed.token, resumed.inputRevision);
  f.store.accept({ eventKey: "same-id-other-line", record: { ...record(f.reference.messageId), text: "private active other line content" }, destination: { spaceId: f.reference.spaceId, lineId: "other-line" } });
  const other = f.store.formBatches()[0]!;
  const plan = f.store.pruneResolvedBefore({ resolvedBefore: Date.now() + 1_000, intermediateBefore: Date.now() + 1_000, apply: true });
  expect(plan.events).toBe(1);
  const snapshots = f.store.db.query("SELECT snapshot FROM batch_revisions WHERE batch_id=?").all(f.batch.batchId);
  expect(JSON.stringify(snapshots)).not.toContain("private resolved voice content");
  expect(f.store.readBatch(f.batch.batchId, resumed.inputRevision).messages[0]!.transcript).toBeUndefined();
  expect(f.store.readBatch(other.batchId).messages[0]!.text).toBe("private active other line content");
});
