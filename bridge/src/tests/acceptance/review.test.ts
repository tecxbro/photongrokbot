import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { fixture, batch } from "../storage/fixture.ts";
import { InboundController, type InboundMessage } from "../../inbound-controller.ts";
import { createMediaWorker } from "../../media-worker.ts";
import { ActivityDriver } from "../../activity.ts";
import { createOutboundDispatcher } from "../../outbound-dispatcher.ts";
import { readOnboarding } from "../../onboarding.ts";

if (process.env.PHOTON_TEST_MODE !== "1" || !process.env.PHOTON_INSTANCE_DIR) throw new Error("ISOLATED_REVIEW_REQUIRED");
const bridge = resolve(import.meta.dir, "../../..");
const roots: string[] = [];
const fixtures: ReturnType<typeof fixture>[] = [];
const setup = () => { const f = fixture(); fixtures.push(f); return f; };
function unprotect(path: string) {
  chmodSync(path, 0o700);
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) unprotect(child); else chmodSync(child, 0o600);
  }
}
afterEach(() => { for (const f of fixtures.splice(0)) { unprotect(f.root); f.cleanup(); } for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });
async function command(args: string[], root: string | undefined, input?: string, executable = process.execPath) {
  const env: NodeJS.ProcessEnv = { ...process.env, PHOTON_TEST_MODE: "1", NODE_ENV: "test" };
  if (root) env.PHOTON_INSTANCE_DIR = root; else delete env.PHOTON_INSTANCE_DIR;
  const child = Bun.spawn([executable, ...args], { cwd: bridge, env, stdin: input === undefined ? "ignore" : new Blob([input]), stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
  try { const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]); return { exit, stdout, stderr }; }
  finally { clearTimeout(timer); }
}

test("REVIEW U01/U08/X01 same provider ID is independent per conversation and line through the CLI", async () => {
  const f = setup(), controller = new InboundController({ store: f.store, authorizedSenderId: "synthetic-owner" });
  const spaces = [{ id: "chat-a", phone: "line-a" }, { id: "chat-a", phone: "line-b" }, { id: "chat-b", phone: "line-a" }];
  for (const space of spaces) {
    const message: InboundMessage = { id: "same-provider-guid", direction: "inbound", platform: "imessage", sender: { id: "synthetic-owner" }, timestamp: new Date(), content: { type: "text", text: "Please answer this useful question." }, space };
    expect(controller.receive(space, message).status).toBe("accepted");
    const duplicate = controller.receive(space, message);
    expect(duplicate.status === "accepted" && duplicate.result.duplicate).toBe(true);
  }
  const batches = controller.flushAll();
  expect(batches).toHaveLength(3); expect(f.store.recentInbound()).toHaveLength(3); expect(f.store.listOutbound()).toHaveLength(1);
  for (const current of batches) {
    const read = await command(["run", "read-batch", "--", current.batchId], f.root);
    expect(read.exit).toBe(0); const snapshot = JSON.parse(read.stdout);
    expect(snapshot.destination).toEqual(current.destination); expect(snapshot.messages).toHaveLength(1);
  }
  const a = batches[0]!, claim = f.store.claimBatch(a.batchId); expect(claim.status).toBe("acquired");
  if (claim.status !== "acquired") throw new Error("CLAIM_FAILED");
  const bad = await command(["run", "enqueue", "--", "--json-stdin"], f.root, JSON.stringify({ version: 1, batchId: a.batchId, claim: claim.token, actionKey: "wrong-context", purpose: "final", payload: { kind: "text", spaceId: "unaccepted-space", text: "synthetic private text" } }));
  expect(bad.exit).toBe(1); expect(bad.stdout).toBe(""); expect(bad.stderr).not.toContain("synthetic private text"); expect(f.store.listOutbound()).toHaveLength(1);
});

