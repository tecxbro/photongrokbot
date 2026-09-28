/** Offline, explicit import. Never run from normal bridge startup. */
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  resolveInstancePaths,
  type InstancePaths,
} from "../../shared/instance-paths.mjs";
import { assertInstanceLock } from "./instance-lock.ts";
import { openStore, type SqliteBridgeStore } from "./storage.ts";
import { canonical, validateRecord } from "./storage.contract.ts";
import type { InboundRecord } from "./types.ts";

type Issue = { file: string; code: string; id?: string };
type Inventory = {
  source: string;
  digest: string;
  files: Map<string, unknown>;
  issues: Issue[];
};
export type MigrationReport = {
  version: 1;
  digest: string;
  source: string;
  dryRun: boolean;
  alreadyImported?: boolean;
  events: number;
  batches: number;
  outbound: number;
  issues: Issue[];
  backupPath?: string;
};
const categories = [
  "inbound",
  "unread",
  "batch-claims",
  "orchestrator-handled",
  "presentations",
  "cards-ready",
  "tasks",
  "delegations",
  "live-card-context",
  "context",
];
const files = [
  "handled-ids.json",
  "pending-batch.json",
  "webhook-pending.json",
  "outbound-queue.json",
  "inbound.jsonl",
  "outbound.jsonl",
  "poll-meta.json",
  "app-card-sessions.json",
  "presentation-index.json",
  "onboarding-celebrated.json",
];
function walk(root: string): string[] {
  const result: string[] = [];
  for (const name of readdirSync(root).sort()) {
    const path = join(root, name),
      st = lstatSync(path);
    if (st.isSymbolicLink()) throw new Error("LEGACY_SYMLINK_REJECTED");
    if (st.isDirectory()) result.push(...walk(path));
    else if (st.isFile()) result.push(path);
    else throw new Error("LEGACY_FILE_INVALID");
  }
  return result;
}
function inventory(source: string): Inventory {
  source = realpathSync(source);
  const rows = new Map<string, unknown>();
  const digest = createHash("sha256");
  const issues: Issue[] = [];
  // Hash every regular file, including attachments/helpers. Changes cannot hide behind an unchanged queue.
  for (const path of walk(source)) {
    const name = relative(source, path);
    if (name === ".product-repair-cutover.json") continue;
    const raw = readFileSync(path);
    digest.update(name).update("\0").update(raw).update("\0");
    if (
      files.includes(name) ||
      categories.some(
        (dir) => name.startsWith(`${dir}/`) && name.endsWith(".json"),
      )
    ) {
      let value: unknown;
      try {
        value = name.endsWith(".jsonl")
          ? raw
              .toString("utf8")
              .split(/\r?\n/)
              .filter(Boolean)
              .map((line) => JSON.parse(line))
          : JSON.parse(raw.toString("utf8"));
      } catch {
        throw new Error("LEGACY_JSON_INVALID");
      }
      rows.set(name, value);
    }
  }
  return { source, digest: digest.digest("hex"), files: rows, issues };
}
function array(value: unknown, key: string): any[] {
  if (value === undefined) return [];
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray((value as any)[key])
  )
    throw new Error("LEGACY_SCHEMA_INVALID");
  return (value as any)[key];
}
function stopped(source: string, attested: boolean) {
  if (!attested) throw new Error("STOPPED_WRITERS_ATTESTATION_REQUIRED");
  const pidPath = join(source, "runtime.pid");
  if (existsSync(pidPath)) {
    const raw = readFileSync(pidPath, "utf8").trim();
    if (!/^\d+$/.test(raw)) throw new Error("LEGACY_PID_INVALID");
    try {
      process.kill(Number(raw), 0);
      throw new Error("LEGACY_WRITER_RUNNING");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
}
function immutable(root: string) {
  for (const path of walk(root)) chmodSync(path, 0o400);
  const dirs = (path: string) => {
    for (const name of readdirSync(path)) {
      const child = join(path, name);
      if (lstatSync(child).isDirectory()) dirs(child);
    }
    chmodSync(path, 0o500);
  };
  dirs(root);
}
function makePlan(inv: Inventory, lineId: string) {
  if (!lineId.trim()) throw new Error("LEGACY_LINE_ID_REQUIRED");
  const inbound = new Map<
    string,
    { record: InboundRecord; lineId: string; pending: boolean }
  >();
  const handled = new Set(array(inv.files.get("handled-ids.json"), "ids"));
  const issues = [...inv.issues];
  const insert = (record: unknown, pending: boolean, file: string) => {
    validateRecord(record);
    const r = record as InboundRecord & { lineId?: string };
    const line = r.lineId || lineId;
    const key = canonical([r.spaceId, line, r.id]);
    const previous = inbound.get(key);
    if (previous && canonical(previous.record) !== canonical(record))
      issues.push({ file, code: "CONTRADICTORY_EVENT", id: r.id });
    else if (!previous) inbound.set(key, { record: r, lineId: line, pending });
    else previous.pending ||= pending;
  };
  for (const [name, value] of inv.files) {
    if (name === "inbound.jsonl") {
      if (!Array.isArray(value)) throw new Error("LEGACY_SCHEMA_INVALID");
      for (const r of value) insert(r, false, name);
    } else if (name.startsWith("inbound/")) insert(value, false, name);
  }
  for (const r of array(inv.files.get("pending-batch.json"), "messages"))
    insert(r, true, "pending-batch.json");
  const batches: any[] = [];
  const membership = new Map<string, string>();
  for (const [name, value] of inv.files)
    if (name.startsWith("unread/")) {
      const b = value as any;
      if (
        !b ||
        typeof b.batchId !== "string" ||
        !Array.isArray(b.messages) ||
        !Number.isFinite(Date.parse(b.flushedAt))
      )
        throw new Error("LEGACY_BATCH_INVALID");
      const dests = new Set<string>();
      for (const r of b.messages) {
        insert(r, false, name);
        const key = canonical([r.spaceId, r.lineId || lineId, r.id]);
        dests.add(canonical([r.spaceId, r.lineId || lineId]));
        if (membership.has(key) && membership.get(key) !== b.batchId)
          issues.push({
            file: name,
            code: "MULTIPLE_BATCH_MEMBERSHIP",
            id: r.id,
          });
        else membership.set(key, b.batchId);
      }
      if (dests.size !== 1) {
        issues.push({
          file: name,
          code: "MIXED_OR_EMPTY_BATCH_REVIEW",
          id: b.batchId,
        });
      }
      batches.push({ file: name, batch: b, dests: [...dests] });
    }
  const outbound = array(inv.files.get("outbound-queue.json"), "items");
  for (const item of outbound)
    if (
      !item ||
      typeof item.id !== "string" ||
      typeof item.spaceId !== "string" ||
      !Number.isFinite(Date.parse(item.createdAt)) ||
      !["queued", "sent", "failed"].includes(item.status)
    )
      throw new Error("LEGACY_OUTBOUND_INVALID");
  for (const batchId of array(
    inv.files.get("webhook-pending.json"),
    "batchIds",
  ))
    if (!batches.some((b) => b.batch.batchId === batchId))
      issues.push({
        file: "webhook-pending.json",
        code: "DANGLING_WAKE",
        id: batchId,
      });
  for (const item of outbound)
    if (item.status === "queued")
      issues.push({
        file: "outbound-queue.json",
        code: "LEGACY_SEND_UNKNOWN",
        id: item.id,
      });
  return { inbound, handled, batches, outbound, membership, issues };
}
function writeCutoverMarker(
  source: string,
  installationId: string,
  digest: string,
  databasePath: string,
): void {
  const path = join(source, ".product-repair-cutover.json");
  if (existsSync(path)) {
    const existing = JSON.parse(readFileSync(path, "utf8"));
    if (
      existing.installationId !== installationId ||
      existing.digest !== digest ||
      existing.databasePath !== databasePath
    )
      throw new Error("LEGACY_CUTOVER_CONFLICT");
    return;
  }
  writeFileSync(
    path,
    canonical({
      version: 1,
      installationId,
      digest,
      databasePath,
      doNotStartLegacyWriter: true,
    }),
    { mode: 0o600, flag: "wx" },
  );
}
export function migrateLegacy(options: {
  source: string;
  paths: InstancePaths;
  lineId: string;
  apply?: boolean;
  writersStopped?: boolean;
}): MigrationReport {
  const inv = inventory(options.source);
  const plan = makePlan(inv, options.lineId);
  const report: MigrationReport = {
    version: 1,
    digest: inv.digest,
    source: inv.source,
    dryRun: !options.apply,
    events: plan.inbound.size,
    batches: plan.batches.length,
    outbound: plan.outbound.length,
    issues: plan.issues,
  };
  if (!options.apply) return report;
  assertInstanceLock(options.paths);
  stopped(inv.source, options.writersStopped === true);
  const store = openStore({ paths: options.paths, create: true });
  try {
    const prior = store.db
      .query(
        "SELECT digest,source_root,report FROM migration WHERE singleton=1",
      )
      .get() as any;
    if (prior) {
      if (prior.digest !== inv.digest || prior.source_root !== inv.source)
        throw new Error("LEGACY_SOURCE_CHANGED_RECONCILE");
      writeCutoverMarker(
        inv.source,
        store.installationId,
        inv.digest,
        options.paths.databasePath,
      );
      return {
        ...JSON.parse(prior.report),
        alreadyImported: true,
        dryRun: false,
      };
    }
    if (
      store.db.query("SELECT id FROM inbox LIMIT 1").get() ||
      store.db.query("SELECT id FROM outbound LIMIT 1").get()
    )
      throw new Error("MIGRATION_TARGET_NOT_EMPTY");
    if (
      resolve(inv.source) === resolve(options.paths.root) ||
      resolve(options.paths.root).startsWith(resolve(inv.source) + "/")
    )
      throw new Error("MIGRATION_SOURCE_OVERLAP");
    const attemptPath = join(
      options.paths.backupsDir,
      "legacy-migration-attempt.json",
    );
    if (existsSync(attemptPath)) {
      const attempted = JSON.parse(readFileSync(attemptPath, "utf8"));
      if (attempted.digest !== inv.digest || attempted.source !== inv.source)
        throw new Error("LEGACY_SOURCE_CHANGED_RECONCILE");
    } else
      writeFileSync(
        attemptPath,
        canonical({ digest: inv.digest, source: inv.source }),
        { mode: 0o400, flag: "wx" },
      );
    const backupPath = join(options.paths.backupsDir, `legacy-${inv.digest}`);
    if (!existsSync(backupPath))
      cpSync(inv.source, backupPath, {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
    if (
      inventory(inv.source).digest !== inv.digest ||
      inventory(backupPath).digest !== inv.digest
    )
      throw new Error("LEGACY_SOURCE_CHANGED_DURING_BACKUP");
    immutable(backupPath);
    report.backupPath = backupPath;
    // Copy attachment/helper evidence to its own private archive before committing references.
    const archive = join(
      options.paths.dataDir,
      `legacy-assets-${inv.digest.slice(0, 16)}`,
    );
    mkdirSync(archive, { mode: 0o700, recursive: true });
    for (const category of [
      "inbound-attachments",
      "outbound-assets",
      "outbound-jpeg",
    ]) {
      const original = join(inv.source, category);
      if (existsSync(original))
        cpSync(original, join(archive, category), { recursive: true });
    }
    const remap = (value: any): any => {
      if (typeof value === "string" && value.startsWith(inv.source + "/")) {
        const suffix = relative(inv.source, value);
        if (
          ["inbound-attachments/", "outbound-assets/", "outbound-jpeg/"].some(
            (prefix) => suffix.startsWith(prefix),
          ) &&
          existsSync(join(archive, suffix))
        )
          return join(archive, suffix);
        return value;
      }
      if (Array.isArray(value)) return value.map(remap);
      if (value && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value).map(([k, v]) => [k, remap(v)]),
        );
      return value;
    };
    store.db
      .transaction(() => {
        const eventIds = new Map<string, string>();
        let ordinal = 0;
        for (const [key, entry] of plan.inbound) {
          const eventId = `legacy-e-${createHash("sha256").update(key).digest("hex")}`;
          eventIds.set(key, eventId);
          const inBatch = plan.membership.has(key);
          store.db
            .query(
              "INSERT INTO inbox(id,event_key,provider_id,space_id,line_id,record,received_at,pending) VALUES(?,?,?,?,?,?,?,?)",
            )
            .run(
              eventId,
              `legacy:${key}`,
              entry.record.id,
              entry.record.spaceId,
              entry.lineId,
              canonical(remap(entry.record)),
              Date.parse(entry.record.receivedAt),
              entry.pending && !inBatch ? 1 : 0,
            );
          store.db
            .query("INSERT INTO targets VALUES(?,?,?) ON CONFLICT DO NOTHING")
            .run(entry.record.spaceId, entry.lineId, entry.record.id);
        }
        for (const entry of plan.batches) {
          const b = entry.batch;
          const mixed = entry.dests.length !== 1;
          const [destination, line] = mixed
            ? ["legacy-review", options.lineId]
            : JSON.parse(entry.dests[0]);
          const claim = inv.files.get(`batch-claims/${b.batchId}.json`) as any;
          const done = claim?.state === "completed";
          const wasDelegated = inv.files.has(
            `orchestrator-handled/${b.batchId}.json`,
          );
          const state =
            mixed || (wasDelegated && !done)
              ? "review"
              : done
                ? "completed"
                : "pending";
          store.db
            .query(
              "INSERT INTO batches(id,space_id,line_id,formed_at,state,completed_at) VALUES(?,?,?,?,?,?)",
            )
            .run(
              b.batchId,
              destination,
              line,
              Date.parse(b.flushedAt),
              state,
              done ? Date.parse(claim?.updatedAt ?? b.flushedAt) : null,
            );
          ordinal = 0;
          for (const r of b.messages) {
            const key = canonical([
              r.spaceId,
              r.lineId || options.lineId,
              r.id,
            ]);
            if (plan.membership.get(key) === b.batchId)
              store.db
                .query("INSERT INTO batch_events VALUES(?,?,?)")
                .run(b.batchId, eventIds.get(key)!, ordinal++);
          }
          store.db
            .query("INSERT INTO wakes(batch_id,state) VALUES(?,?)")
            .run(b.batchId, state === "pending" ? "pending" : "acknowledged");
          if (wasDelegated && !done) {
            const legacy = inv.files.get(
              `orchestrator-handled/${b.batchId}.json`,
            ) as any;
            const taskId =
              typeof legacy.taskId === "string"
                ? legacy.taskId
                : `legacy-task-${b.batchId}`;
            const binding = {
              taskId,
              batchId: b.batchId,
              destination: { spaceId: destination, lineId: line },
              owner: String(
                legacy.taskOwner ?? legacy.routedTo ?? "legacy-unknown",
              ),
              finalOwner: String(legacy.finalOwner ?? "legacy-front-door"),
              state: "unknown",
              receipt: "legacy-record-only",
            };
            store.db
              .query("INSERT INTO tasks VALUES(?,?,?,?,?)")
              .run(
                taskId,
                b.batchId,
                canonical(binding),
                "unknown",
                Date.now(),
              );
            report.issues.push({
              file: entry.file,
              code: "LEGACY_HANDOFF_REVIEW",
              id: taskId,
            });
          }
        }
        for (const item of plan.outbound) {
          const operationId = `legacy-op-${createHash("sha256").update(item.id).digest("hex")}`;
          const state =
            item.status === "sent"
              ? "accepted"
              : item.status === "failed"
                ? "failed"
                : "unknown";
          const reference = item.messageId
            ? {
                messageId: item.messageId,
                ...(item.parts ? { parts: remap(item.parts) } : {}),
              }
            : undefined;
          store.db
            .query("INSERT INTO operations VALUES(?,?,?,?,?,?,?,?,?)")
            .run(
              operationId,
              item.spaceId,
              item.lineId || options.lineId,
              "legacy",
              item.id,
              createHash("sha256").update(canonical(item)).digest("hex"),
              null,
              null,
              Date.parse(item.createdAt),
            );
          store.db
            .query(
              "INSERT INTO outbound(id,operation_id,ordinal,item,state,attempts,reference,code,settled_at) VALUES(?,?,0,?,?,?,?,?,?)",
            )
            .run(
              item.id,
              operationId,
              canonical(remap(item)),
              state,
              Number.isInteger(item.attempts) ? item.attempts : 0,
              reference ? canonical(reference) : null,
              item.status === "sent"
                ? "LEGACY_ACCEPTED_EVIDENCE"
                : item.status === "queued"
                  ? "LEGACY_DISPATCH_UNCERTAIN"
                  : "LEGACY_FAILED",
              Date.parse(item.sentAt ?? item.failedAt ?? item.createdAt),
            );
          if (reference?.messageId)
            store.db
              .query("INSERT INTO targets VALUES(?,?,?) ON CONFLICT DO NOTHING")
              .run(
                item.spaceId,
                item.lineId || options.lineId,
                reference.messageId,
              );
        }
        for (const providerId of plan.handled)
          store.setMetadata("legacy-handled", String(providerId), {
            source: "handled-ids.json",
            noReplay: true,
          });
        for (const [name, value] of inv.files) {
          if (name.startsWith("tasks/") || name.startsWith("delegations/")) {
            const raw = value as any;
            const taskId = raw?.taskId;
            const batchId = raw?.batchId;
            if (
              typeof taskId === "string" &&
              typeof batchId === "string" &&
              store.db.query("SELECT id FROM batches WHERE id=?").get(batchId)
            ) {
              if (!store.getTask(taskId)) {
                const destination = store.batchDestination(batchId);
                const binding = {
                  taskId,
                  batchId,
                  destination,
                  owner: String(raw.owner ?? raw.taskOwner ?? "legacy-unknown"),
                  finalOwner: String(raw.finalOwner ?? "legacy-front-door"),
                  state: "unknown",
                  receipt: "legacy-record-only",
                };
                store.db
                  .query("INSERT INTO tasks VALUES(?,?,?,?,?)")
                  .run(
                    taskId,
                    batchId,
                    canonical(binding),
                    "unknown",
                    Date.now(),
                  );
                store.db
                  .query("UPDATE batches SET state='review' WHERE id=?")
                  .run(batchId);
              }
              report.issues.push({
                file: name,
                code: "LEGACY_HANDOFF_REVIEW",
                id: taskId,
              });
            } else
              report.issues.push({
                file: name,
                code: "DANGLING_TASK_BINDING",
                ...(typeof taskId === "string" ? { id: taskId } : {}),
              });
          }
          store.setMetadata("legacy-source", name, remap(value));
          if (name === "poll-meta.json" || name === "app-card-sessions.json") {
            const map = (value as any)?.byMessageId;
            if (!map || typeof map !== "object" || Array.isArray(map))
              throw new Error("LEGACY_MAPPING_INVALID");
            for (const [key, row] of Object.entries(map))
              store.setMetadata(
                name === "poll-meta.json" ? "poll" : "app-session",
                key,
                remap(row),
              );
          }
          if (name.startsWith("presentations/")) {
            const record = remap(value);
            if (
              !record?.batchId ||
              !record.messageId ||
              !Array.isArray(record.parts)
            )
              throw new Error("LEGACY_PRESENTATION_INVALID");
            store.setMetadata("presentation", record.batchId, record);
            store.setMetadata("presentation-index", record.messageId, {
              batchId: record.batchId,
            });
          }
        }
        const celebration = inv.files.get("onboarding-celebrated.json") as any;
        if (celebration?.setupConfettiSent === true)
          store.setMetadata("onboarding", "reservation", {
            actionKey: `onboarding:${store.installationId}`,
            state: "legacy-recorded",
            provenance: "legacy-marker-not-device-observation",
            legacy: celebration,
            outboundIds: [],
          });
        if (inventory(inv.source).digest !== inv.digest)
          throw new Error("LEGACY_SOURCE_CHANGED_DURING_IMPORT");
        store.db
          .query("INSERT INTO migration VALUES(1,?,?,?,?)")
          .run(inv.source, inv.digest, canonical(report), Date.now());
      })
      .immediate();
    writeCutoverMarker(
      inv.source,
      store.installationId,
      inv.digest,
      options.paths.databasePath,
    );
    return report;
  } finally {
    store.close();
  }
}
if (import.meta.main) {
  try {
    const args = process.argv.slice(2).filter((a) => a !== "--");
    const flags: Record<string, string | boolean> = {};
    for (let i = 0; i < args.length; i++) {
      const key = args[i]!;
      if (key === "--apply" || key === "--writers-stopped") flags[key] = true;
      else if (["--source", "--line-id"].includes(key) && args[i + 1])
        flags[key] = args[++i]!;
      else throw new Error("ARGUMENT_INVALID");
    }
    if (
      typeof flags["--source"] !== "string" ||
      typeof flags["--line-id"] !== "string"
    )
      throw new Error("ARGUMENT_REQUIRED");
    console.log(
      JSON.stringify(
        migrateLegacy({
          source: flags["--source"],
          lineId: flags["--line-id"],
          paths: resolveInstancePaths(),
          apply: flags["--apply"] === true,
          writersStopped: flags["--writers-stopped"] === true,
        }),
      ),
    );
  } catch {
    console.error("LEGACY_MIGRATION_REJECTED");
    process.exitCode = 1;
  }
}
