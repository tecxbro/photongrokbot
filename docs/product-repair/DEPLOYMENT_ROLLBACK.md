# Deployment and rollback runbook

This is an operator runbook for a separately authorized change. This repair does
not execute it. Local synthetic tests cannot establish hosted routine, provider,
VM filesystem, or physical-device behavior.

## Before a maintenance window

1. Review the integrated commit and RESULTS.md. Resolve its deployment gates.
   Record the exact old and new source commits and dependency lock digests.
2. Inventory the actual supervisor, bridge process tree, native routines, enabled
   six-role registry, original sender and hosted line, filesystem and SQLite
   version/source ID. Follow packet/VM_CHECK.md only for facts unavailable from source.
   Do not print credentials, full private URLs, message bodies or transcripts.
3. Confirm the instance root is outside the checkout on a supported local
   filesystem, directories are private, and secrets are mode 0600. Preserve
   existing project, line, bot, routine and Live Mini identities. Never provision
   replacements merely because a setup response was lost.
4. Validate mandatory Moonshine installation and a bounded local fixture under
   the actual VM CPU/RAM limits. Later STT failure must leave text routing usable.
   Verify process-group cancellation and any configured cgroup without creating
   resources implicitly.
5. Record unknown sends, native handoffs, expired accepted task claims and presentation claims for explicit
   reconciliation. Neither a webhook HTTP acknowledgment nor a queued outbox row
   proves completion. An accepted provider reference does not prove device display.
   An expired accepted task requires exact native receipt/status reconciliation
   under the offline lock; do not create a replacement task or reuse its stale token.

## Cutover

1. Pause the actual routine/supervisor entry points and stop every old bridge,
   enqueue writer and watchdog. Confirm process exit; a PID file or elapsed timer
   alone is insufficient. Keep the old source and state intact.
2. Inventory and dry-run the legacy migration against the stopped state. Review
   counts, schema failures, ambiguous work and the source digest. A failed or
   incomplete inventory is a stop condition, never permission to initialize empty
   state. The executable commands and flags are documented in MIGRATION.md.
3. Apply migration under the same instance lifetime lock with the explicit
   stopped-writers attestation. Retain its immutable snapshot and manifest.
   Confirm re-running the same snapshot is a no-op and changed input is rejected.
   Old queued delivery is quarantined as unknown; no automated resend is allowed.
4. Install frozen dependencies and run local preflight using the intended Bun,
   Node, Python, FFmpeg and SQLite builds. Point the supervisor at the locked start
   entry point and canonical instance root. Start exactly one Spectrum connection.
5. Re-enable the existing authorized wake path after local readiness succeeds.
   Confirm claim, read, handoff intent/receipt, final enqueue and completion use the
   executable protocol. Do not copy stale shell examples or recreate the roster.
6. With separate explicit authorization, exercise provider and physical-device
   checks from TEST_MATRIX.md. Record exact operations and returned references.
   Check first-use greeting plus confetti only on a genuinely fresh installation;
   migrated onboarding provenance must not cause another celebration.

## Rollback

Stop and quiesce the new supervisor, wake entry points and all writers first.
Preserve the new private database, WAL/SHM files through the supported consistent
backup command, operation evidence, helper contexts and migration manifests.

If the new runtime never accepted input or dispatched an operation, the untouched
legacy snapshot and recorded old source can be restored as one unit after review.
If any new event or external operation occurred, restoring old JSON would erase
deduplication and uncertainty evidence. Do not restart the old queue in that case.
Keep service paused or use a forward fix while reconciling exact operation and
provider references. There is no automatic lossy reverse migration.

Do not reset onboarding, change an action key, release an unknown presentation,
or move a sending operation back to queued to make recovery appear successful.
Only proven non-application permits a new authorized attempt. Preserve the single
writer lock and never run the old and new listeners concurrently.

## Evidence to retain

Record source/lock digests, private backup location and checksums, migration counts,
SQLite version/source and filesystem, startup/preflight results, operation IDs,
provider references and separately labeled device observations. Keep secrets and
customer content in the private instance rather than this repository or CI logs.
