# Durable Spectrum bridge

The bridge is one Bun 1.4.2 Spectrum cloud runtime. It authorizes inbound sender/context, commits input and onboarding, schedules conversation-specific batches and native wakes, processes media separately, and drains one canonical outbox. Agents use the [operating contract](../docs/product-repair/OPERATING_CONTRACT.md); they never edit queue files or open another Spectrum client.

Run from this directory. Pin dependencies with `bun install --frozen-lockfile`; check with `bun run typecheck`. Production starts with `bun run start` or `./scripts/start-runtime.sh`. Both use the same private resolver, readiness proof and process-held kernel lock. A second runtime fails before opening Spectrum. Do not invoke `src/index.ts` directly.

`PHOTON_INSTANCE_DIR` selects the private persistent instance, default `/workspace/photongrokbot-state`. `data/bridge.sqlite` is canonical. `secrets/bridge.env`, media assets, models, tools, backups and logs are instance-relative; the checked-in `data/` directory is not runtime storage. [Privacy](../docs/product-repair/PRIVACY.md) and [migration](../docs/product-repair/MIGRATION.md) describe guarded paths and recovery.

## Commands

| Command from bridge/ | Purpose |
| --- | --- |
| `bun run setup-state -- init --authorized --scope core` | Private bootstrap identity; use full for initially requested full-feature setup, no provider calls. |
| `bun run setup-state -- initialize-storage` | First DB creation after identity; never silently replace lost state. |
| `bun run setup-state -- status` | Redacted readiness state. |
| `bun run setup-state -- registry` | Verified core identities and enabled verified Live Mini identity. |
| `bun run preflight` | Read-only config/identity/SQLite diagnostics. |
| `bun run batch -- claim --batch-id "$BATCH_ID"` | Acquire the current processing token before work. |
| `bun run read-batch -- "$BATCH_ID"` | Read that validated bound batch. |
| `bun run batch -- associate-task --json-stdin` | Record later work as a permitted input to the existing task/owner. |
| `bun run batch -- task-result --json-stdin` | Ingest the recorded correlation/result without an expired parent claim. |
| `bun run batch -- resume-task --json-stdin` | Claim persisted result work with fresh authority while runtime remains running. |
| `bun run enqueue -- --json-stdin` | Bounded strict canonical submission. |
| `bun run outbound-status -- --id "$OUTBOUND_ID"` | State/reference inspection; private output. |
| `bun run prune-instance -- --inspect` | Counts and retention policy. |
| `bun run export-instance` | Private export preview, no credential output. |

The [operating contract](../docs/product-repair/OPERATING_CONTRACT.md) provides complete submission and delegation envelopes. New mutations require a valid current claim, consumed inputRevision, original conversation/line and stable action key. Task submissions also use a permitted taskInputRevision; result reporting uses the recorded correlation independently of the parent lease. A role name or boolean cannot grant authority. File staging is separate from send authority.

Supported outbound kinds remain text (optional file/effect), reply, react, poll, voice, typing, attachment_group, app and app_update. File inputs must be private staged assets. Targets must belong to the original context. Task-card URLs require the canonical presentation helper. Normal progress modifies host JSON at the same URL.

First bare hi is satisfied by the single onboarding greeting; subsequent hi/okay/thanks and mixed reactions reach Front Door. Reply/poll identifiers and original attachments survive normalization. Media completion atomically records correlated ready/failed/unavailable work revisions, dispatching continuations after the first run or restart without another user message. Complete only the consumed revision; never repeat the greeting. Moonshine is mandatory for initial readiness; later degradation keeps text usable and reports unavailable transcription.

HTTP 200 is only native wake acknowledgement. Outbound unknown means no blind resend, fallback, fresh action key or alternate sender. Historical [Phase 1 notes](PHASE1.md) are not current operational instructions. Provider/device gates remain separate from local regression results.
