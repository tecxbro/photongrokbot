import { randomUUID, createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fsyncSync,
  openSync,
  writeFileSync,
} from "node:fs";
import { resolveInstancePaths } from "../../shared/instance-paths.mjs";
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
  TaskBinding,
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
    try {
      writeFileSync(fd, this.db.serialize());
      fsyncSync(fd);
    } finally {
      closeSync(fd);
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
  ): Array<{ key: string; value: T }> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
      throw new Error("LIMIT_INVALID");
    return (
      this.db
        .query(
          "SELECT key,value FROM metadata WHERE kind=? ORDER BY key LIMIT ?",
        )
        .all(kind, limit) as Row[]
    ).map((row) => ({ key: row.key, value: JSON.parse(row.value) }));
  }
  operationStatus(
    destination: Destination,
    purpose: string,
    actionKey: string,
  ): OutboundStatus[] {
    validateDestination(destination);
    return (
      this.db
        .query(
          "SELECT o.id FROM outbound o JOIN operations p ON p.id=o.operation_id WHERE p.space_id=? AND p.line_id=? AND p.purpose=? AND p.action_key=? ORDER BY o.ordinal",
        )
        .all(
          destination.spaceId,
          destination.lineId,
          purpose,
          actionKey,
        ) as Row[]
    ).map((row) => this.outboundStatus(row.id)!);
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
  readBatch(batchId: string): UnreadBatch {
    const destination = this.batchDestination(batchId);
    const row = this.db
      .query("SELECT formed_at FROM batches WHERE id=?")
      .get(batchId) as Row;
    const messages = (
      this.db
        .query(
          "SELECT i.record FROM batch_events b JOIN inbox i ON i.id=b.event_id WHERE b.batch_id=? ORDER BY b.ordinal",
        )
        .all(batchId) as Row[]
    ).map((r) => parseRecord(r.record));
    const media = (
      this.db
        .query(
          "SELECT m.* FROM media_jobs m JOIN batch_events b ON b.event_id=m.event_id WHERE b.batch_id=? ORDER BY b.ordinal",
        )
        .all(batchId) as Row[]
    ).map((r) => this.mediaRow(r));
    return {
      batchId,
      flushedAt: new Date(row.formed_at).toISOString(),
      messages,
      destination,
      media,
      tasks: this.tasksForBatch(batchId),
    } as UnreadBatch;
  }
  claimSnapshot(batchId: string): ClaimSnapshot {
    validateId(batchId, "batch_id");
    const row = this.db
      .query(
        "SELECT state,run_id AS runId,generation,lease_until AS leaseUntil FROM batches WHERE id=?",
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
          "UPDATE batches SET state='claimed',run_id=?,generation=?,lease_until=? WHERE id=?",
        )
        .run(token.runId, token.generation, at + leaseMs, batchId);
      return { status: "acquired", token, leaseUntil: at + leaseMs };
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
  completeClaim(token: ClaimToken): void {
    this.tx("complete_claim", () => {
      this.assertClaim(token);
      const unresolvedTask = this.db
        .query(
          "SELECT id FROM tasks WHERE batch_id=? AND state IN ('intent','unknown','accepted') LIMIT 1",
        )
        .get(token.batchId);
      if (unresolvedTask) throw new Error("TASK_UNRESOLVED");
      this.db
        .query("UPDATE batches SET state='completed',completed_at=? WHERE id=?")
        .run(now(), token.batchId);
    });
  }
  bindTask(token: ClaimToken, binding: TaskBinding): void {
    validateId(binding.taskId, "task_id");
    validateDestination(binding.destination);
    if (
      !binding.owner ||
      !binding.finalOwner ||
      binding.batchId !== token.batchId ||
      !["intent", "accepted", "unknown", "completed"].includes(binding.state)
    )
      throw new Error("TASK_BINDING_INVALID");
    this.tx("bind_task", () => {
      this.assertClaim(token);
      const destination = this.batchDestination(token.batchId);
      if (canonical(destination) !== canonical(binding.destination))
        throw new Error("TASK_DESTINATION_MISMATCH");
      const existing = this.getTask(binding.taskId);
      if (existing) {
        if (
          existing.batchId !== binding.batchId ||
          canonical(existing.destination) !== canonical(binding.destination) ||
          existing.owner !== binding.owner ||
          existing.finalOwner !== binding.finalOwner
        )
          throw new Error("TASK_ID_CONFLICT");
        if (
          existing.state !== binding.state &&
          !(
            existing.state === "intent" &&
            ["accepted", "unknown"].includes(binding.state)
          ) &&
          !(existing.state === "accepted" && binding.state === "completed") &&
          !(
            existing.state === "unknown" &&
            binding.state === "accepted" &&
            binding.receipt
          )
        )
          throw new Error("TASK_TRANSITION_INVALID");
      } else {
        if (binding.state !== "intent") throw new Error("TASK_INTENT_REQUIRED");
        if (
          this.db
            .query(
              "SELECT id FROM tasks WHERE batch_id=? AND state!='completed' LIMIT 1",
            )
            .get(binding.batchId)
        )
          throw new Error("HANDOFF_ALREADY_RESERVED");
      }
      if (["accepted", "completed"].includes(binding.state) && !binding.receipt)
        throw new Error("TASK_RECEIPT_REQUIRED");
      this.db
        .query(
          "INSERT INTO tasks(id,batch_id,binding,state,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET binding=excluded.binding,state=excluded.state,updated_at=excluded.updated_at",
        )
        .run(
          binding.taskId,
          binding.batchId,
          canonical(binding),
          binding.state,
          now(),
        );
      this.db
        .query("UPDATE batches SET state=? WHERE id=?")
        .run(
          binding.state === "completed" ? "claimed" : "delegated",
          binding.batchId,
        );
    });
  }
  getTask(taskId: string): TaskBinding | undefined {
    const row = this.db
      .query("SELECT binding FROM tasks WHERE id=?")
      .get(taskId) as Row | null;
    if (!row) return;
    const value = JSON.parse(row.binding);
    if (value.taskId !== taskId || !value.destination)
      throw new Error("TASK_RECORD_INVALID");
    return value;
  }
  enqueue(
    input: EnqueueOutboundInput,
    context: {
      actionKey: string;
      destination: Destination;
      purpose: string;
      claim?: ClaimToken;
      taskId?: string;
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
    if (context.purpose === "control" && input.kind !== "typing")
      throw new Error("CONTROL_TYPING_ONLY");
    const prepared = buildOutboundItems(input);
    return this.tx("enqueue", () => {
      this.assertClaim(context.claim!);
      if (
        canonical(this.batchDestination(context.claim!.batchId)) !==
        canonical(context.destination)
      )
        throw new Error("BATCH_DESTINATION_MISMATCH");
      if (context.taskId) {
        const task = this.getTask(context.taskId);
        if (
          !task ||
          task.batchId !== context.claim!.batchId ||
          !["accepted", "completed"].includes(task.state)
        )
          throw new Error("TASK_NOT_ACCEPTED");
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
      taskId?: string;
    },
    prepared = buildOutboundItems(input),
  ): OutboundItem[] {
    const digest = hash(input);
    const prior = this.db
      .query(
        "SELECT id,payload_hash FROM operations WHERE space_id=? AND line_id=? AND purpose=? AND action_key=?",
      )
      .get(
        context.destination.spaceId,
        context.destination.lineId,
        context.purpose,
        context.actionKey,
      ) as Row | null;
    if (prior) {
      if (prior.payload_hash !== digest)
        throw new Error("ACTION_PAYLOAD_CONFLICT");
      return (
        this.db
          .query("SELECT * FROM outbound WHERE operation_id=? ORDER BY ordinal")
          .all(prior.id) as Row[]
      ).map(payload);
    }
    const operationId = id("op");
    this.db
      .query("INSERT INTO operations VALUES(?,?,?,?,?,?,?,?,?)")
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
      );
    prepared.forEach((item, index) => {
      this.db
        .query(
          "INSERT INTO outbound(id,operation_id,ordinal,item,state) VALUES(?,?,?,?, 'queued')",
        )
        .run(item.id, operationId, index, canonical(item));
      this.fault?.("enqueue:child");
    });
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
    return (
      this.db
        .query(
          "SELECT binding FROM tasks WHERE batch_id=? ORDER BY updated_at,id",
        )
        .all(batchId) as Row[]
    ).map((row) => JSON.parse(row.binding));
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
      if (!binding || binding.state !== "unknown")
        throw new Error("UNKNOWN_TASK_REQUIRED");
      const updated = { ...binding, ...input };
      this.db
        .query("UPDATE tasks SET state=?,binding=?,updated_at=? WHERE id=?")
        .run(input.state, canonical(updated), now(), taskId);
      this.setMetadata("task-reconciliation", taskId, {
        ...input,
        at: now(),
        prior: binding,
      });
      this.db
        .query(
          "UPDATE batches SET state='pending',run_id=NULL,lease_until=NULL,generation=generation+1 WHERE id=?",
        )
        .run(binding.batchId);
      this.db
        .query("UPDATE wakes SET state='pending',next_at=0 WHERE batch_id=?")
        .run(binding.batchId);
      return updated;
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
  claimWake(at = now()): WakeJob | undefined {
    return this.tx("claim_wake", () => {
      const row = this.db
        .query(
          "SELECT w.* FROM wakes w JOIN batches b ON b.id=w.batch_id WHERE w.state IN ('pending','retry_wait','acknowledged') AND w.next_at<=? AND b.state='pending' ORDER BY b.formed_at LIMIT 1",
        )
        .get(at) as Row | null;
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
      if (!row || row.state !== "processing" || row.attempts !== attempt)
        throw new Error("MEDIA_JOB_NOT_PROCESSING");
      if (!["ready", "failed", "unavailable"].includes(result.state))
        throw new Error("MEDIA_RESULT_INVALID");
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
          "mediaState",
          "mediaCode",
        ]);
        if (Object.keys(result.patch).some((key) => !allowed.has(key)))
          throw new Error("MEDIA_IDENTITY_PATCH_FORBIDDEN");
        const updated = { ...parseRecord(row.record), ...result.patch };
        validateRecord(updated);
        this.db
          .query("UPDATE inbox SET record=? WHERE id=?")
          .run(canonical(updated), row.event_id);
      }
      this.db
        .query("UPDATE media_jobs SET state=?,code=? WHERE id=?")
        .run(result.state, "code" in result ? result.code : null, jobId);
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
      const blocked = `NOT EXISTS (SELECT 1 FROM operations op JOIN outbound u ON u.operation_id=op.id WHERE op.batch_id=b.id AND u.state IN (${unresolved})) AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.batch_id=b.id AND t.state!='completed')`;
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
