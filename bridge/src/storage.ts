import { randomUUID, createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fsyncSync,
  openSync,
  mkdtempSync,
  fchmodSync,
  readSync,
  writeSync,
  rmSync,
} from "node:fs";
import { resolveInstancePaths } from "../../shared/instance-paths.mjs";
import { dirname, join } from "node:path";
import type { Database } from "bun:sqlite";
import type {
  AcceptInput,
  AcceptResult,
  ClaimToken,
  ClaimResult,
  Destination,
  MediaJob,
  MediaResult,
  ProviderOutcome,
  ProviderReference,
  PresentationContext,
  Submission,
  TaskBinding,
  TaskInput,
  TaskResult,
  TaskResultInput,
  OperationSource,
  WakeJob,
  OutboundClaim,
  OutboundStatus,
} from "./contracts.ts";
import type {
  InboundRecord,
  EnqueueOutboundInput,
  OutboundItem,
  UnreadBatch,
} from "./types.ts";
import { openDatabase, assertPrivateDatabasePath } from "./db.ts";
import { buildOutboundItems } from "./storage-prepare.ts";
import {
  canonical,
  parseRecord,
  validateClaim,
  validateDestination,
  validateId,
  validateRecord,
  type StoreOptions,
  type ExtendedBridgeStore,
  type ClaimSnapshot,
} from "./storage.contract.ts";

type Row = Record<string, any>;
const now = () => Date.now();
const id = (kind: string) => `${kind}-${randomUUID()}`;
const hash = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
const unresolved = "'queued','sending','retry_wait','unknown'";
const terminal = "'accepted','failed','skipped','cancelled'";
function defaultPaths() {
  return resolveInstancePaths();
}
function lease(value: number) {
  if (!Number.isFinite(value) || value < 1 || value > 3600000)
    throw new Error("LEASE_INVALID");
  return value;
}
function payload(row: Row): OutboundItem {
  const item = JSON.parse(row.item);
  if (
    !item ||
    item.id !== row.id ||
    typeof item.spaceId !== "string" ||
    typeof item.createdAt !== "string"
  )
    throw new Error("OUTBOUND_RECORD_INVALID");
  return {
    ...item,
    status: row.state,
    attempts: row.attempts,
    ...(row.reference ? JSON.parse(row.reference) : {}),
  } as OutboundItem;
}

