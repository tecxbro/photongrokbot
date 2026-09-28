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
import { Database } from "bun:sqlite";
import { openStore } from "../../storage.ts";
import { canonical } from "../../storage.contract.ts";
import { createHash } from "node:crypto";
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

function versionOneFixture() {
  const f = fixture(); fixtures.push(f); f.store.close();
  for (const suffix of ["", "-wal", "-shm"]) rmSync(f.paths.databasePath + suffix, { force: true });
  writeFileSync(f.paths.databasePath, "", { mode: 0o600 });
  const db = new Database(f.paths.databasePath);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(readFileSync(new URL("../../migrations/001-inbox-outbox.sql", import.meta.url), "utf8"));
  db.query("INSERT INTO instance VALUES(1,?,1)").run("test-installation-0001");
  db.exec("PRAGMA user_version=1");
  const destination = { spaceId: "space-1", lineId: "line-1" };
  const task = { taskId: "v1-task", batchId: "v1-batch", destination, owner: "worker", finalOwner: "front-door", state: "accepted", receipt: "preserved native evidence" };
  db.query("INSERT INTO inbox(id,event_key,provider_id,space_id,line_id,record,received_at,pending) VALUES(?,?,?,?,?,?,?,0)").run("v1-event", "v1-event-key", "v1-message", "space-1", "line-1", JSON.stringify(record("v1-message")), 1);
  db.query("INSERT INTO batches(id,space_id,line_id,formed_at,state,run_id,generation,lease_until) VALUES(?,?,?,1,'delegated','v1-run',1,0)").run("v1-batch", "space-1", "line-1");
  db.exec("INSERT INTO batch_events VALUES('v1-batch','v1-event',0); INSERT INTO wakes(batch_id,state) VALUES('v1-batch','acknowledged')");
  db.query("INSERT INTO tasks VALUES(?,?,?,?,?)").run(task.taskId, task.batchId, JSON.stringify(task), task.state, 1);
  const payload = { spaceId: "space-1", text: "Done." };
  const digest = createHash("sha256").update(canonical(payload)).digest("hex");
  db.query("INSERT INTO operations VALUES(?,?,?,?,?,?,?,?,?)").run("v1-operation", "space-1", "line-1", "progress", "answer:1", digest, "v1-batch", null, 1);
  const reference = { messageId: "provider-original", miniAppCardSession: { chatGuid: "chat", messageGuid: "message", sessionId: "session", targetMessageGuid: "target" } };
  const item = { id: "v1-outbound", kind: "text", ...payload, createdAt: new Date(1).toISOString(), status: "unknown", attempts: 1, operationId: "v1-operation" };
  db.query("INSERT INTO outbound(id,operation_id,ordinal,item,state,attempts,reference,code) VALUES(?,?,0,?,'unknown',1,?,'v1_uncertainty')").run(item.id, "v1-operation", JSON.stringify(item), JSON.stringify(reference));
  for (const [kind, key, value] of [
    ["onboarding", "reservation", { state: "legacy-recorded", outboundIds: [item.id] }],
    ["presentation", "option-map", { messageId: "provider-options", parts: [{ partIndex: 0, optionId: "dog", childId: "p:0/provider-options" }] }],
    ["app-session", "provider-original", { session: reference.miniAppCardSession, url: "https://example.test/live", live: true }],
  ] as const) db.query("INSERT INTO metadata VALUES(?,?,?)").run(kind, key, JSON.stringify(value));
  const snapshot = { outbound: db.query("SELECT * FROM outbound").all(), metadata: db.query("SELECT * FROM metadata ORDER BY kind,key").all(), tasks: db.query("SELECT id,batch_id,binding,state,updated_at FROM tasks").all() };
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); db.close();
  return { ...f, destination, task, payload, snapshot };
}

test("v1 read-only inspection requires explicit upgrade and leaves the database unchanged", () => {
  const f = versionOneFixture();
  const before = readFileSync(f.paths.databasePath);
  expect(() => openStore({ paths: f.paths, readOnly: true })).toThrow("STORE_UPGRADE_REQUIRED");
  expect(readFileSync(f.paths.databasePath)).toEqual(before);
  const raw = new Database(f.paths.databasePath, { readonly: true });
  try { expect(raw.query("PRAGMA user_version").get()).toEqual({ user_version: 1 }); }
  finally { raw.close(); }
});