test("REVIEW A01/A04/A07/U03 first media uses a bounded stream and preserves later text in its original batch", async () => {
  const f = setup(), controller = new InboundController({ store: f.store, authorizedSenderId: "synthetic-owner" });
  const space = { id: "media-chat", phone: "media-line" }; let buffered = 0, cancelled = 0;
  const incoming: InboundMessage = { id: "voice-guid", direction: "inbound", platform: "imessage", sender: { id: "synthetic-owner" }, timestamp: new Date(), space, content: { type: "voice", id: "original-attachment", name: "voice.caf", read: async () => { buffered++; throw new Error("BUFFERED_READ_FORBIDDEN"); }, stream() { return new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(new Uint8Array(8)); }, cancel() { cancelled++; } }); } } };
  const accepted = controller.receive(space, incoming);
  if (accepted.status !== "accepted" || !accepted.mediaReference || !accepted.readableContent) throw new Error("MEDIA_NOT_ACCEPTED");
  controller.receive(space, { ...incoming, id: "later-text", content: { type: "text", text: "Use the voice as context; do not guess it." } });
  const original = controller.flushAll()[0]!;
  expect(f.store.readBatch(original.batchId).messages[0]!.mediaState).toBe("pending");
  const worker = createMediaWorker({ store: f.store, attachmentOptions: { paths: f.paths, maxBytes: 4 }, resolveReference: async () => { throw new Error("WRONG_REFERENCE_PATH"); } });
  worker.remember(accepted.mediaReference, accepted.readableContent); worker.notify(); await worker.drain(); await worker.stop();
  const observed = f.store.readBatch(original.batchId);
  expect(buffered).toBe(0); expect(cancelled).toBe(1); expect(observed.messages[0]!.mediaState).toBe("failed");
  expect(observed.messages[0]!.text).toContain("resend or text"); expect(observed.messages[1]!.text).toContain("do not guess");
  expect(controller.flushAll()).toHaveLength(0); expect(readOnboarding(f.store).outboundIds).toHaveLength(1);
});

test("REVIEW P05/S03 actual control entrypoints fail closed without a synthetic root", async () => {
  for (const [entry, ...args] of [["read-batch", "--", "synthetic-batch"], ["outbound-status", "--", "--id", "synthetic-operation"], ["setup-state", "--", "status"], ["enqueue", "--", "--json-stdin"]]) {
    const result = await command(["run", entry!, ...args], undefined, entry === "enqueue" ? "{}" : undefined);
    expect(result.exit).not.toBe(0); expect(result.stdout).toBe("");
  }
  const first = setup(), second = setup(), b = batch(first.store);
  expect((await command(["run", "read-batch", "--", b.batch.batchId], first.root)).exit).toBe(0);
  const absent = await command(["run", "read-batch", "--", b.batch.batchId], second.root);
  expect(absent.exit).toBe(1); expect(absent.stdout).toBe(""); expect(second.store.recentInbound()).toHaveLength(0);
});

test("REVIEW O02/O04/O07 uncertain provider effect survives restart while another conversation progresses", async () => {
  const f = setup(), a = batch(f.store, "chat-uncertain"), b = batch(f.store, "chat-independent");
  const first = f.store.enqueue({ spaceId: a.destination.spaceId, text: "first bubble\n\nsecond bubble" }, { claim: a.claim, destination: a.destination, purpose: "final", actionKey: "answer-a" });
  const second = f.store.enqueue({ spaceId: b.destination.spaceId, text: "independent result" }, { claim: b.claim, destination: b.destination, purpose: "final", actionKey: "answer-b" });
  const effects: string[] = [];
  const dispatcher = createOutboundDispatcher({ store: f.store, paths: f.paths, resolveSpace: async destination => ({ id: destination.spaceId, phone: destination.lineId, getMessage: async () => undefined, send: async () => { effects.push(destination.spaceId); if (destination.spaceId === a.destination.spaceId) throw new Error("ACCEPTED_THEN_RESPONSE_LOST"); return { id: "independent-provider-ref" }; } }) });
  dispatcher.notify(); await dispatcher.drain(); await dispatcher.stop(); f.store.recoverSending(); f.store.recoverWork();
  const restarted = createOutboundDispatcher({ store: f.store, paths: f.paths, resolveSpace: async destination => ({ id: destination.spaceId, phone: destination.lineId, getMessage: async () => undefined, send: async () => { effects.push("forbidden-replay"); return { id: "wrong" }; } }) });
  restarted.notify(); await restarted.drain(); await restarted.stop();
  expect(effects).toEqual(["chat-uncertain", "chat-independent"]); expect(f.store.outboundStatus(first[0]!.id)?.state).toBe("unknown"); expect(f.store.outboundStatus(first[1]!.id)?.state).toBe("queued"); expect(f.store.outboundStatus(second[0]!.id)?.state).toBe("accepted");
  const status = await command(["run", "outbound-status", "--", "--id", first[0]!.id], f.root);
  expect(status.exit).toBe(0); expect(JSON.parse(status.stdout).state).toBe("unknown"); expect(status.stdout).not.toContain("first bubble");
});

