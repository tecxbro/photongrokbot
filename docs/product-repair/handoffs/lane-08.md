# Lane 08 — operating instructions and executable drift checks

All existing operating targets from packet lane08 were updated in place: mirrored root READMEs, architecture/secrets/sharing, all role profiles and READMEs, bridge/topic/role memories, existing skills and routine, Moonshine installation and specified Live Mini/host docs. OPERATING_CONTRACT.md is the workflow authority; PRIVACY.md and MIGRATION.md cover actual private commands. No vendored Photon contracts, runtime, package or public Marketplace metadata were rewritten in this lane.

Role profiles/READMEs and core memory cards are generated from bridge/scripts/instruction-catalog.ts. Source identities remain inert templates, with ORCHESTRATOR_BOT_ID vocabulary. Actual setup registry contains only verified core IDs. The checker enforces exact role output, identical root READMEs, existing relative links, package commands and source entrypoints, required claim order and absence of obsolete active patterns. It scans every operating target listed in lane08, including the routine and optional helper docs. Existing dated host evidence remains historical; it is not relabelled a fresh run.

## Executable checks

From bridge/, with pinned Bun1.4.2:

- `bun run scripts/check-instructions.ts`: strict source check, returns INSTRUCTIONS_OK.
- `bun test src/instruction-consistency.test.ts` with PHOTON_TEST_MODE=1 and explicit synthetic PHOTON_INSTANCE_DIR: **5 tests, 70 assertions passed**. Uses actual child CLI invocations for bootstrap/storage, every core intent/receipt/registry, missing Moonshine and fabricated receipt rejection, claims/reads/renewal, idempotent structured final submission, actual five-card ready producer, status, scope rejection, processing completion and private inspection/export previews. No provider or model download occurs.
- `bun run typecheck`: passed after current shared cursor contract was picked.
- `bun install --frozen-lockfile`: passed, no package/lock changes.
- Manifest refresh and `--check`: passed, 348 lane-local source entries. Node22 existing verify-handoff passed: 110 host source files. `git diff --check`: passed.

The coordinator may add package alias check:instructions. The test file is discoverable by the existing harness.

## Reusable inventory

Run `bun run scripts/refresh-manifests.ts` from bridge/ only after integration source and reports are final. This deterministically regenerates root MANIFEST.txt (SHA-256 source inventory) and the existing host MANIFEST.sha256.json. It rejects listed private paths and non-file entries, includes untracked nonignored public source during review, and excludes its own root digest to avoid recursion. `--check` detects drift without mutation. The host's existing `npm run verify:handoff` then validates those source hashes. No new archive or Marketplace package is produced; historical archive sidecars still describe their own archives.

The manifest test proves deterministic regeneration, changed-source detection and private-file rejection in a separate synthetic Git directory. Coordinator must rerun refresh after all remaining root/helper changes; lane-local inventory is not a final integrated digest.

## Review followups owned by this agent

- 69acb74: Live Mini setup rejects a path-bearing publisher origin. Private setup suite20 tests118 assertions passed at that commit.
- 05006e3: provider event dedupe includes provider/conversation/actual line. Controller suite13 tests68 assertions passed.
- e9fb479: initial database intent recovery and reviewed immutable snapshot rotation. Private setup/storage suites32 tests193 assertions and typecheck passed. Three actual SIGKILL processes materialize equivalent interrupted disk states (intent only, exclusive empty file, completed schema before ready marker), then real CLI resumes. This is not an injected kill at a particular SQLite instruction. Nonempty unversioned/corrupt intent state and established missing state still fail closed. Backup regression uses actual nested0500 directories/0400 files and verifies retained modes.

Preflight already uses inspectDatabase, so the state owner's explicit integrity change keeps full diagnostic verification without an additional preflight edit. Deployment/rollback stays coordinator-owned; these documents link to that runbook.

Unverified gates remain actual native provisioning/handoff identity schema, hosted routine/provider acceptance, target-VM filesystem/Python/Moonshine/native limits, configured host persistence/CAS and physical-device rendering. No live VM, secrets, messages, deployment or remote push was used. No measured latency/cost improvement is claimed from shorter instructions.
