# Lane 01 handoff

Private paths, setup checkpoints, configuration, privacy export/delete/prune and diagnostic implementation. No provider resource was created, credential read from a live installation, message sent, or resource deployed.

## Integration

Add bridge package scripts (coordinator owner): `setup-state: bun run src/setup-state.ts`, `preflight: bun run src/preflight.ts`, `prune-instance: bun run src/prune-instance.ts`, `export-instance: bun run src/export-instance.ts`. Each accepts a single leading `--` separator. `start-runtime.sh` delegates to the existing `start` script and therefore the coordinator-owned kernel-lock launcher. All clients use shared/instance-paths.mjs. No additional environment parser remains.

Call `assertRuntimeReady(paths, store)` after opening the one store and before the one Spectrum connection. It requires all six core roles plus project, owner, routine, bridge configuration and durable verified Moonshine proof for the first completed setup. A later recorded media failure preserves `fullEverReady`, leaves text ready, and returns `mediaDegraded:true`. It never downloads, provisions or runs inference. Credentials are still loaded through `loadConfig({paths})`; tests may inject `config` directly.

`initializeSetup(paths,{authorized:true})` writes the stable installation identity. `initialize-storage` persists a database-creation intent BEFORE opening `openStore(create:true)` and then records ready. Any recorded DB initialization plus missing DB fails closed; an existing matching DB can finalize an interrupted checkpoint. After DB initialization, setup records are DB metadata under an exclusive cross-process setup lock; the bootstrap copy in instance.json is historical, not another mutable runtime truth.

Storage dependencies are lane02 APIs: inspectDatabase, assertPatchedSQLite, openStore(readOnly), backupTo, privacySnapshot, pruneResolvedBefore (including optional intermediatePaths), and acknowledgePrunedArtifacts. Cleanup intents survive commit-before-unlink interruption. Media dependencies are lane03's exact `moonshine_stt.py --verify-installation --model` response and the frozen package/model manifests. The wrapper resolves the private tools/moonshine-venv and models/moonshine paths through the shared resolver.

## Setup and recovery commands

The agent, never the human, supplies internal credential data through bounded JSON stdin. No manual header/token/JSON pasting flow is introduced.

1. Set the explicit private PHOTON_INSTANCE_DIR under the supported persistent workspace and outside source. Run `bun run setup-state -- init --authorized`, then `bun run setup-state -- initialize-storage` when bootstrap identity is ready.
2. `bun run setup-state -- intent --json-stdin` takes `{resource,environmentRevision?}`. Persist this BEFORE using the actually available native tool or locked Photon CLI. The result supplies the original operation identity. Existing intent/unknown/verified records must be reconciled by exact recorded resource identity and real supported tool results; absence of a response never authorizes another create. No API endpoints are guessed by setup code.
3. `receipt --json-stdin` takes `{resource,operationId,resourceId,verified:true,environmentRevision?}` after actual verification; `uncertain --json-stdin` records `{resource,operationId}` when a native outcome is unknown. No secret or full view URL belongs in these fields.
4. `write-bridge-env --json-stdin` takes `{text}` internally and validates the five supported bridge fields. Existing matching credentials remain byte-for-byte unchanged; malformed, missing or conflicting required fields stop with redacted errors.
5. `verify-moonshine` locally checks the locked Python packages and complete model manifests and records their exact fingerprints. The generic receipt command cannot fabricate Moonshine completion. Missing/failed STT blocks the first full setup, preserves installed credentials, and does not rewind an already-completed text installation.
6. Live Mini requires separate `authorize-live-mini --authorized`. `write-live-env --json-stdin` accepts `{text}` containing PUBLIC_BASE_URL and PUBLISHER_TOKEN and returns the environment revision. Verify/reuse the exact existing Live project, record the actual platform environment update against that revision, then obtain `live-deployment` intent for that revision before the final deployment/verification step. Any existing key or environment conflict stops for an explicitly authorized change/redeploy workflow; no routine setup rerun rotates keys or silently redeploys stale configuration. Actual native provisioning/schema and Vercel verification remain external gates.
7. `status` is redacted and reports readiness/resource statuses. `preflight` uses read-only SQLite inspection and does not chmod files. A stale setup lock requires `recover-lock` preview, then `recover-lock --apply --nonce <preview nonce>`; recovery only succeeds for the exact same-host owner proven exited. Never remove a lock merely because a timeout elapsed. Missing owner evidence requires offline operator investigation.

## Privacy and rollback

`prune-instance` defaults to a preview with planId and now. `--inspect` reports counts, ages, status and the remaining backup footprint. Apply only the same preview using `--apply --plan-id <id> --now <preview now>` through `bun run src/run-locked.ts -- bun run src/prune-instance.ts ...`, after stopping the runtime. `--delete-resolved` explicitly deletes eligible resolved payloads without waiting 30 days; unresolved/unknown work and dedupe/action tombstones remain. `--include-backups` is a separate explicit choice, retaining three whole latest snapshots and rotating older eligible snapshots after 30 days. Retained backups still count as retained private data.

Default resolved bodies/assets expire after 30 days. Only reserved media-job and converted-media crash artifacts qualify for the 7-day intermediate rule; the store excludes every retained reference and all candidates while media is pending/processing. Arbitrary legacy files are never guessed as intermediates. Logs are bounded to 30 days and 10 MiB. All scopes reject symlinks and another instance.

`export-instance` previews first. `--apply --plan-id <id>` must also run through the kernel-lock launcher. It produces a 0700 private backup with a consistent SQLite snapshot and 0600 config/content files, excluding credentials; stdout contains only counts and an export id. Sensitive payloads and complete capability URLs stay inside the private export, which is governed by backup retention.

For code rollback keep the new compatible SQLite state and stable instance identity. Do not run the old JSON writer or restore a pre-send queue. Data restore after any newer external effect requires reconciliation of all newer sends first. An unexpected missing DB/config fails closed and requires verified recovery, never initialization of another empty instance. VM persistence/startup guarantees and a real phone first greeting/confetti remain unverified external gates.

## Evidence

Lane regressions: private-setup.test.ts and private-storage.test.ts cover P01-P08, S01/S02/S04/S05, R01/R02 and new CLI path consistency for S03. Full S03 across enqueue/read-batch/Node Live helper remains integrated-lane verification. Synthetic roots require PHOTON_TEST_MODE=1 and use realpath(tmpdir); no default /workspace test access.

Command: `PHOTON_TEST_MODE=1 PHOTON_INSTANCE_DIR=/private/tmp/photon-lane01-import-guard <pinned-bun> test bridge/src/private-setup.test.ts bridge/src/private-storage.test.ts`. Additional checks: `python3 -m py_compile bridge/tools/moonshine-transcribe.py`, `bash -n bridge/scripts/start-runtime.sh`, `git diff --check`. Frozen bridge install succeeded with Bun1.4.2. Full typecheck at this wave reports only old runtime/enqueue/test imports removed by lane02 and awaiting coordinator/lane06 wiring; lane01 files have no reported type errors. Real provider resource reconciliation, Vercel deployment, downloaded-model runtime inference, VM startup/recovery and physical-device delivery were not executed.
