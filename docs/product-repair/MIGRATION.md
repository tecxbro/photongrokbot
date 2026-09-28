# Migration and recovery

This is an offline operator procedure. It does not authorize touching a live VM. Use the coordinator's [deployment/rollback runbook](DEPLOYMENT_ROLLBACK.md) for the actual release boundary. Preserve the old source and all private identity/configuration; never start the old writer after import.

1. Record the exact old checkout, original state path and serving line. Inspect only necessary metadata; do not print secrets or private message bodies.
2. Stop every old writer using its verified process/service identity. Confirm it is stopped. A stale PID file is not sufficient evidence either way. The new runtime must also be stopped for apply.
3. Select a new private persistent `PHOTON_INSTANCE_DIR` outside the old source and code checkout. Run explicit authorized bootstrap and initialize storage only for a genuinely new instance. An interrupted first database creation resumes only its persisted initial intent, preserving installation identity; nonempty unversioned or corrupt files are rejected. Once database status is ready, missing state fails closed; do not reinitialize to clear it.
4. Dry-run the legacy inventory and inspect counts/issues. It does not modify source or target. Malformed, unreadable or contradictory evidence must be repaired/reconciled deliberately, never treated as empty.

From bridge/:

```sh
bun run setup-state -- init --authorized
bun run setup-state -- initialize-storage
bun run migrate -- --source "$LEGACY_DATA_DIR" --line-id "$ORIGINAL_LINE_ID"
```

Only after verified stopped writers and reviewed dry-run:

```sh
python3 tools/with-instance-lock.py "$PHOTON_INSTANCE_DIR/runtime.lock" bun run migrate -- --source "$LEGACY_DATA_DIR" --line-id "$ORIGINAL_LINE_ID" --apply --writers-stopped
```

The explicit stopped-writers attestation is not a substitute for checking. The import hashes the immutable source, keeps a private backup, copies referenced media into a private archive, imports related state in one transaction and writes a cutover marker. Repeating the same source is idempotent; changed/conflicting source is rejected for reconciliation. Never remove the cutover marker to restart legacy queues.

Legacy queued sends are unknown/review-needed, not fresh retryable work. Old accepted references, poll metadata, full app sessions, option maps, task context and original conversation/line remain evidence. Legacy celebration suppresses duplicate confetti without being called a physical-device observation. Existing ambiguous task handoffs remain held.

## Reconcile uncertainty

Stop dispatch before operator reconciliation and hold the instance lock. Inspect actual provider/native evidence for the exact operation. Preserve action key, task ID, destination, card identity and provider references. `bun run batch -- recover-delegation --json-stdin` takes `{taskId,state,receipt}` for explicit native-task evidence; state is accepted or completed, backed by the exact recorded receipt. An accepted worker can be recovered only after its original claim expires; an active accepted worker is rejected. The same task/batch/destination remain bound, the stale generation is fenced and a wake schedules reconciliation. No native call is repeated. Outbound provider reconciliation is available through the actual recovery command documented in the deployment runbook; do not invent a resend flag or edit SQLite manually.

A successful local queue write proves only acceptance into local state. Provider acceptance with a missing local acknowledgement requires settlement of the same attempt. Missing device observation does not prove non-delivery. Unknown initial task-card presentation retains its slot and original URL until reconciled.

## Rollback

Code rollback must retain the canonical private instance and compatible schema. Keep dispatch stopped if the older code cannot read it. Restore a consistent verified backup only with a reviewed account of sends that occurred after that snapshot; otherwise rollback can replay already-sent work. Never repoint an old JSON writer at imported queues, delete the DB, clear unknown rows or rotate credentials as a rollback shortcut.

Use the current readiness/preflight checks before restarting one locked runtime. Verify source/package identity and filesystem/SQLite facts on the actual VM only when authorized. Local migration fixtures do not establish VM durability, provider acceptance or phone rendering.
