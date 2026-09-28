import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fixture, record } from "./fixture.ts";
import { migrateLegacy } from "../../migrate-legacy-state.ts";
const roots: string[] = [];
const fixtures: ReturnType<typeof fixture>[] = [];
function unprotect(path: string) {
  chmodSync(path, 0o700);
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) unprotect(child);
    else chmodSync(child, 0o600);
  }
}
afterEach(() => {
  for (const f of fixtures.splice(0)) {
    unprotect(f.root);
    f.cleanup();
  }
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function setup() {
  const f = fixture();
  fixtures.push(f);
  const source = mkdtempSync(join(realpathSync(tmpdir()), "photon-legacy-"));
  roots.push(source);
  const write = (name: string, value: unknown) => {
    const dir = name.includes("/")
      ? join(source, name.slice(0, name.lastIndexOf("/")))
      : source;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(source, name), JSON.stringify(value), { mode: 0o600 });
  };
  write("inbound/msg.json", record("old-message"));
  write("pending-batch.json", { messages: [record("pending-message")] });
  write("unread/legacy-batch.json", {
    batchId: "legacy-batch",
    flushedAt: new Date().toISOString(),
    messages: [record("old-message")],
  });
  write("webhook-pending.json", {
    batchIds: ["legacy-batch", "dangling-batch"],
  });
  write("handled-ids.json", { ids: ["old-message", "only-handled"] });
  write("outbound-queue.json", {
    items: [
      {
        id: "old-sent",
        spaceId: "space-1",
        text: "sent before",
        createdAt: new Date().toISOString(),
        status: "sent",
        attempts: 1,
      },
      {
        id: "old-queued",
        spaceId: "space-1",
        text: "maybe sent",
        createdAt: new Date().toISOString(),
        status: "queued",
        attempts: 0,
      },
    ],
  });
  return { ...f, source, write };
}
async function apply(f: ReturnType<typeof setup>) {
  const script = new URL(
    "../../../tools/with-instance-lock.py",
    import.meta.url,
  ).pathname;
  const entry = new URL("../../migrate-legacy-state.ts", import.meta.url)
    .pathname;
  const c = Bun.spawn(
    [
      "python3",
      script,
      join(f.root, "runtime.lock"),
      process.execPath,
      entry,
      "--source",
      f.source,
      "--line-id",
      "line-1",
      "--apply",
      "--writers-stopped",
    ],
    {
      env: {
        ...process.env,
        PHOTON_TEST_MODE: "1",
        PHOTON_INSTANCE_DIR: f.root,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [exit, stdout, stderr] = await Promise.all([
    c.exited,
    new Response(c.stdout).text(),
    new Response(c.stderr).text(),
  ]);
  return {
    exit,
    report: stdout.trim() ? JSON.parse(stdout) : undefined,
    stderr,
  };
}
test("M01 dry-run changes neither source nor target", () => {
  const f = setup();
  const beforeSource = readdirSync(f.source);
  const beforeDb = readFileSync(f.paths.databasePath);
  const report = migrateLegacy({
    source: f.source,
    paths: f.paths,
    lineId: "line-1",
  });
  expect(report.dryRun).toBe(true);
  expect(report.outbound).toBe(2);
  expect(readdirSync(f.source)).toEqual(beforeSource);
  expect(readFileSync(f.paths.databasePath)).toEqual(beforeDb);
  expect(f.store.recentInbound()).toHaveLength(0);
});
test("M02 same source imported once; changed inputs require reconciliation", async () => {
  const f = setup();
  const first = await apply(f);
  expect(first.exit).toBe(0);
  expect(first.report.issues).toContainEqual({
    file: "webhook-pending.json",
    code: "DANGLING_WAKE",
    id: "dangling-batch",
  });
  expect(existsSync(first.report.backupPath)).toBe(true);
  expect((await apply(f)).report.alreadyImported).toBe(true);
  expect(f.store.listOutbound()).toHaveLength(2);
  f.write("handled-ids.json", { ids: ["changed"] });
  expect((await apply(f)).exit).not.toBe(0);
  expect(f.store.listOutbound()).toHaveLength(2);
});
test("M03 poll/full session/ordered presentation metadata and conversation preserved", async () => {
  const f = setup();
  const session = {
    chatGuid: "chat",
    messageGuid: "message",
    sessionId: "session",
    targetMessageGuid: "target",
  };
  f.write("poll-meta.json", {
    byMessageId: { "poll-id": { title: "Choose", options: ["A", "B"] } },
  });
  f.write("app-card-sessions.json", {
    byMessageId: {
      "app-id": { session, url: "https://example.test/card", live: true },
    },
  });
  f.write("presentations/cards.json", {
    batchId: "cards",
    spaceId: "space-1",
    messageId: "parent",
    parts: [
      {
        partIndex: 0,
        path: "/preserved/a.jpg",
        childId: "p:0/parent",
        optionId: "a",
      },
      {
        partIndex: 1,
        path: "/preserved/b.jpg",
        childId: "p:1/parent",
        optionId: "b",
      },
    ],
  });
  expect((await apply(f)).exit).toBe(0);
  expect(f.store.getMetadata("poll", "poll-id")).toMatchObject({
    options: ["A", "B"],
  });
  expect(f.store.getMetadata("app-session", "app-id")).toMatchObject({
    session,
  });
  expect(
    f.store
      .getMetadata<any>("presentation", "cards")
      .parts.map((p: any) => p.optionId),
  ).toEqual(["a", "b"]);
  expect(f.store.batchDestination("legacy-batch")).toEqual({
    spaceId: "space-1",
    lineId: "line-1",
  });
  expect(
    f.store.accept({
      eventKey: "fresh-runtime-key",
      record: record("old-message"),
      destination: { spaceId: "space-1", lineId: "line-1" },
    }).duplicate,
  ).toBe(true);
  expect(
    f.store.accept({
      eventKey: "only-handled-event",
      record: record("only-handled"),
      destination: { spaceId: "space-1", lineId: "line-1" },
    }).duplicate,
  ).toBe(true);
});
test("M04 queued becomes unknown; sent no ID preserves legacy acceptance", async () => {
  const f = setup();
  expect((await apply(f)).exit).toBe(0);
  expect(f.store.outboundStatus("old-queued")).toMatchObject({
    state: "unknown",
    code: "LEGACY_DISPATCH_UNCERTAIN",
  });
  expect(f.store.outboundStatus("old-sent")).toMatchObject({
    state: "accepted",
    code: "LEGACY_ACCEPTED_EVIDENCE",
  });
  expect(f.store.outboundStatus("old-sent")?.reference).toBeUndefined();
  expect(f.store.claimOutbound()).toBeUndefined();
});
test("M05 legacy confetti provenance prevents automatic second celebration", async () => {
  const f = setup();
  f.write("onboarding-celebrated.json", {
    setupConfettiSent: true,
    sentAt: "2026-01-01T00:00:00Z",
  });
  expect((await apply(f)).exit).toBe(0);
  expect(f.store.getMetadata("onboarding", "reservation")).toMatchObject({
    state: "legacy-recorded",
    provenance: "legacy-marker-not-device-observation",
  });
  expect(
    f.store.accept({
      eventKey: "new",
      record: record("new"),
      destination: { spaceId: "space-1", lineId: "line-1" },
      onboarding: true,
    }).onboardingCreated,
  ).toBe(false);
  expect(f.store.listOutbound()).toHaveLength(2);
});
test("M06 running legacy writer refuses; cutover does not drain copied queues", async () => {
  const f = setup();
  writeFileSync(join(f.source, "runtime.pid"), String(process.pid));
  expect((await apply(f)).exit).not.toBe(0);
  expect(f.store.recentInbound()).toHaveLength(0);
  rmSync(join(f.source, "runtime.pid"));
  expect((await apply(f)).exit).toBe(0);
  expect(
    JSON.parse(
      readFileSync(join(f.source, ".product-repair-cutover.json"), "utf8"),
    ).doNotStartLegacyWriter,
  ).toBe(true);
  expect(f.store.claimOutbound()).toBeUndefined();
});
test("D04 malformed/unreadable legacy files never replace with empty state", () => {
  const f = setup();
  writeFileSync(join(f.source, "pending-batch.json"), "{broken");
  expect(() =>
    migrateLegacy({ source: f.source, paths: f.paths, lineId: "line-1" }),
  ).toThrow("LEGACY_JSON_INVALID");
  expect(f.store.recentInbound()).toHaveLength(0);
  f.write("pending-batch.json", { messages: [] });
  chmodSync(join(f.source, "pending-batch.json"), 0);
  expect(() =>
    migrateLegacy({ source: f.source, paths: f.paths, lineId: "line-1" }),
  ).toThrow();
  chmodSync(join(f.source, "pending-batch.json"), 0o600);
  expect(f.store.recentInbound()).toHaveLength(0);
});
test("legacy delegated record stays review-needed rather than replaying task", async () => {
  const f = setup();
  f.write("orchestrator-handled/legacy-batch.json", {
    routedTo: "researcher",
    taskId: "old-task",
  });
  expect((await apply(f)).exit).toBe(0);
  expect(f.store.getTask("old-task")?.state).toBe("unknown");
  expect(f.store.claimBatch("legacy-batch").status).toBe("busy");
  expect(
    f.store.getMetadata(
      "legacy-source",
      "orchestrator-handled/legacy-batch.json",
    ),
  ).toMatchObject({ taskId: "old-task" });
});
test("committed migration repairs missing cutover marker without reimporting work", async () => {
  const f = setup();
  expect((await apply(f)).exit).toBe(0);
  rmSync(join(f.source, ".product-repair-cutover.json"));
  const again = await apply(f);
  expect(again.report.alreadyImported).toBe(true);
  expect(existsSync(join(f.source, ".product-repair-cutover.json"))).toBe(true);
  expect(f.store.listOutbound()).toHaveLength(2);
});
test("legacy task helper prevents replay even without orchestrator handled record", async () => {
  const f = setup();
  f.write("tasks/legacy-task.json", {
    taskId: "legacy-task",
    batchId: "legacy-batch",
    owner: "researcher",
    finalOwner: "front-door",
  });
  expect((await apply(f)).exit).toBe(0);
  expect(f.store.tasksForBatch("legacy-batch")[0]?.state).toBe("unknown");
  expect(f.store.claimBatch("legacy-batch").status).toBe("busy");
});