export class SqliteBridgeStore implements ExtendedBridgeStore {
  readonly installationId: string;
  readonly evidence;
  /** Private lane implementation/migration port; normal consumers use BridgeStore. */
  readonly db: Database;
  private readonly fault?: (transition: string) => void;
  private readonly paths;
  private readonly readOnly;
  constructor(options: StoreOptions = {}) {
    if (options.fault && !options.testMode)
      throw new Error("FAULT_INJECTION_TEST_ONLY");
    if (options.testMode && !options.paths)
      throw new Error("EXPLICIT_TEST_PATH_REQUIRED");
    this.readOnly = options.readOnly ?? false;
    this.paths = options.paths ?? defaultPaths();
    const opened = openDatabase(
      this.paths,
      options.create ?? false,
      this.readOnly,
      { verifyIntegrity: options.verifyIntegrity },
    );
    this.db = opened.db;
    this.installationId = opened.installationId;
    this.evidence = opened.evidence;
    this.fault = options.fault;
  }
  private tx<T>(label: string, fn: () => T): T {
    const transaction = this.db.transaction(() => {
      this.fault?.(`${label}:begin`);
      const value = fn();
      if (value instanceof Promise)
        throw new Error("ASYNC_TRANSACTION_FORBIDDEN");
      this.fault?.(`${label}:before_commit`);
      return value;
    });
    const result = this.readOnly
      ? transaction.deferred()
      : transaction.immediate();
    this.fault?.(`${label}:after_commit`);
    return result;
  }
  sqliteFacts() {
    return {
      version: this.evidence.version,
      sourceId: this.evidence.source,
      journalMode: this.evidence.journal,
      filesystemVerified: true,
    };
  }
  close() {
    this.db.close();
  }
  backupTo(path: string): void {
    assertPrivateDatabasePath(path, this.paths.backupsDir);
    const fd = openSync(
      path,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    let temporary: string | undefined;
    try {
      // VACUUM INTO creates a consistent standalone DELETE-journal snapshot.
      // Apple SQLite rejects an already-existing output, including an empty file.
      // Its default file mode may be 0644, so build only inside a private 0700
      // directory, then copy to our exclusively created 0600 destination fd.
      temporary = mkdtempSync(join(dirname(path), ".snapshot-"));
      const snapshotPath = join(temporary, "bridge.sqlite");
      this.db.query("VACUUM INTO ?").run(snapshotPath);
      const source = openSync(
        snapshotPath,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        fchmodSync(source, 0o600);
        const chunk = Buffer.alloc(64 * 1024);
        let count: number;
        while ((count = readSync(source, chunk, 0, chunk.length, null)) > 0) {
          let offset = 0;
          while (offset < count) {
            const written = writeSync(fd, chunk, offset, count - offset, null);
            if (written <= 0) throw new Error("BACKUP_WRITE_FAILED");
            offset += written;
          }
        }
      } finally {
        closeSync(source);
      }
      fsyncSync(fd);
      const directory = openSync(dirname(path), constants.O_RDONLY);
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    } finally {
      closeSync(fd);
      if (temporary) rmSync(temporary, { recursive: true, force: true });
    }
  }
  getMetadata<T>(kind: string, key: string): T | undefined {
    const row = this.db
      .query("SELECT value FROM metadata WHERE kind=? AND key=?")
      .get(kind, key) as Row | null;
    return row ? JSON.parse(row.value) : undefined;
  }
  listMetadata<T>(
    kind: string,
    limit = 1000,
    afterKey?: string,
  ): Array<{ key: string; value: T }> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
      throw new Error("LIMIT_INVALID");
    if (
      afterKey !== undefined &&
      (typeof afterKey !== "string" ||
        afterKey.length > 8192 ||
        afterKey.includes("\0"))
    )
      throw new Error("METADATA_CURSOR_INVALID");
    return (
      this.db
        .query(
          "SELECT key,value FROM metadata WHERE kind=? AND (? IS NULL OR key>?) ORDER BY key LIMIT ?",
        )
        .all(kind, afterKey ?? null, afterKey ?? null, limit) as Row[]
    ).map((row) => ({ key: row.key, value: JSON.parse(row.value) }));
  }
  operationStatus(destination: Destination, purpose: string, actionKey: string, source: OperationSource): OutboundStatus[] {
    validateDestination(destination);
    const scope = this.operationScope(destination, source);
    return (this.db.query("SELECT o.id FROM outbound o JOIN operations p ON p.id=o.operation_id WHERE p.space_id=? AND p.line_id=? AND p.scope=? AND p.purpose=? AND p.action_key=? ORDER BY o.ordinal")
      .all(destination.spaceId, destination.lineId, scope, purpose, actionKey) as Row[]).map(row => this.outboundStatus(row.id)!);
  }
  private operationScope(destination: Destination, source: OperationSource): string {
    if (!source) throw new Error("OPERATION_SOURCE_REQUIRED");
    if (canonical(this.batchDestination(source.batchId)) !== canonical(destination)) throw new Error("BATCH_DESTINATION_MISMATCH");
    const batch = this.claimSnapshot(source.batchId);
    const revision = source.inputRevision ?? batch.claimedRevision ?? batch.inputRevision;
    if (!Number.isSafeInteger(revision) || revision < 1 || revision > batch.inputRevision) throw new Error("INPUT_REVISION_INVALID");
    if (source.taskId) {
      const associated = this.getTaskInput(source.taskId, source.batchId, revision, false);
      if (source.taskInputRevision !== undefined && source.taskInputRevision !== associated.inputRevision) throw new Error("TASK_CONTEXT_MISMATCH");
    } else if (source.taskInputRevision !== undefined && !this.db.query("SELECT 1 FROM task_inputs WHERE batch_id=? AND result_work_revision=? AND input_revision=?").get(source.batchId, revision, source.taskInputRevision)) throw new Error("TASK_CONTEXT_MISMATCH");
    if (source.cardId) {
      const card = this.getMetadata<PresentationContext>("task-card-context", source.cardId);
      if (!card || card.taskId !== source.taskId || canonical(card.destination) !== canonical(destination)) throw new Error("TASK_CARD_CONTEXT_MISMATCH");
      this.getTaskInput(card.taskId, source.batchId, revision, false);
      return `card:${card.cardId}`;
    }
    if (source.optionSetRevision) {
      const key = canonical([source.batchId, revision, source.optionSetRevision, destination]);
      if (!this.getMetadata("option-set-context", key)) throw new Error("OPTION_SET_CONTEXT_MISMATCH");
      return `options:${source.batchId}:${revision}:${source.optionSetRevision}`;
    }
    const recordedTask = this.db.query("SELECT task_id FROM task_inputs WHERE batch_id=? AND result_work_revision=? ORDER BY input_revision DESC LIMIT 1").get(source.batchId, revision) as Row | null;
    if (recordedTask) {
      if (source.taskId && source.taskId !== recordedTask.task_id) throw new Error("TASK_CONTEXT_MISMATCH");
      source = {...source, taskId: recordedTask.task_id};
    }
    if (source.taskId) {
      const input = this.getTaskInput(source.taskId, source.batchId, revision, false);
      if (source.taskInputRevision !== undefined && source.taskInputRevision !== input.inputRevision) throw new Error("TASK_CONTEXT_MISMATCH");
      return `task:${source.taskId}:input:${input.inputRevision}`;
    }
    if (source.taskInputRevision !== undefined) throw new Error("TASK_CONTEXT_MISMATCH");
    return `work:${source.batchId}:${revision}`;
  }
  deleteMetadata(kind: string, key: string): void {
    this.db.query("DELETE FROM metadata WHERE kind=? AND key=?").run(kind, key);
  }
  setMetadata(kind: string, key: string, value: unknown): void {
    if (!kind || !key) throw new Error("METADATA_KEY_INVALID");
    this.db
      .query(
        "INSERT INTO metadata(kind,key,value) VALUES(?,?,?) ON CONFLICT(kind,key) DO UPDATE SET value=excluded.value",
      )
      .run(kind, key, canonical(value));
  }
  accept(input: AcceptInput): AcceptResult {
    validateRecord(input.record);
    validateDestination(input.destination);
    if (
      !input.eventKey ||
      input.eventKey.length > 4096 ||
      input.record.spaceId !== input.destination.spaceId
    )
      throw new Error("EVENT_IDENTITY_INVALID");
    if (
      input.media &&
      (input.media.messageId !== input.record.id ||
        input.media.spaceId !== input.destination.spaceId ||
        input.media.lineId !== input.destination.lineId ||
        !["voice", "attachment"].includes(input.media.kind))
    )
      throw new Error("MEDIA_REFERENCE_INVALID");
    return this.tx("accept", () => {
      const duplicate = this.db
        .query(
          "SELECT id FROM inbox WHERE event_key=? OR (event_key LIKE 'legacy:%' AND provider_id=? AND space_id=? AND line_id=?)",
        )
        .get(
          input.eventKey,
          input.record.id,
          input.destination.spaceId,
          input.destination.lineId,
        ) as Row | null;
      if (duplicate)
        return {
          eventId: duplicate.id,
          duplicate: true,
          onboardingCreated: false,
        };
      if (this.getMetadata("legacy-handled", input.record.id))
        return {
          eventId: `legacy-handled-${hash(input.record.id)}`,
          duplicate: true,
          onboardingCreated: false,
        };
      const eventId = id("e");
      const onboardingCreated =
        !!input.onboarding && !this.getMetadata("onboarding", "reservation");
      this.db
        .query(
          "INSERT INTO inbox(id,event_key,provider_id,space_id,line_id,record,received_at,pending) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          eventId,
          input.eventKey,
          input.record.id,
          input.destination.spaceId,
          input.destination.lineId,
          canonical(input.record),
          Date.parse(input.record.receivedAt),
          onboardingCreated && input.greetingOnly ? 0 : 1,
        );
      this.db
        .query("INSERT INTO targets VALUES(?,?,?) ON CONFLICT DO NOTHING")
        .run(
          input.destination.spaceId,
          input.destination.lineId,
          input.record.id,
        );
      if (input.media)
        this.db
          .query("INSERT INTO media_jobs(id,event_id,reference) VALUES(?,?,?)")
          .run(id("m"), eventId, canonical(input.media));
      if (onboardingCreated) {
        const actionKey = `onboarding:${this.installationId}`;
        const items = this.insertOperation(
          {
            kind: "text",
            spaceId: input.destination.spaceId,
            text: "Hey, it’s Grokbot here! What can I help with?",
            effect: "confetti",
          },
          { actionKey, destination: input.destination, purpose: "onboarding" },
        );
        this.setMetadata("onboarding", "reservation", {
          actionKey,
          eventId,
          outboundIds: items.map((i) => i.id),
          state: "queued",
          provenance: "transactional-first-input",
        });
      }
      return { eventId, duplicate: false, onboardingCreated };
    });
  }
  formBatches(at = now(), destinations?: Destination[]): UnreadBatch[] {
    if (!Number.isFinite(new Date(at).getTime()))
      throw new Error("BATCH_TIME_INVALID");
    if (destinations !== undefined) {
      if (!Array.isArray(destinations)) throw new Error("DESTINATIONS_INVALID");
      destinations.forEach(validateDestination);
    }
    return this.tx("form_batches", () => {
      this.dispatchContinuations();
      // Explicit pairs come from independently due inbound debounce windows.
      // Undefined preserves startup recovery's sweep of all pending input.
      const groups =
        destinations === undefined
          ? (this.db
              .query(
                "SELECT space_id,line_id FROM inbox WHERE pending=1 GROUP BY space_id,line_id",
              )
              .all() as Row[])
          : [
              ...new Map(
                destinations.map((destination) => [
                  canonical(destination),
                  {
                    space_id: destination.spaceId,
                    line_id: destination.lineId,
                  },
                ]),
              ).values(),
            ];
      const result: UnreadBatch[] = [];
      for (const group of groups) {
        const events = this.db
          .query(
            "SELECT id FROM inbox WHERE pending=1 AND space_id=? AND line_id=? ORDER BY seq LIMIT 250",
          )
          .all(group.space_id, group.line_id) as Row[];
        if (!events.length) continue;
        const batchId = id("b");
        this.db
          .query(
            "INSERT INTO batches(id,space_id,line_id,formed_at) VALUES(?,?,?,?)",
          )
          .run(batchId, group.space_id, group.line_id, at);
        events.forEach((event, index) => {
          this.db
            .query("INSERT INTO batch_events VALUES(?,?,?)")
            .run(batchId, event.id, index);
          this.db.query("UPDATE inbox SET pending=0 WHERE id=?").run(event.id);
        });
        this.db.query("INSERT INTO wakes(batch_id) VALUES(?)").run(batchId);
        this.captureRevision(batchId, 1, "inbound", "inbound");
        result.push(this.readBatch(batchId));
      }
      return result;
    });
  }
  batchDestination(batchId: string): Destination {
    validateId(batchId, "batch_id");
    const row = this.db
      .query("SELECT space_id,line_id FROM batches WHERE id=?")
      .get(batchId) as Row | null;
    if (!row) throw new Error("BATCH_NOT_FOUND");
    return { spaceId: row.space_id, lineId: row.line_id };
  }
  private captureRevision(batchId: string, revision: number, reason: string, sourceKey: string, extra: Row = {}): void {
    const events = this.db.query("SELECT i.id,i.provider_id,i.record FROM batch_events b JOIN inbox i ON i.id=b.event_id WHERE b.batch_id=? ORDER BY b.ordinal").all(batchId) as Row[];
    const media = (this.db.query("SELECT m.* FROM media_jobs m JOIN batch_events b ON b.event_id=m.event_id WHERE b.batch_id=? ORDER BY b.ordinal").all(batchId) as Row[]).map(row => this.mediaRow(row));
    const snapshot = { messages: events.map(row => parseRecord(row.record)), media,
      originalSources: events.map(row => ({eventId: row.id, messageId: row.provider_id})),
      sources: events.map(row => ({eventId: row.id, messageId: row.provider_id})), ...extra };
    this.db.query("INSERT INTO batch_revisions(batch_id,revision,reason,source_key,snapshot,created_at) VALUES(?,?,?,?,?,?)")
      .run(batchId, revision, reason, sourceKey, canonical(snapshot), now());
  }
  private appendRevision(batchId: string, reason: string, sourceKey: string, extra: Row = {}): number {
    const prior = this.db.query("SELECT revision FROM batch_revisions WHERE batch_id=? AND source_key=?").get(batchId, sourceKey) as Row | null;
    if (prior) return prior.revision;
    const batch = this.claimSnapshot(batchId), revision = batch.inputRevision + 1;
    this.captureRevision(batchId, revision, reason, sourceKey, extra);
    // A running reader retains its snapshot. Delegated/finished/expired readers
    // yield to persisted continuation work, with fresh fenced authority.
    const activeReader = batch.state === "claimed" && batch.leaseUntil! > now();
    this.db.query("UPDATE batches SET input_revision=?,state=?,completed_at=NULL,run_id=CASE WHEN ? THEN run_id ELSE NULL END,lease_until=CASE WHEN ? THEN lease_until ELSE NULL END WHERE id=?")
      .run(revision, activeReader ? "claimed" : "pending", activeReader ? 1 : 0, activeReader ? 1 : 0, batchId);
    this.resetWake(batchId);
    return revision;
  }
  private resetWake(batchId: string): void {
    this.db.query("INSERT INTO wakes(batch_id) VALUES(?) ON CONFLICT(batch_id) DO UPDATE SET state='pending',attempts=0,next_at=0,attempt_id=NULL,lease_until=NULL,code=NULL").run(batchId);
  }
  readBatch(batchId: string, inputRevision?: number): UnreadBatch {
    return this.tx("read_batch", () => {
      const destination = this.batchDestination(batchId), row = this.claimSnapshot(batchId);
      const revision = inputRevision ?? ((row.state === "claimed" || row.state === "delegated") && row.leaseUntil! > now() ? row.claimedRevision : null) ?? row.inputRevision;
      const stored = this.db.query("SELECT * FROM batch_revisions WHERE batch_id=? AND revision=?").get(batchId, revision) as Row | null;
      if (!stored) throw new Error("INPUT_REVISION_INVALID");
      const snapshot = JSON.parse(stored.snapshot);
      const formed = this.db.query("SELECT formed_at FROM batches WHERE id=?").get(batchId) as Row;
      const taskResults = (this.db.query("SELECT value FROM task_results WHERE json_extract(value,'$.batchId')=? AND json_extract(value,'$.workRevision')<=? ORDER BY created_at,id").all(batchId, revision) as Row[]).map(r => JSON.parse(r.value));
      return {batchId, flushedAt: new Date(formed.formed_at).toISOString(), destination,
        ...snapshot, inputRevision: revision, acknowledgedRevision: row.acknowledgedRevision,
        continuationReason: stored.reason, tasks: this.tasksForBatch(batchId), taskResults};
    });
  }
  claimSnapshot(batchId: string): ClaimSnapshot {
    validateId(batchId, "batch_id");
    const row = this.db
      .query(
        "SELECT state,run_id AS runId,generation,lease_until AS leaseUntil,input_revision AS inputRevision,claimed_revision AS claimedRevision,acknowledged_revision AS acknowledgedRevision FROM batches WHERE id=?",
      )
      .get(batchId) as ClaimSnapshot | null;
    if (!row) throw new Error("BATCH_NOT_FOUND");
    return row;
  }
  claimBatch(batchId: string, leaseMs = 900000): ClaimResult {
    validateId(batchId, "batch_id");
    lease(leaseMs);
    return this.tx("claim_batch", () => {
      const row = this.claimSnapshot(batchId);
      const at = now();
      if (row.state === "completed") return { status: "completed" };
      if (
        row.state === "review" ||
        row.state === "delegated" ||
        (row.state === "claimed" && row.leaseUntil! > at)
      )
        return { status: "busy" };
      const token = {
        batchId,
        runId: id("run"),
        generation: row.generation + 1,
      };
      this.db
        .query(
          "UPDATE batches SET state='claimed',run_id=?,generation=?,lease_until=?,claimed_revision=input_revision WHERE id=?",
        )
        .run(token.runId, token.generation, at + leaseMs, batchId);
      return { status: "acquired", token, leaseUntil: at + leaseMs, inputRevision: row.inputRevision };
    });
  }
  assertClaim(token: ClaimToken): void {
    validateClaim(token);
    const row = this.claimSnapshot(token.batchId);
    if (
      !["claimed", "delegated"].includes(row.state) ||
      row.runId !== token.runId ||
      row.generation !== token.generation ||
      row.leaseUntil! <= now()
    )
      throw new Error("STALE_CLAIM");
  }
  renewClaim(token: ClaimToken, leaseMs = 900000): void {
    lease(leaseMs);
    this.tx("renew_claim", () => {
      this.assertClaim(token);
      this.db
        .query("UPDATE batches SET lease_until=? WHERE id=?")
        .run(now() + leaseMs, token.batchId);
    });
  }
  assertWork(token: ClaimToken, inputRevision?: number): number {
    this.assertClaim(token);
    const row = this.claimSnapshot(token.batchId);
    const revision = inputRevision ?? row.claimedRevision;
    if (!Number.isSafeInteger(revision) || revision !== row.claimedRevision) throw new Error("STALE_INPUT_REVISION");
    return revision!;
  }
  completeClaim(token: ClaimToken, inputRevision?: number): void {
    this.tx("complete_claim", () => {
      const revision = this.assertWork(token, inputRevision), batch = this.claimSnapshot(token.batchId);
      const unresolvedTask = this.db.query("SELECT 1 FROM task_inputs i JOIN tasks t ON t.id=i.task_id WHERE i.batch_id=? AND i.work_revision<=? AND t.current_input_revision=i.input_revision AND i.state IN ('intent','unknown','accepted') LIMIT 1").get(token.batchId, revision);
      if (unresolvedTask) throw new Error("TASK_UNRESOLVED");
      const pending = batch.inputRevision > revision;
      this.db.query("UPDATE batches SET acknowledged_revision=MAX(acknowledged_revision,?),state=?,completed_at=?,run_id=NULL,lease_until=NULL WHERE id=?")
        .run(revision, pending ? "pending" : "completed", pending ? null : now(), token.batchId);
      if (pending) this.resetWake(token.batchId);
    });
  }
  bindTask(token: ClaimToken, binding: TaskBinding): void {
    validateId(binding.taskId, "task_id");
    validateDestination(binding.destination);
    if ([binding.owner, binding.finalOwner].some(value => typeof value !== "string" || !value.trim() || value.length > 512) || !["intent", "accepted", "unknown", "completed"].includes(binding.state)) throw new Error("TASK_BINDING_INVALID");
    if (binding.receipt !== undefined && (typeof binding.receipt !== "string" || !binding.receipt.trim() || binding.receipt.length > 4096)) throw new Error("TASK_RECEIPT_REQUIRED");
    if (binding.nativeRef !== undefined && (typeof binding.nativeRef !== "string" || !binding.nativeRef.trim() || binding.nativeRef.length > 4096)) throw new Error("NATIVE_REFERENCE_INVALID");
    this.tx("bind_task", () => {
      const revision = this.assertWork(token);
      if (canonical(this.batchDestination(token.batchId)) !== canonical(binding.destination)) throw new Error("TASK_DESTINATION_MISMATCH");
      const existing = this.getTask(binding.taskId);
      let input: TaskInput;
      if (existing) {
        if (existing.batchId !== binding.batchId || canonical(existing.destination) !== canonical(binding.destination) || existing.owner !== binding.owner || existing.finalOwner !== binding.finalOwner) throw new Error("TASK_ID_CONFLICT");
        input = this.getTaskInput(binding.taskId, token.batchId, revision);
        if (binding.currentInputRevision !== undefined && binding.currentInputRevision !== input.inputRevision) throw new Error("SUPERSEDED_TASK_INPUT");
        if (input.state !== binding.state && !(input.state === "intent" && ["accepted", "unknown"].includes(binding.state)) && !(input.state === "accepted" && binding.state === "completed") && !(input.state === "unknown" && binding.state === "accepted" && binding.receipt)) throw new Error("TASK_TRANSITION_INVALID");
        if (existing.nativeRef && binding.nativeRef && existing.nativeRef !== binding.nativeRef) throw new Error("NATIVE_REFERENCE_CONFLICT");
      } else {
        if (binding.batchId !== token.batchId) throw new Error("TASK_BINDING_INVALID");
        if (binding.state !== "intent") throw new Error("TASK_INTENT_REQUIRED");
        if (this.db.query("SELECT 1 FROM task_inputs i JOIN tasks t ON t.id=i.task_id WHERE i.batch_id=? AND i.work_revision=? AND i.input_revision=t.current_input_revision AND i.state!='completed'").get(token.batchId, revision)) throw new Error("HANDOFF_ALREADY_RESERVED");
        this.db.query("INSERT INTO tasks(id,batch_id,binding,state,updated_at,current_input_revision) VALUES(?,?,?,?,?,1)").run(binding.taskId, binding.batchId, canonical(binding), binding.state, now());
        input = {taskId: binding.taskId, inputRevision: 1, batchId: token.batchId, workRevision: revision, correlationId: id("cor"), state: "intent"};
        this.db.query("INSERT INTO task_inputs(task_id,input_revision,batch_id,work_revision,correlation_id,state) VALUES(?,?,?,?,?,?)").run(binding.taskId, 1, token.batchId, revision, input.correlationId, input.state);
      }
      if (["accepted", "completed"].includes(binding.state) && (typeof binding.receipt !== "string" || !binding.receipt.trim() || binding.receipt.length > 4096)) throw new Error("TASK_RECEIPT_REQUIRED");
      // The persistent local identity is independent of a native ID returned later.
      const {inputs: _inputs, currentInputRevision: _current, ...clean} = binding;
      const updated = {...clean, ...(existing?.nativeRef ? {nativeRef: existing.nativeRef} : {})};
      this.db.query("UPDATE tasks SET binding=?,state=?,updated_at=? WHERE id=?").run(canonical(updated), binding.state, now(), binding.taskId);
      this.db.query("UPDATE task_inputs SET state=?,receipt=? WHERE task_id=? AND input_revision=?").run(binding.state, binding.receipt ?? input.receipt ?? null, binding.taskId, input.inputRevision);
      this.db.query("UPDATE batches SET state=? WHERE id=?").run(binding.state === "completed" ? "claimed" : "delegated", token.batchId);
    });
  }
  private taskInputRow(row: Row): TaskInput {
    return {taskId: row.task_id, inputRevision: row.input_revision, batchId: row.batch_id,
      workRevision: row.work_revision, correlationId: row.correlation_id, state: row.state,
      ...(row.receipt ? {receipt: row.receipt} : {}), ...(row.result_work_revision ? {resultWorkRevision: row.result_work_revision} : {})};
  }
  getTask(taskId: string): TaskBinding | undefined {
    validateId(taskId, "task_id");
    const row = this.db.query("SELECT binding,current_input_revision FROM tasks WHERE id=?").get(taskId) as Row | null;
    if (!row) return;
    const value = JSON.parse(row.binding);
    if (value.taskId !== taskId || !value.destination) throw new Error("TASK_RECORD_INVALID");
    return {...value, currentInputRevision: row.current_input_revision,
      inputs: (this.db.query("SELECT * FROM task_inputs WHERE task_id=? ORDER BY input_revision").all(taskId) as Row[]).map(r => this.taskInputRow(r))};
  }
  getTaskInput(taskId: string, batchId: string, workRevision?: number, requireCurrent = true): TaskInput {
    const task = this.getTask(taskId), batch = this.claimSnapshot(batchId);
    const revision = workRevision ?? batch.claimedRevision ?? batch.inputRevision;
    if (!task || canonical(task.destination) !== canonical(this.batchDestination(batchId))) throw new Error("TASK_CONTEXT_MISMATCH");
    const input = task.inputs!.find(i => i.batchId === batchId && (i.workRevision === revision || i.resultWorkRevision === revision));
    if (!input) throw new Error("TASK_CONTEXT_MISMATCH");
    if (requireCurrent && input.inputRevision !== task.currentInputRevision) throw new Error("SUPERSEDED_TASK_INPUT");
    return input;
  }
  associateTask(token: ClaimToken, taskId: string, inputRevision?: number): TaskInput {
    return this.tx("associate_task", () => {
      const revision = this.assertWork(token, inputRevision), task = this.getTask(taskId);
      if (!task) throw new Error("TASK_NOT_FOUND");
      if (canonical(task.destination) !== canonical(this.batchDestination(token.batchId))) throw new Error("TASK_DESTINATION_MISMATCH");
      const prior = task.inputs!.find(i => i.batchId === token.batchId && (i.workRevision === revision || i.resultWorkRevision === revision));
      if (prior) {
        if (prior.inputRevision !== task.currentInputRevision) throw new Error("SUPERSEDED_TASK_INPUT");
        return prior;
      }
      if (!task.nativeRef && task.state !== "completed" && task.state !== "accepted") throw new Error("TASK_NOT_ACCEPTED");
      if (this.db.query("SELECT 1 FROM task_inputs WHERE batch_id=? AND work_revision=?").get(token.batchId, revision)) throw new Error("HANDOFF_ALREADY_RESERVED");
      const next = task.currentInputRevision! + 1;
      const input: TaskInput = {taskId, inputRevision: next, batchId: token.batchId, workRevision: revision, correlationId: id("cor"), state: "intent"};
      this.db.query("INSERT INTO task_inputs(task_id,input_revision,batch_id,work_revision,correlation_id,state) VALUES(?,?,?,?,?,?)").run(taskId, next, token.batchId, revision, input.correlationId, input.state);
      const {inputs: _inputs, currentInputRevision: _current, ...binding} = task;
      this.db.query("UPDATE tasks SET current_input_revision=?,state='intent',binding=?,updated_at=? WHERE id=?").run(next, canonical({...binding, state: "intent"}), now(), taskId);
      return input;
    });
  }
  ingestTaskResult(input: TaskResultInput): TaskResult {
    if (!input || Object.keys(input).some(k => !["taskId", "inputRevision", "correlationId", "nativeRef", "receipt", "result"].includes(k))) throw new Error("TASK_RESULT_INVALID");
    validateId(input.taskId, "task_id");
    if (!Number.isSafeInteger(input.inputRevision) || input.inputRevision < 1 || typeof input.receipt !== "string" || !input.receipt.trim() || input.receipt.length > 4096 || input.result === undefined || canonical(input).length > 60000) throw new Error("TASK_RESULT_INVALID");
    if (input.nativeRef !== undefined && (typeof input.nativeRef !== "string" || !input.nativeRef.trim() || input.nativeRef.length > 4096)) throw new Error("NATIVE_REFERENCE_INVALID");
    return this.tx("task_result", () => {
      const task = this.getTask(input.taskId), associated = task?.inputs?.find(i => i.inputRevision === input.inputRevision);
      if (!task || !associated || associated.correlationId !== input.correlationId) throw new Error("TASK_RESULT_CORRELATION_MISMATCH");
      if (task.nativeRef && input.nativeRef && task.nativeRef !== input.nativeRef) throw new Error("NATIVE_REFERENCE_CONFLICT");
      const digest = hash(input);
      const prior = this.db.query("SELECT digest,value FROM task_results WHERE task_id=? AND input_revision=?").get(input.taskId, input.inputRevision) as Row | null;
      if (prior) {
        if (prior.digest !== digest) throw new Error("TASK_RESULT_CONFLICT");
        return JSON.parse(prior.value);
      }
      const superseded = task.currentInputRevision !== input.inputRevision;
      const result: TaskResult = {...input, resultId: id("result"), batchId: associated.batchId, superseded};
      if (!superseded) result.workRevision = this.appendRevision(associated.batchId, "task_result", `result:${result.resultId}`, {
        sources: [{taskId: input.taskId, taskInputRevision: input.inputRevision, resultId: result.resultId}],
      });
      this.db.query("INSERT INTO task_results(id,task_id,input_revision,digest,value,created_at) VALUES(?,?,?,?,?,?)").run(result.resultId, input.taskId, input.inputRevision, digest, canonical(result), now());
      this.db.query("UPDATE task_inputs SET state='completed',receipt=?,result_work_revision=? WHERE task_id=? AND input_revision=?").run(input.receipt, result.workRevision ?? null, input.taskId, input.inputRevision);
      const {inputs: _inputs, currentInputRevision: _current, ...binding} = task;
      const updated = {...binding, ...(input.nativeRef && !task.nativeRef ? {nativeRef: input.nativeRef} : {}), ...(!superseded ? {state: "completed", receipt: input.receipt} : {})};
      this.db.query("UPDATE tasks SET state=?,binding=?,updated_at=? WHERE id=?").run(updated.state, canonical(updated), now(), input.taskId);
      return result;
    });
  }
  resumeTask(taskId: string, inputRevision: number): ClaimResult {
    return this.tx("resume_task", () => {
      const task = this.getTask(taskId);
      if (!task || task.currentInputRevision !== inputRevision) throw new Error("SUPERSEDED_TASK_INPUT");
      const input = task.inputs!.find(i => i.inputRevision === inputRevision);
      if (!input?.resultWorkRevision) throw new Error("TASK_RESULT_REQUIRED");
      return this.claimBatch(input.batchId);
    });
  }
  registerPresentation(token: ClaimToken, context: PresentationContext): void {
    if (
      !context ||
      Object.keys(context).some(
        (key) =>
          !["cardId", "taskId", "batchId", "destination", "viewUrl"].includes(
            key,
          ),
      ) ||
      typeof context.cardId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(context.cardId) ||
      typeof context.taskId !== "string" ||
      !context.taskId ||
      typeof context.viewUrl !== "string" ||
      context.viewUrl.length > 8192
    )
      throw new Error("PRESENTATION_CONTEXT_INVALID");
    validateDestination(context.destination);
    let view: URL;
    try {
      view = new URL(context.viewUrl);
    } catch {
      throw new Error("PRESENTATION_URL_INVALID");
    }
    // Preserve the entire signed URL, while checking the host service's exact
    // route/card relationship. Registration is local policy, not host proof.
    const route = /^\/live-(?:[1-9]|10)\/([^/]+)$/.exec(view.pathname);
    if (
      view.protocol !== "https:" ||
      view.username ||
      view.password ||
      view.hash ||
      view.href !== context.viewUrl ||
      route?.[1] !== context.cardId ||
      view.searchParams.getAll("k").length !== 1 ||
      !view.searchParams.get("k") ||
      [...view.searchParams.keys()].some((key) => key !== "k")
    )
      throw new Error("PRESENTATION_URL_INVALID");
    this.tx("register_presentation", () => {
      this.assertClaim(token);
      if (
        canonical(context.destination) !==
          canonical(this.batchDestination(token.batchId))
      )
        throw new Error("PRESENTATION_BINDING_MISMATCH");
      const task = this.getTask(context.taskId);
      if (task && canonical(task.destination) !== canonical(context.destination)) throw new Error("PRESENTATION_TASK_MISMATCH");
      if (task && task.batchId !== context.batchId) throw new Error("PRESENTATION_BINDING_MISMATCH");
      if (
        !task ||
        task.batchId !== context.batchId ||
        canonical(task.destination) !== canonical(context.destination)
      )
        throw new Error("PRESENTATION_TASK_MISMATCH");
      this.getTaskInput(context.taskId, token.batchId, this.assertWork(token));
      const configured = this.getMetadata<{ origin?: unknown }>(
        "live-mini-host",
        "configured",
      );
      if (
        !configured ||
        typeof configured.origin !== "string" ||
        view.origin !== configured.origin
      )
        throw new Error("PRESENTATION_HOST_MISMATCH");
      const existing = this.getMetadata<PresentationContext>(
        "task-card-context",
        context.cardId,
      );
      const indexed = this.getMetadata<{ cardId: string }>(
        "task-card-url",
        context.viewUrl,
      );
      if (existing) {
        if (
          canonical(existing) !== canonical(context) ||
          indexed?.cardId !== context.cardId
        )
          throw new Error("PRESENTATION_IDENTITY_CONFLICT");
        return;
      }
      if (indexed) throw new Error("PRESENTATION_IDENTITY_CONFLICT");
      this.db
        .query(
          "INSERT INTO metadata(kind,key,value) VALUES('task-card-context',?,?)",
        )
        .run(context.cardId, canonical(context));
      this.fault?.("register_presentation:context");
      this.db
        .query(
          "INSERT INTO metadata(kind,key,value) VALUES('task-card-url',?,?)",
        )
        .run(context.viewUrl, canonical({ cardId: context.cardId }));
    });
  }
  enqueue(
    input: EnqueueOutboundInput,
    context: {
      actionKey: string;
      destination: Destination;
      purpose: string;
      claim?: ClaimToken;
      inputRevision?: number;
      taskInputRevision?: number;
      optionSetRevision?: string;
      taskId?: string;
      presentation?: Submission["presentation"];
    },
  ): OutboundItem[] {
    validateDestination(context.destination);
    if (
      input.spaceId !== context.destination.spaceId ||
      !context.actionKey ||
      context.actionKey.length > 512 ||
      !["progress", "final", "control", "presentation"].includes(
        context.purpose,
      )
    )
      throw new Error("OUTBOUND_CONTEXT_INVALID");
    if (!context.claim) throw new Error("CLAIM_REQUIRED");
    if ((input.kind === "app" || input.kind === "app_update") && !context.presentation && this.getMetadata("task-card-url", input.url)) throw new Error("PRESENTATION_IDENTITY_CONFLICT");
    if (context.purpose === "control" && input.kind !== "typing")
      throw new Error("CONTROL_TYPING_ONLY");
    if (context.presentation) {
      const presentation = context.presentation;
      if (
        Object.keys(presentation).some(
          (key) => !["cardId", "taskId", "viewUrl", "claimId"].includes(key),
        ) ||
        [presentation.cardId, presentation.taskId, presentation.claimId].some(
          (value) =>
            typeof value !== "string" || !value.trim() || value.length > 512,
        ) ||
        input.kind !== "app" ||
        !("url" in input) ||
        presentation.viewUrl !== input.url ||
        (context.taskId !== undefined && presentation.taskId !== context.taskId)
      )
        throw new Error("PRESENTATION_CONTEXT_INVALID");
    }
    const prepared = buildOutboundItems(input);
    return this.tx("enqueue", () => {
      const revision = this.assertWork(context.claim!, context.inputRevision);
      context = {...context, inputRevision: revision};
      if (
        canonical(this.batchDestination(context.claim!.batchId)) !==
        canonical(context.destination)
      )
        throw new Error("BATCH_DESTINATION_MISMATCH");
      const recordedTask = this.db.query("SELECT task_id,result_work_revision FROM task_inputs WHERE batch_id=? AND (work_revision=? OR result_work_revision=?) ORDER BY input_revision DESC LIMIT 1").get(context.claim!.batchId, revision, revision) as Row | null;
      if (recordedTask) {
        if (context.taskId && context.taskId !== recordedTask.task_id) throw new Error("TASK_CONTEXT_MISMATCH");
        this.getTaskInput(recordedTask.task_id, context.claim!.batchId, revision);
        if (recordedTask.result_work_revision === revision || context.presentation) context = {...context, taskId: recordedTask.task_id};
      }
      if (input.kind === "attachment_group" && context.actionKey.startsWith(`cards:${context.claim!.batchId}:`)) {
        const recordedRevision = context.actionKey.slice(`cards:${context.claim!.batchId}:`.length);
        if (context.optionSetRevision !== undefined && context.optionSetRevision !== recordedRevision) throw new Error("OPTION_SET_CONTEXT_MISMATCH");
        context = {...context, optionSetRevision: recordedRevision};
      }
      if (context.taskId) {
        const associated = this.getTaskInput(context.taskId, context.claim!.batchId, revision);
        if (!["accepted", "completed"].includes(associated.state)) throw new Error("TASK_NOT_ACCEPTED");
        if (context.taskInputRevision !== undefined && context.taskInputRevision !== associated.inputRevision) throw new Error("TASK_CONTEXT_MISMATCH");
        context = {...context, taskInputRevision: associated.inputRevision};
      } else if (context.taskInputRevision !== undefined) throw new Error("TASK_CONTEXT_MISMATCH");
      if (context.optionSetRevision) {
        const key = canonical([context.claim!.batchId, revision, context.optionSetRevision, context.destination]);
        const option = this.getMetadata<{payloadHash:string}>("option-set-context", key);
        if (!option) throw new Error("OPTION_SET_CONTEXT_MISMATCH");
      }
      return this.insertOperation(input, context, prepared);
    });
  }
  private insertOperation(
    input: EnqueueOutboundInput,
    context: {
      actionKey: string;
      destination: Destination;
      purpose: string;
      claim?: ClaimToken;
      inputRevision?: number;
      taskInputRevision?: number;
      optionSetRevision?: string;
      taskId?: string;
      presentation?: Submission["presentation"];
    },
    prepared = buildOutboundItems(input),
  ): OutboundItem[] {
    const digest = hash(input);
    const source: OperationSource | undefined = context.claim ? {batchId: context.claim.batchId, inputRevision: context.inputRevision, taskId: context.taskId ?? context.presentation?.taskId, taskInputRevision: context.taskInputRevision, optionSetRevision: context.optionSetRevision, cardId: context.presentation?.cardId} : undefined;
    const scope = context.purpose === "onboarding" ? `installation:${this.installationId}` : this.operationScope(context.destination, source!);
    const cardContext = context.presentation ? this.getMetadata<PresentationContext>("task-card-context", context.presentation.cardId) : undefined;
    const presentation = context.presentation
      ? {
          ...context.presentation,
          batchId: cardContext?.batchId ?? context.claim!.batchId,
          actionKey: context.actionKey,
          destination: context.destination,
        }
      : undefined;
    const cardIdentity = presentation
      ? { ...presentation, purpose: context.purpose, payloadHash: digest }
      : undefined;
    if (presentation) {
      const registered = this.getMetadata(
        "task-card-context",
        presentation.cardId,
      );
      const expected = {
        cardId: presentation.cardId,
        taskId: presentation.taskId,
        batchId: presentation.batchId,
        destination: presentation.destination,
        viewUrl: presentation.viewUrl,
      };
      if (
        context.purpose !== "presentation" ||
        registered === undefined ||
        canonical(registered) !== canonical(expected)
      )
        throw new Error("TASK_CARD_CONTEXT_MISMATCH");
      const reserved = this.getMetadata<Row>(
        "task-card-operation",
        presentation.cardId,
      );
      if (reserved && canonical(reserved.identity) !== canonical(cardIdentity))
        throw new Error("TASK_CARD_OPERATION_CONFLICT");
    }
    const prior = this.db
      .query(
        "SELECT * FROM operations WHERE space_id=? AND line_id=? AND purpose=? AND action_key=? AND scope=?",
      )
      .get(
        context.destination.spaceId,
        context.destination.lineId,
        context.purpose,
        context.actionKey,
        scope,
      ) as Row | null;
    if (prior) {
      // Card ownership is anchored to its original task; other scopes also
      // require the exact stored request association, even for equal payloads.
      const migratedCard = !!context.presentation && prior.task_id === null && cardContext?.taskId === context.taskId;
      if ((!migratedCard && prior.task_id !== (context.taskId ?? null)) || (!context.presentation && prior.batch_id !== (context.claim?.batchId ?? null))) throw new Error("OPERATION_SOURCE_CONFLICT");
      if (prior.payload_hash !== digest)
        throw new Error("ACTION_PAYLOAD_CONFLICT");
      const items = (
        this.db
          .query("SELECT * FROM outbound WHERE operation_id=? ORDER BY ordinal")
          .all(prior.id) as Row[]
      ).map(payload);
      for (const item of items) {
        const existing = this.getMetadata("presentation-submission", item.id);
        const expected = presentation
          ? { ...presentation, outboundId: item.id }
          : undefined;
        if (
          existing === undefined
            ? expected !== undefined
            : expected === undefined ||
              canonical(existing) !== canonical(expected)
        )
          throw new Error("PRESENTATION_IDENTITY_CONFLICT");
      }
      if (
        presentation &&
        !this.getMetadata("task-card-operation", presentation.cardId)
      )
        this.db
          .query(
            "INSERT INTO metadata(kind,key,value) VALUES('task-card-operation',?,?)",
          )
          .run(
            presentation.cardId,
            canonical({
              identity: cardIdentity,
              operationId: prior.id,
              outboundIds: items.map((item) => item.id),
            }),
          );
      return items;
    }
    if (
      presentation &&
      this.getMetadata("task-card-operation", presentation.cardId)
    )
      throw new Error("TASK_CARD_OPERATION_CONFLICT");
    const operationId = id("op");
    this.db
      .query("INSERT INTO operations(id,space_id,line_id,purpose,action_key,payload_hash,batch_id,task_id,created_at,scope,input_revision,task_input_revision) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(
        operationId,
        context.destination.spaceId,
        context.destination.lineId,
        context.purpose,
        context.actionKey,
        digest,
        context.claim?.batchId ?? null,
        context.taskId ?? null,
        now(),
        scope,
        context.inputRevision ?? (context.claim ? this.claimSnapshot(context.claim.batchId).claimedRevision : null),
        context.taskInputRevision ?? null,
      );
    prepared.forEach((item, index) => {
      this.db
        .query(
          "INSERT INTO outbound(id,operation_id,ordinal,item,state) VALUES(?,?,?,?, 'queued')",
        )
        .run(item.id, operationId, index, canonical(item));
      if (presentation) {
        this.db
          .query(
            "INSERT INTO metadata(kind,key,value) VALUES('presentation-submission',?,?)",
          )
          .run(item.id, canonical({ ...presentation, outboundId: item.id }));
      }
      this.fault?.("enqueue:child");
    });
    if (presentation)
      this.db
        .query(
          "INSERT INTO metadata(kind,key,value) VALUES('task-card-operation',?,?)",
        )
        .run(
          presentation.cardId,
          canonical({
            identity: cardIdentity,
            operationId,
            outboundIds: prepared.map((item) => item.id),
          }),
        );
    return prepared;
  }
  claimOutbound(at = now()): OutboundClaim | undefined {
    return this.tx("claim_outbound", () => {
      const row = this.db
        .query(
          `SELECT o.*,p.space_id,p.line_id FROM outbound o JOIN operations p ON p.id=o.operation_id WHERE o.state IN ('queued','retry_wait') AND o.next_at<=? AND NOT EXISTS (SELECT 1 FROM outbound older JOIN operations q ON q.id=older.operation_id WHERE older.seq<o.seq AND q.space_id=p.space_id AND q.line_id=p.line_id AND older.state IN (${unresolved}) AND ((p.purpose='control' AND q.purpose='control') OR (p.purpose!='control' AND q.purpose!='control'))) ORDER BY o.seq LIMIT 1`,
        )
        .get(at) as Row | null;
      if (!row) return;
      const attemptId = id("attempt");
      this.db
        .query(
          "UPDATE outbound SET state='sending',attempts=attempts+1,attempt_id=? WHERE id=?",
        )
        .run(attemptId, row.id);
      this.db
        .query("INSERT INTO attempts(id,outbound_id,started_at) VALUES(?,?,?)")
        .run(attemptId, row.id, at);
      return {
        item: payload({ ...row, state: "sending", attempts: row.attempts + 1 }),
        attemptId,
        destination: { spaceId: row.space_id, lineId: row.line_id },
      };
    });
  }
  settleOutbound(
    outboundId: string,
    attemptId: string,
    outcome: ProviderOutcome,
  ): void {
    this.tx("settle_outbound", () => {
      const row = this.db
        .query(
          "SELECT o.*,p.space_id,p.line_id,p.purpose,p.action_key,p.task_id FROM outbound o JOIN operations p ON p.id=o.operation_id WHERE o.id=?",
        )
        .get(outboundId) as Row | null;
      if (!row || row.state !== "sending" || row.attempt_id !== attemptId)
        throw new Error("STALE_OUTBOUND_ATTEMPT");
      if (
        !["accepted", "unknown", "failed", "skipped", "retry_wait"].includes(
          outcome.state,
        )
      )
        throw new Error("OUTCOME_INVALID");
      if (
        outcome.state === "retry_wait" &&
        (!Number.isFinite(outcome.retryAfterMs) ||
          outcome.retryAfterMs < 0 ||
          outcome.retryAfterMs > 86400000)
      )
        throw new Error("RETRY_DELAY_INVALID");
      const reference = "reference" in outcome ? outcome.reference : undefined;
      if (reference?.messageId && typeof reference.messageId !== "string")
        throw new Error("PROVIDER_REFERENCE_INVALID");
      const at = now();
      this.db
        .query(
          "UPDATE outbound SET state=?,reference=?,code=?,next_at=?,settled_at=? WHERE id=?",
        )
        .run(
          outcome.state,
          reference ? canonical(reference) : null,
          "code" in outcome ? outcome.code : null,
          outcome.state === "retry_wait" ? at + outcome.retryAfterMs : 0,
          at,
          outboundId,
        );
      this.db
        .query("UPDATE attempts SET settled_at=?,outcome=? WHERE id=?")
        .run(at, canonical(outcome), attemptId);
      this.settleDerived(row, outboundId, outcome, reference, at);
    });
  }
  private settleDerived(
    row: Row,
    outboundId: string,
    outcome: { state: string; evidence?: string },
    reference: ProviderReference | undefined,
    at: number,
  ): void {
    const item = payload(row);
    if (reference?.messageId) {
      this.db
        .query("INSERT INTO targets VALUES(?,?,?) ON CONFLICT DO NOTHING")
        .run(row.space_id, row.line_id, reference.messageId);
      if (item.kind === "poll")
        this.setMetadata("poll", reference.messageId, {
          title: item.title,
          options: item.options,
          savedAt: new Date(at).toISOString(),
        });
      if (reference.miniAppCardSession)
        this.setMetadata("app-session", reference.messageId, {
          session: reference.miniAppCardSession,
          ...("url" in item ? { url: item.url, live: item.live } : {}),
          savedAt: new Date(at).toISOString(),
        });
      if (item.kind === "attachment_group" && reference.parts) {
        const record = {
          batchId: item.batchId ?? `outbound-${item.id}`,
          spaceId: row.space_id,
          lineId: row.line_id,
          messageId: reference.messageId,
          outboundId: outboundId,
          savedAt: new Date(at).toISOString(),
          parts: reference.parts,
        };
        this.setMetadata("presentation", record.batchId, record);
        this.setMetadata("presentation-index", reference.messageId, {
          batchId: record.batchId,
        });
      }
    }
    if (row.purpose === "onboarding") {
      const reservation = this.getMetadata<Row>("onboarding", "reservation")!;
      this.setMetadata("onboarding", "reservation", {
        ...reservation,
        state: outcome.state,
        reference,
        evidence: outcome.state === "accepted" ? outcome.evidence : undefined,
      });
    }
    const live = this.getMetadata<Row>("presentation-submission", outboundId);
    if (live)
      this.setMetadata("presentation-settlement", outboundId, {
        ...live,
        outboundId,
        state: "pending",
        deliveryState: outcome.state,
        reference,
      });
  }
  /** Offline operator resolution only: records external evidence, never dispatches. */
  reconcileOutbound(
    outboundId: string,
    input: {
      state: "accepted" | "cancelled";
      evidence: string;
      reference?: ProviderReference;
    },
  ): OutboundStatus {
    validateId(outboundId);
    if (
      !input ||
      !["accepted", "cancelled"].includes(input.state) ||
      typeof input.evidence !== "string" ||
      input.evidence.trim().length < 8 ||
      input.evidence.length > 4096
    )
      throw new Error("RECONCILIATION_EVIDENCE_REQUIRED");
    if (
      input.state === "accepted" &&
      (!input.reference ||
        typeof input.reference.messageId !== "string" ||
        !input.reference.messageId.trim())
    )
      throw new Error("EXACT_PROVIDER_REFERENCE_REQUIRED");
    return this.tx("reconcile_outbound", () => {
      const row = this.db
        .query(
          "SELECT o.*,p.space_id,p.line_id,p.purpose,p.action_key,p.task_id FROM outbound o JOIN operations p ON p.id=o.operation_id WHERE o.id=?",
        )
        .get(outboundId) as Row | null;
      if (!row || row.state !== "unknown")
        throw new Error("UNKNOWN_OUTBOUND_REQUIRED");
      const at = now();
      this.db
        .query(
          "UPDATE outbound SET state=?,reference=?,code='OPERATOR_RECONCILED',settled_at=? WHERE id=?",
        )
        .run(
          input.state,
          input.reference ? canonical(input.reference) : row.reference,
          at,
          outboundId,
        );
      this.setMetadata("outbound-reconciliation", outboundId, {
        ...input,
        at,
        priorCode: row.code,
        priorReference: row.reference ? JSON.parse(row.reference) : undefined,
      });
      this.settleDerived(row, outboundId, input, input.reference, at);
      return this.outboundStatus(outboundId)!;
    });
  }
  tasksForBatch(batchId: string): TaskBinding[] {
    this.batchDestination(batchId);
    return (this.db.query("SELECT DISTINCT t.id,t.updated_at FROM tasks t LEFT JOIN task_inputs i ON i.task_id=t.id WHERE t.batch_id=? OR i.batch_id=? ORDER BY t.updated_at,t.id").all(batchId, batchId) as Row[]).map(row => this.getTask(row.id)!);
  }
  /** Offline operator receipt recovery preserves the original task identity. */
  reconcileTask(
    taskId: string,
    input: { state: "accepted" | "completed"; receipt: string },
  ): TaskBinding {
    validateId(taskId, "task_id");
    if (
      !input ||
      !["accepted", "completed"].includes(input.state) ||
      typeof input.receipt !== "string" ||
      input.receipt.trim().length < 8 ||
      input.receipt.length > 4096
    )
      throw new Error("NATIVE_RECEIPT_REQUIRED");
    return this.tx("reconcile_task", () => {
      const binding = this.getTask(taskId);
      if (!binding || !["unknown", "accepted"].includes(binding.state))
        throw new Error("RECOVERABLE_TASK_REQUIRED");
      const currentInput = binding.inputs!.find(i => i.inputRevision === binding.currentInputRevision)!;
      if (!currentInput) throw new Error("TASK_CONTEXT_MISMATCH");
      if (binding.state === "accepted") {
        const claim = this.claimSnapshot(currentInput.batchId);
        if (
          !["claimed", "delegated"].includes(claim.state) ||
          claim.leaseUntil === null ||
          claim.leaseUntil > now()
        )
          throw new Error("EXPIRED_TASK_CLAIM_REQUIRED");
      }
      const updated = { ...binding, ...input };
      this.db
        .query("UPDATE tasks SET state=?,binding=?,updated_at=? WHERE id=?")
        .run(input.state, canonical(updated), now(), taskId);
      this.db.query("UPDATE task_inputs SET state=?,receipt=? WHERE task_id=? AND input_revision=?").run(input.state, input.receipt, taskId, binding.currentInputRevision!);
      this.setMetadata("task-reconciliation", taskId, {
        ...input,
        at: now(),
        prior: binding,
      });
      this.db
        .query(
          "UPDATE batches SET state='pending',run_id=NULL,lease_until=NULL,generation=generation+1 WHERE id=?",
        )
        .run(currentInput.batchId);
      this.db
        .query("UPDATE wakes SET state='pending',next_at=0 WHERE batch_id=?")
        .run(currentInput.batchId);
      return this.getTask(taskId)!;
    });
  }