test("REVIEW W04/O09 uncertain typing starts disable refresh but retain one cleanup across conversation changes", async () => {
  const calls: string[] = []; let now = 1;
  const driver = new ActivityDriver({ start: async d => { calls.push(`start:${d.spaceId}`); if (d.spaceId === "uncertain") throw new Error("RESPONSE_LOST_AFTER_REMOTE_APPLY"); }, stop: async d => { calls.push(`stop:${d.spaceId}`); } }, () => now, 100, 10);
  const a = { spaceId: "uncertain", lineId: "line" }, b = { spaceId: "other", lineId: "line" };
  await driver.sync([a, b]); now = 12; await driver.sync([a, b]); await driver.sync([b]); await driver.stop(); await driver.stop();
  expect(calls.filter(c => c === "start:uncertain")).toHaveLength(1); expect(calls.filter(c => c === "stop:uncertain")).toHaveLength(1); expect(calls.filter(c => c === "stop:other")).toHaveLength(1);
});

test("REVIEW M01-M05 executable migration preserves evidence and never dispatches ambiguous legacy work", async () => {
  const f = setup(), source = mkdtempSync(join(realpathSync(tmpdir()), "photon-review-legacy-")); roots.push(source);
  const write = (name: string, value: unknown) => { writeFileSync(join(source, name), JSON.stringify(value), { mode: 0o600 }); };
  const legacy = { id: "legacy-uncertain", spaceId: "legacy-space", text: "synthetic legacy message", createdAt: new Date().toISOString(), status: "queued", attempts: 0 };
  write("outbound-queue.json", { items: [legacy, { ...legacy, id: "legacy-accepted", status: "sent", messageId: "legacy-provider-ref" }] });
  write("onboarding-celebrated.json", { setupConfettiSent: true });
  write("poll-meta.json", { byMessageId: { "legacy-provider-ref": { title: "Synthetic poll", options: ["A", "B"], spaceId: "legacy-space" } } });
  const snapshot = () => JSON.stringify(readdirSync(source).sort().map(name => [name, createHash("sha256").update(readFileSync(join(source, name))).digest("hex")]));
  const before = snapshot(), beforeDB = readFileSync(f.paths.databasePath);
  const args = ["run", "src/migrate-legacy-state.ts", "--source", source, "--line-id", "legacy-line"];
  const dry = await command(args, f.root); expect(dry.exit).toBe(0); expect(JSON.parse(dry.stdout)).toMatchObject({ dryRun: true, outbound: 2 }); expect(snapshot()).toBe(before); expect(readFileSync(f.paths.databasePath)).toEqual(beforeDB);
  const locked = ["tools/with-instance-lock.py", join(f.root, "runtime.lock"), process.execPath, ...args, "--apply", "--writers-stopped"];
  const applied = await command(locked, f.root, undefined, "python3"); expect(applied.exit).toBe(0); expect(JSON.parse(applied.stdout).outbound).toBe(2);
  expect(f.store.outboundStatus("legacy-uncertain")?.state).toBe("unknown"); expect(f.store.outboundStatus("legacy-accepted")?.state).toBe("accepted"); expect(f.store.claimOutbound()).toBeUndefined(); expect(f.store.getMetadata("poll", "legacy-provider-ref")).toMatchObject({ title: "Synthetic poll" });
  expect(readOnboarding(f.store)).toMatchObject({ reserved: true, state: "legacy-recorded", deviceObserved: false });
  const rerun = await command(locked, f.root, undefined, "python3"); expect(rerun.exit).toBe(0); expect(JSON.parse(rerun.stdout).alreadyImported).toBe(true); expect(f.store.listOutbound()).toHaveLength(2);
  write("outbound-queue.json", { items: [{ ...legacy, text: "changed source" }] });
  expect((await command(locked, f.root, undefined, "python3")).exit).toBe(1); expect(f.store.listOutbound()).toHaveLength(2);
});