test("forward v1 upgrade preserves operation IDs, uncertainty, provider references, task ownership and metadata", () => {
  const f = versionOneFixture(), upgraded = openStore({ paths: f.paths });
  try {
    expect(upgraded.db.query("PRAGMA user_version").get()).toEqual({ user_version: 2 });
    expect(upgraded.db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(upgraded.db.query("SELECT * FROM outbound").all()).toEqual(f.snapshot.outbound);
    expect(upgraded.db.query("SELECT * FROM metadata ORDER BY kind,key").all()).toEqual(f.snapshot.metadata);
    expect(upgraded.db.query("SELECT id,batch_id,binding,state,updated_at FROM tasks").all()).toEqual(f.snapshot.tasks);
    expect(upgraded.getTask(f.task.taskId)).toMatchObject(f.task);
    expect(upgraded.getTask(f.task.taskId)!.inputs).toHaveLength(1);
    expect(upgraded.readBatch("v1-batch")).toMatchObject({ inputRevision: 1, continuationReason: "inbound" });
    const status = upgraded.operationStatus(f.destination, "progress", "answer:1", { batchId: "v1-batch", inputRevision: 1 });
    expect(status[0]).toMatchObject({ id: "v1-outbound", state: "unknown", code: "v1_uncertainty", reference: { messageId: "provider-original" } });
    expect(upgraded.claimOutbound()).toBeUndefined();
  } finally { upgraded.close(); }
  const reopened = openStore({ paths: f.paths, readOnly: true });
  try {
    expect(reopened.outboundStatus("v1-outbound")?.state).toBe("unknown");
    expect(reopened.getTask(f.task.taskId)!.inputs).toHaveLength(1);
  } finally { reopened.close(); }
});

for (const recovery of ["recoverWork", "formBatches"] as const) {
  test(`${recovery} preserves a legacy review batch instead of treating its original input as a continuation`, () => {
    const f = versionOneFixture();
    const versionOne = new Database(f.paths.databasePath);
    try {
      versionOne.exec("UPDATE batches SET state='review',run_id=NULL,lease_until=NULL WHERE id='v1-batch'; UPDATE wakes SET state='failed' WHERE batch_id='v1-batch'");
    } finally { versionOne.close(); }
    const upgraded = openStore({ paths: f.paths });
    try {
      expect(upgraded.claimSnapshot("v1-batch")).toMatchObject({ state: "review", inputRevision: 1, acknowledgedRevision: 0, claimedRevision: null });
      upgraded[recovery]();
      upgraded[recovery]();
      expect(upgraded.claimSnapshot("v1-batch")).toMatchObject({ state: "review", inputRevision: 1, acknowledgedRevision: 0, claimedRevision: null });
      expect(upgraded.claimBatch("v1-batch")).toEqual({ status: "busy" });
      expect(upgraded.claimWake()).toBeUndefined();
      expect(upgraded.outboundStatus("v1-outbound")).toMatchObject({ state: "unknown", code: "v1_uncertainty" });
      expect(upgraded.getTask(f.task.taskId)).toMatchObject(f.task);
      expect(upgraded.readBatch("v1-batch").messages[0]?.id).toBe("v1-message");
    } finally { upgraded.close(); }
  });
}


test("documented offline schema upgrade requires the lifetime lock and upgrades the original v1 database", () => {
  const f = versionOneFixture();
  const bridgeRoot = new URL("../../../", import.meta.url).pathname;
  const env: Record<string, string | undefined> = {...process.env, PHOTON_TEST_MODE: "1", PHOTON_INSTANCE_DIR: f.root};
  delete env.PHOTON_LOCK_FD;
  const unlocked = Bun.spawnSync([process.execPath, "run", "src/upgrade-store.ts"], {cwd: bridgeRoot, env});
  expect(unlocked.exitCode).toBe(1);
  expect(JSON.parse(unlocked.stderr.toString()).error.code).toBe("INSTANCE_LOCK_REQUIRED");
  const before = new Database(f.paths.databasePath, {readonly: true});
  expect(before.query("PRAGMA user_version").get()).toEqual({user_version: 1}); before.close();
  const upgraded = Bun.spawnSync(["python3", "tools/with-instance-lock.py", join(f.root, "runtime.lock"), process.execPath, "run", "src/upgrade-store.ts"], {cwd: bridgeRoot, env});
  expect(upgraded.exitCode).toBe(0);
  expect(JSON.parse(upgraded.stdout.toString())).toEqual({ok: true, schemaVersion: 2});
  const store = openStore({paths: f.paths, readOnly: true});
  try { expect(store.outboundStatus("v1-outbound")?.state).toBe("unknown"); }
  finally { store.close(); }
});