  recoverSending(): number {
    return this.tx("recover_sending", () => {
      const rows = this.db
        .query(
          "SELECT o.*,p.space_id,p.line_id,p.purpose FROM outbound o JOIN operations p ON p.id=o.operation_id WHERE o.state='sending'",
        )
        .all() as Row[];
      for (const row of rows) {
        this.db
          .query(
            "UPDATE outbound SET state='unknown',code='PROCESS_INTERRUPTED',settled_at=? WHERE id=?",
          )
          .run(now(), row.id);
        this.db
          .query("UPDATE attempts SET settled_at=?,outcome=? WHERE id=?")
          .run(
            now(),
            canonical({ state: "unknown", code: "PROCESS_INTERRUPTED" }),
            row.attempt_id,
          );
        this.settleDerived(
          row,
          row.id,
          { state: "unknown" },
          row.reference ? JSON.parse(row.reference) : undefined,
          now(),
        );
      }
      return rows.length;
    });
  }
  outboundStatus(outboundId: string): OutboundStatus | undefined {
    validateId(outboundId);
    const row = this.db
      .query("SELECT id,state,attempts,reference,code FROM outbound WHERE id=?")
      .get(outboundId) as Row | null;
    return row
      ? {
          id: row.id,
          state: row.state,
          attempts: row.attempts,
          ...(row.reference ? { reference: JSON.parse(row.reference) } : {}),
          ...(row.code ? { code: row.code } : {}),
        }
      : undefined;
  }
  claimWake(at = now(), excludedBatchIds: string[] = []): WakeJob | undefined {
    if (!Number.isFinite(at)) throw new Error("WAKE_TIME_INVALID");
    if (!Array.isArray(excludedBatchIds) || excludedBatchIds.length > 32)
      throw new Error("WAKE_EXCLUSIONS_INVALID");
    excludedBatchIds.forEach((batchId) => validateId(batchId, "batch_id"));
    const excluded = [...new Set(excludedBatchIds)];
    const exclusion = excluded.length
      ? ` AND w.batch_id NOT IN (${excluded.map(() => "?").join(",")})`
      : "";
    return this.tx("claim_wake", () => {
      // A dead processing invocation may be re-notified, but recovering a
      // lease must never authorize a second native handoff or final send.
      const expired = this.db
        .query(
          `
        SELECT b.id FROM batches b
        WHERE b.state='claimed' AND b.lease_until<=?
          AND NOT EXISTS (
            SELECT 1 FROM tasks t WHERE t.batch_id=b.id AND b.input_revision<=COALESCE(b.claimed_revision,0)
              AND t.state IN ('intent','accepted','unknown')
          )
          AND NOT EXISTS (
            SELECT 1 FROM operations op JOIN outbound o ON o.operation_id=op.id
            WHERE op.batch_id=b.id AND op.input_revision=b.input_revision AND op.purpose='final'
              AND o.state IN (${unresolved})
          )
        ORDER BY b.lease_until,b.id LIMIT 100
      `,
        )
        .all(at) as Row[];
      for (const batch of expired) {
        this.db
          .query(
            "UPDATE batches SET state='pending',run_id=NULL,lease_until=NULL,generation=generation+1 WHERE id=?",
          )
          .run(batch.id);
        this.db
          .query(
            "UPDATE wakes SET state='pending',next_at=?,attempt_id=NULL,lease_until=NULL,code='PROCESSING_LEASE_EXPIRED' WHERE batch_id=?",
          )
          .run(at, batch.id);
      }
      const row = this.db
        .query(
          `SELECT w.* FROM wakes w JOIN batches b ON b.id=w.batch_id WHERE w.state IN ('pending','retry_wait','acknowledged') AND w.next_at<=? AND b.state='pending'${exclusion} ORDER BY b.formed_at LIMIT 1`,
        )
        .get(at, ...excluded) as Row | null;
      if (!row) return;
      const attemptId = id("wake");
      this.db
        .query(
          "UPDATE wakes SET state='sending',attempts=attempts+1,attempt_id=?,lease_until=? WHERE batch_id=?",
        )
        .run(attemptId, at + 30000, row.batch_id);
      return { batchId: row.batch_id, attemptId, attempts: row.attempts + 1 };
    });
  }
  settleWake(
    job: WakeJob,
    result: {
      state: "acknowledged" | "retry_wait" | "failed";
      code?: string;
      retryAfterMs?: number;
    },
  ): void {
    this.tx("settle_wake", () => {
      if (!["acknowledged", "retry_wait", "failed"].includes(result.state))
        throw new Error("WAKE_RESULT_INVALID");
      const changed = this.db
        .query(
          "UPDATE wakes SET state=?,code=?,next_at=?,lease_until=NULL WHERE batch_id=? AND state='sending' AND attempt_id=?",
        )
        .run(
          result.state,
          result.code ?? null,
          now() +
            (result.retryAfterMs ??
              (result.state === "acknowledged" ? 60000 : 0)),
          job.batchId,
          job.attemptId,
        ).changes;
      if (!changed) throw new Error("STALE_WAKE_ATTEMPT");
    });
  }
  private mediaRow(row: Row): MediaJob {
    const reference = JSON.parse(row.reference);
    if (
      !reference.messageId ||
      !reference.spaceId ||
      !reference.lineId ||
      !["voice", "attachment"].includes(reference.kind)
    )
      throw new Error("MEDIA_RECORD_INVALID");
    return {
      id: row.id,
      eventId: row.event_id,
      reference,
      state: row.state,
      attempts: row.attempts,
    };
  }
  claimMedia(): MediaJob | undefined {
    return this.tx("claim_media", () => {
      const row = this.db
        .query(
          "SELECT * FROM media_jobs WHERE state='pending' ORDER BY rowid LIMIT 1",
        )
        .get() as Row | null;
      if (!row) return;
      this.db
        .query(
          "UPDATE media_jobs SET state='processing',attempts=attempts+1 WHERE id=?",
        )
        .run(row.id);
      return this.mediaRow({
        ...row,
        state: "processing",
        attempts: row.attempts + 1,
      });
    });
  }
  settleMedia(jobId: string, result: MediaResult, attempt: number): void {
    this.tx("settle_media", () => {
      const row = this.db
        .query(
          "SELECT m.*,i.record FROM media_jobs m JOIN inbox i ON i.id=m.event_id WHERE m.id=?",
        )
        .get(jobId) as Row | null;
      if (!row || row.attempts !== attempt) throw new Error("MEDIA_JOB_NOT_PROCESSING");
      const digest = hash(result);
      if (["ready", "failed", "unavailable"].includes(row.state)) {
        if (row.result_hash !== digest) throw new Error("MEDIA_RESULT_CONFLICT");
        return;
      }
      if (row.state !== "processing") throw new Error("MEDIA_JOB_NOT_PROCESSING");
      if (!["ready", "failed", "unavailable"].includes(result.state))
        throw new Error("MEDIA_RESULT_INVALID");
      const reference = this.mediaRow(row).reference;
      const original = parseRecord(row.record);
      const patch = result.patch ?? {};
      if (result.patch) {
        const allowed = new Set([
          "text",
          "attachmentPath",
          "attachmentId",
          "attachmentName",
          "attachmentMimeType",
          "attachmentBytes",
          "attachmentOriginalPath",
          "attachmentOriginalMimeType",
          "attachmentDuration",
          "transcript",
          "kind",
          "mediaState",
          "mediaJobId",
          "mediaError",
        ]);
        if (Object.keys(result.patch).some((key) => !allowed.has(key)))
          throw new Error("MEDIA_IDENTITY_PATCH_FORBIDDEN");
        if (
          (patch.kind !== undefined && patch.kind !== reference.kind) ||
          (patch.mediaJobId !== undefined && patch.mediaJobId !== row.id) ||
          (patch.mediaState !== undefined && patch.mediaState !== result.state)
        )
          throw new Error("MEDIA_IDENTITY_PATCH_FORBIDDEN");
      }
      const mediaError =
        result.state === "ready" ? patch.mediaError : result.code;
      if (
        mediaError !== undefined &&
        (typeof mediaError !== "string" ||
          !/^[A-Za-z0-9_.:-]{1,128}$/.test(mediaError))
      )
        throw new Error("MEDIA_ERROR_INVALID");
      const updated: InboundRecord = {
        ...original,
        ...patch,
        kind: reference.kind,
        mediaJobId: row.id,
        mediaState: result.state,
        mediaError,
      };
      if (result.state !== "ready" && patch.text === undefined) {
        const explanation = `[${reference.kind} ${result.state}; ask for a resend or text]`;
        updated.text = original.text.startsWith(`[${reference.kind} pending]`)
          ? explanation
          : `${original.text}\n${explanation}`.trim();
      }
      validateRecord(updated);
      this.db
        .query("UPDATE inbox SET record=? WHERE id=?")
        .run(canonical(updated), row.event_id);
      this.db
        .query("UPDATE media_jobs SET state=?,code=?,result_hash=? WHERE id=?")
        .run(result.state, "code" in result ? result.code : null, digest, jobId);
      const membership = this.db.query("SELECT batch_id FROM batch_events WHERE event_id=?").get(row.event_id) as Row | null;
      if (membership) this.appendRevision(membership.batch_id, `media_${result.state}`, `media:${jobId}`, {
        sources: [{eventId: row.event_id, messageId: reference.messageId, mediaJobId: jobId}],
      });
    });
  }
  dispatchContinuations(): number {
    return this.tx("dispatch_continuations", () => {
      const rows = this.db.query("SELECT id FROM batches WHERE input_revision>1 AND input_revision>acknowledged_revision AND input_revision>COALESCE(claimed_revision,0) AND state IN ('completed','delegated','review')").all() as Row[];
      for (const row of rows) {
        this.db.query("UPDATE batches SET state='pending',run_id=NULL,lease_until=NULL,completed_at=NULL WHERE id=?").run(row.id);
        this.resetWake(row.id);
      }
      return rows.length;
    });
  }
  recoverWork() {
    return this.tx("recover_work", () => {
      const media = this.db
        .query(
          "UPDATE media_jobs SET state='pending',attempts=attempts+1 WHERE state='processing'",
        )
        .run().changes;
      const wakes = this.db
        .query(
          "UPDATE wakes SET state='retry_wait',next_at=0 WHERE state='sending'",
        )
        .run().changes;
      const rows = this.db
        .query("SELECT id,binding FROM tasks WHERE state='intent'")
        .all() as Row[];
      for (const row of rows) {
        this.db
          .query("UPDATE tasks SET state='unknown',binding=? WHERE id=?")
          .run(
            canonical({ ...JSON.parse(row.binding), state: "unknown" }),
            row.id,
          );
      }
      this.db.query("UPDATE task_inputs SET state='unknown' WHERE state='intent'").run();
      // Repair wake eligibility from durable revision state. Never accept again.
      this.dispatchContinuations();
      return { media, wakes, tasks: rows.length };
    });
  }
  knownTarget(destination: Destination, messageId: string): boolean {
    validateDestination(destination);
    return !!this.db
      .query(
        "SELECT 1 FROM targets WHERE space_id=? AND line_id=? AND message_id=?",
      )
      .get(destination.spaceId, destination.lineId, messageId);
  }
  activeConversationWork(): Destination[] {
    return (
      this.db
        .query(
          `SELECT DISTINCT b.space_id,b.line_id FROM batches b WHERE b.state IN ('claimed','delegated') AND b.lease_until>? AND NOT EXISTS (SELECT 1 FROM operations op JOIN outbound o ON o.operation_id=op.id WHERE op.batch_id=b.id AND op.purpose='final' AND o.state IN ('accepted','failed','cancelled','skipped','unknown'))`,
        )
        .all(now()) as Row[]
    ).map((row) => ({ spaceId: row.space_id, lineId: row.line_id }));
  }
  recentInbound(limit = 20, destination?: Destination): InboundRecord[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error("LIMIT_INVALID");
    const rows = destination
      ? this.db
          .query(
            "SELECT record FROM inbox WHERE space_id=? AND line_id=? ORDER BY seq DESC LIMIT ?",
          )
          .all(destination.spaceId, destination.lineId, limit)
      : this.db
          .query("SELECT record FROM inbox ORDER BY seq DESC LIMIT ?")
          .all(limit);
    return (rows as Row[]).map((row) => parseRecord(row.record));
  }
  listOutbound(limit = 1000): OutboundItem[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 10000)
      throw new Error("LIMIT_INVALID");
    return (
      this.db
        .query("SELECT * FROM outbound ORDER BY seq DESC LIMIT ?")
        .all(limit) as Row[]
    ).map(payload);
  }
  acknowledgePrunedArtifacts(paths: string[]): void {
    this.tx("prune_ack", () => {
      for (const path of paths)
        this.db
          .query(
            "DELETE FROM metadata WHERE kind='retention-cleanup' AND key=?",
          )
          .run(path);
    });
  }
  privacySnapshot(at = now()) {
    const count = (sql: string) => Number((this.db.query(sql).get() as Row).n);
    const plan = this.pruneResolvedBefore({
      resolvedBefore: at - 30 * 86400000,
      intermediateBefore: at - 7 * 86400000,
    });
    return {
      events: count("SELECT count(*) n FROM inbox"),
      outbound: count("SELECT count(*) n FROM outbound"),
      unresolved:
        count(
          `SELECT count(*) n FROM outbound WHERE state IN (${unresolved})`,
        ) + count("SELECT count(*) n FROM batches WHERE state!='completed'"),
      prunableEvents: plan.events,
      prunableOutbound: plan.outbound,
    };
  }
  pruneResolvedBefore(options: {
    resolvedBefore: number;
    intermediateBefore: number;
    intermediatePaths?: Array<{ path: string; createdAt: number }>;
    apply?: boolean;
  }) {
    if (
      !Number.isFinite(options.resolvedBefore) ||
      !Number.isFinite(options.intermediateBefore)
    )
      throw new Error("RETENTION_CUTOFF_INVALID");
    return this.tx("prune", () => {
      const blocked = `b.input_revision=b.acknowledged_revision AND NOT EXISTS (SELECT 1 FROM media_jobs m JOIN batch_events mb ON mb.event_id=m.event_id WHERE mb.batch_id=b.id AND m.state IN ('pending','processing')) AND NOT EXISTS (SELECT 1 FROM operations op JOIN outbound u ON u.operation_id=op.id WHERE op.batch_id=b.id AND u.state IN (${unresolved})) AND NOT EXISTS (SELECT 1 FROM tasks t LEFT JOIN task_inputs ti ON ti.task_id=t.id WHERE (t.batch_id=b.id OR ti.batch_id=b.id) AND (t.state!='completed' OR EXISTS (SELECT 1 FROM task_inputs ri JOIN batches rb ON rb.id=ri.batch_id WHERE ri.task_id=t.id AND rb.input_revision>rb.acknowledged_revision)))`;
      const events = this.db
        .query(
          `SELECT i.id,i.record FROM inbox i JOIN batch_events be ON be.event_id=i.id JOIN batches b ON b.id=be.batch_id WHERE i.redacted=0 AND b.state='completed' AND b.completed_at<? AND ${blocked}`,
        )
        .all(options.resolvedBefore) as Row[];
      const outs = this.db
        .query(
          `SELECT o.* FROM outbound o JOIN operations op ON op.id=o.operation_id LEFT JOIN batches b ON b.id=op.batch_id WHERE o.redacted=0 AND o.state IN (${terminal}) AND o.settled_at<? AND (op.batch_id IS NULL OR (b.state='completed' AND ${blocked}))`,
        )
        .all(options.resolvedBefore) as Row[];
      const intermediateRows = this.db
        .query(
          "SELECT key,value FROM metadata WHERE kind='intermediate-artifact'",
        )
        .all() as Row[];
      const eligibleIntermediates = intermediateRows
        .map((row) => ({ key: row.key, ...JSON.parse(row.value) }))
        .filter(
          (row) =>
            row.state === "unused" &&
            typeof row.path === "string" &&
            Number.isFinite(row.createdAt) &&
            row.createdAt < options.intermediateBefore,
        );
      const mediaActive = !!this.db
        .query(
          "SELECT id FROM media_jobs WHERE state IN ('pending','processing') LIMIT 1",
        )
        .get();
      if (!mediaActive)
        for (const row of options.intermediatePaths ?? [])
          if (
            typeof row.path === "string" &&
            Number.isFinite(row.createdAt) &&
            row.createdAt < options.intermediateBefore
          )
            eligibleIntermediates.push({
              key: "",
              path: row.path,
              createdAt: row.createdAt,
              state: "unused",
            });
      const candidates = new Set<string>(
        (
          this.db
            .query("SELECT key FROM metadata WHERE kind='retention-cleanup'")
            .all() as Row[]
        ).map((row) => row.key),
      );
      const gather = (record: Row) => {
        for (const key of [
          "attachmentPath",
          "attachmentOriginalPath",
          "audioPath",
        ])
          if (typeof record[key] === "string") candidates.add(record[key]);
        for (const path of record.attachmentPaths ?? [])
          if (typeof path === "string") candidates.add(path);
      };
      events.forEach((row) => gather(JSON.parse(row.record)));
      outs.forEach((row) => gather(JSON.parse(row.item)));
      for (const artifact of eligibleIntermediates)
        candidates.add(artifact.path);
      const deletingEvents = new Set(events.map((r) => r.id));
      const deletingOuts = new Set(outs.map((r) => r.id));
      const protect = (record: Row) => {
        for (const key of [
          "attachmentPath",
          "attachmentOriginalPath",
          "audioPath",
        ])
          if (typeof record[key] === "string") candidates.delete(record[key]);
        for (const path of record.attachmentPaths ?? [])
          if (typeof path === "string") candidates.delete(path);
      };
      for (const row of this.db
        .query("SELECT id,record FROM inbox WHERE redacted=0")
        .all() as Row[])
        if (!deletingEvents.has(row.id)) protect(JSON.parse(row.record));
      for (const row of this.db
        .query("SELECT id,item FROM outbound WHERE redacted=0")
        .all() as Row[])
        if (!deletingOuts.has(row.id)) protect(JSON.parse(row.item));
      // Results may carry registered assets whose original message is older.
      // Protect the full structured value while its continuation remains active.
      for (const row of this.db.query("SELECT r.value FROM task_results r JOIN task_inputs i ON i.task_id=r.task_id AND i.input_revision=r.input_revision JOIN batches b ON b.id=i.batch_id WHERE b.state!='completed' OR b.input_revision>b.acknowledged_revision").all() as Row[])
        for (const path of [...candidates]) if (row.value.includes(JSON.stringify(path).slice(1,-1))) candidates.delete(path);
      // Presentation/session metadata still needed for edits and reaction resolution protects originals.
      for (const row of this.db
        .query(
          "SELECT value FROM metadata WHERE kind NOT IN ('retention-cleanup','intermediate-artifact')",
        )
        .all() as Row[])
        for (const path of [...candidates])
          if (row.value.includes(JSON.stringify(path).slice(1, -1)))
            candidates.delete(path);
      if (options.apply) {
        for (const artifact of eligibleIntermediates)
          if (candidates.has(artifact.path))
            this.db
              .query(
                "DELETE FROM metadata WHERE kind='intermediate-artifact' AND key=?",
              )
              .run(artifact.key);
        for (const path of candidates)
          this.setMetadata("retention-cleanup", path, { selectedAt: now() });
        for (const row of events) {
          const r = parseRecord(row.record);
          this.db.query("UPDATE inbox SET record=?,redacted=1 WHERE id=?").run(
            canonical({
              id: r.id,
              spaceId: r.spaceId,
              senderId: "",
              text: "[retained identity; content removed]",
              timestamp: r.timestamp,
              receivedAt: r.receivedAt,
            }),
            row.id,
          );
        }
        // Snapshot bodies must honor the same deletion as the canonical inbox.
        for (const row of this.db.query("SELECT batch_id,revision,snapshot FROM batch_revisions").all() as Row[]) {
          const snapshot = JSON.parse(row.snapshot);
          let changed = false;
          snapshot.messages = (snapshot.messages ?? []).map((message: InboundRecord) => {
            const member = this.db.query("SELECT i.id FROM inbox i JOIN batch_events be ON be.event_id=i.id WHERE be.batch_id=? AND i.provider_id=?").get(row.batch_id, message.id) as Row | null;
            if (!member || !deletingEvents.has(member.id)) return message;
            changed = true;
            return {id: message.id, spaceId: message.spaceId, senderId: "", text: "[retained identity; content removed]", timestamp: message.timestamp, receivedAt: message.receivedAt};
          });
          if (changed) { delete snapshot.media; this.db.query("UPDATE batch_revisions SET snapshot=? WHERE batch_id=? AND revision=?").run(canonical(snapshot), row.batch_id, row.revision); }
        }
        for (const row of this.db.query(`SELECT r.id,r.value FROM task_results r JOIN task_inputs ti ON ti.task_id=r.task_id AND ti.input_revision=r.input_revision JOIN batches b ON b.id=ti.batch_id WHERE b.state='completed' AND b.completed_at<? AND ${blocked}`).all(options.resolvedBefore) as Row[]) {
          const result = JSON.parse(row.value);
          this.db.query("UPDATE task_results SET value=? WHERE id=?").run(canonical({...result, result: {redacted:true}}), row.id);
        }
        for (const row of outs) {
          const item = JSON.parse(row.item);
          this.db.query("UPDATE outbound SET item=?,redacted=1 WHERE id=?").run(
            canonical({
              id: item.id,
              spaceId: item.spaceId,
              kind: "text",
              text: "[content removed]",
              createdAt: item.createdAt,
              status: row.state,
              attempts: row.attempts,
            }),
            row.id,
          );
        }
      }
      return {
        events: events.length,
        outbound: outs.length,
        artifactPaths: [...candidates],
      };
    });
  }
}
export function openStore(options: StoreOptions = {}): SqliteBridgeStore {
  return new SqliteBridgeStore(options);
}
let singleton: SqliteBridgeStore | undefined;
export function getStore(): SqliteBridgeStore {
  return (singleton ??= openStore());
}
export function newId(kind: "b" | "o") {
  return id(kind);
}
export async function readUnreadBatch(batchId: string) {
  return getStore().readBatch(batchId);
}
export async function loadOutboundQueue() {
  return getStore().listOutbound();
}
export async function loadPollMeta(messageId: string) {
  return getStore().getMetadata<{ title: string; options: string[] }>(
    "poll",
    messageId,
  );
}
export async function savePollMeta(
  messageId: string,
  title: string,
  options: string[],
) {
  getStore().setMetadata("poll", messageId, {
    title,
    options,
    savedAt: new Date().toISOString(),
  });
}
export type AppCardSession = {
  chatGuid: string;
  messageGuid: string;
  sessionId: string;
  targetMessageGuid: string;
};
export async function loadAppCardSession(messageId: string) {
  return getStore().getMetadata<{ session: AppCardSession }>(
    "app-session",
    messageId,
  )?.session;
}
export async function saveAppCardSession(
  messageId: string,
  session: AppCardSession,
  meta?: { live?: boolean; url?: string },
) {
  getStore().setMetadata("app-session", messageId, {
    session,
    ...meta,
    savedAt: new Date().toISOString(),
  });
}
/** Legacy callers must supply the same fenced context as new callers. */
export async function enqueueOutbound(
  input: EnqueueOutboundInput,
  context?: Parameters<SqliteBridgeStore["enqueue"]>[1],
) {
  if (!context) throw new Error("FENCED_ENQUEUE_REQUIRED");
  return getStore().enqueue(input, context);
}
