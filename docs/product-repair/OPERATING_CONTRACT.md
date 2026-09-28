# Product operating contract

This is the workflow authority for the Grokbot build/setup kit. Grokbot builds and configures its native integration from these reusable pieces. Existing role profiles and topic references summarize it and are checked for drift. Provider contracts still belong to the locked SDK and matching official docs. Internal commands below are bridge wrappers, not new Photon or Grokbot APIs.

## Architecture and authority

One account shared VM, one private instance, one Spectrum cloud connection and six core roles are required: Front Door, Master Orchestrator, Creator, Feature Add, Image Cards and App Sheet. Moonshine installation is mandatory before initial readiness. Private state is outside the code checkout. Shared-VM roles are cooperative identities, not separate security principals.

Bootstrap requires an explicit setup request. The bot may use actual authorized provisioning tools, after inspecting their schemas and recording intent. A normal message wake cannot create bots, projects, lines, routines or deployments. Tool access or a connected Vercel account alone is not enablement authority. The initial requested scope governs optional Live Mini: full-feature setup already authorizes included setup. Record that scope, preserve existing resources and keys, and do not ask for the same authorization again. Missing account-specific configuration is discovery work for Grokbot.

Front Door is the sole final-response owner. Workers return ready results through the existing native task mechanism; the runtime alone makes Spectrum calls. Never route around a missing claim, ambiguous send, destination guard or host ledger with another sender.

## Private paths and configuration

Use `PHOTON_INSTANCE_DIR` for the canonical root, default `/workspace/photongrokbot-state`. Production roots must be persistent `/workspace` paths outside a Git checkout with no symlink components. The resolver provides `secrets/bridge.env`, `secrets/live-mini.env`, `instance.json`, `data/bridge.sqlite`, `data/inbound-attachments`, `data/outbound-assets`, `models`, `tools`, `live-mini/context`, `logs` and `backups`. Do not reconstruct paths from provider message IDs. Directories are 0700 and files 0600 or stricter.

Authoritative environment parsing is literal and rejects unknown/duplicate keys, expansion syntax and unresolved required values. Never shell-source it, print it, or ask the user to paste secrets. Missing/corrupt previously initialized state fails closed. Use [migration](MIGRATION.md) for recovery and [privacy](PRIVACY.md) for retention/export.

Run bridge commands from `bridge/`, using pinned Bun 1.4.2. Production examples assume the verified private root is already selected. Tests set `PHOTON_TEST_MODE=1` and a unique synthetic root before import. Documentation variables such as BATCH_ID, RUN_ID and GENERATION are taken from actual command results, never model-invented IDs.

## Setup and active registry

Follow [getting started](../../skills/getting-started/SKILL.md). Sequence: private bootstrap/storage → authorized Photon discovery/reuse → mandatory pinned Moonshine → all six verified roles → Front Door sender authorization and native wake routine → private complete config → readiness checks → one locked runtime → invite first text to hosted bot line.

```sh
bun run setup-state -- status
bun run setup-state -- registry
bun run preflight
```

The registry command returns verified configured core identities and the verified Live Mini identity when that optional role is enabled. `setup-state -- init --authorized --scope full` records initial full-feature scope; use `core` for core-only setup. Optional workers must be configured and verified in the private installation before assignment; a source template is never an active worker. The canonical placeholder is `{{ORCHESTRATOR_BOT_ID}}` with `{{ORCHESTRATOR_AGENT_UUID}}`. Substitute private deployed profiles, not tracked source. Never copy an old account roster or silently delete personal histories.

Setup resource states are intent, unknown, verified or failed. Record intent before a provider call. If the response is lost, mark unknown and reconcile the same operation/resource; do not create a replacement. A successful tool receipt is evidence only for that resource, not proof the whole product is ready. `verify-moonshine` checks actual installed package versions, immutable model files and import behavior; it cannot be replaced with a hand-written successful receipt. After first full readiness, a later media failure leaves text usable and must be reported.

## Every normal wake

1. Validate the batch reference from the exact `{ "batchId": "..." }` body.
2. Acquire a current processing claim. If busy/completed, exit without side effects.
3. Read the bound batch, including inputRevision, acknowledgedRevision, continuationReason, original source references, results, destination/line, replies, poll identities and media readiness.
4. Resolve the existing task and necessary context. Preserve its owner and constraints; record a permitted input association before amending it.
5. Choose reaction, effect or no reaction. Only now may a fenced non-final operation be submitted.
6. Answer directly or record durable delegation intent before the actual native handoff.
7. Submit an idempotent final result through Front Door and complete processing bookkeeping. Work completion and delivery state remain distinct.

```sh
bun run batch -- claim --batch-id "$BATCH_ID"
bun run read-batch -- "$BATCH_ID"
bun run batch -- renew --batch-id "$BATCH_ID" --run-id "$RUN_ID" --generation "$GENERATION"
```

The claim command returns `{status:"acquired",token:{batchId,runId,generation},inputRevision,leaseUntil}`. The token is temporary processing authority; copy the revision actually read as the consumed input revision. Read, reaction and handoff follow the acquired result. Renew only actual continuing work; an expired generation cannot enqueue or complete under a newer owner. Never delete a claim file or invent a lease to recover it. On recovery, storage safely fences abandoned claims only when no unresolved native handoff/final send holds them.

HTTP 200 means the native routine started, not that it claimed or completed work. Wake retries reuse the original batch, are bounded and do not poll every worker. Unknown native handoffs stay held until reconciled. Runtime read receipts are best effort after input acceptance; they do not prove task processing.

## Routing and context

Front Door handles conversation, supplied-text transformation, small explanations/calculations, available follow-ups and a narrow read-only lookup when the entire answer fits: at most 2,000 words of task material, 300 answer words, ten comparison items and three substantive retrievals. These are routing bounds, not permission to omit essential work. No project execution, new artifact generation, debugging session, ongoing supervision or external mutation belongs to that direct-answer shortcut. Native polls and already-staged artifact delivery remain supported.

One verified worker may own a complete outcome without adding Orchestrator just because it is long. Master Orchestrator coordinates multiple execution owners, dependencies, cross-task work or one bounded escalation. Creator owns fixes/regressions; Feature Add owns new capabilities. Mixed work keeps an existing owner or selects a primary owner with explicit bounded children. One reassignment/escalation is allowed for mismatch; never bounce refusals indefinitely or create speculative workers.

Use current batch and relevant context first. Load one task checkpoint, one necessary policy or the verified registry when needed, not all histories. Keep original conversation, sender, line and task references. Greetings, okay/yeah/thanks and mixed reactions retain conversational context after the first onboarding optimization. Shorter instructions are not measured latency or cost savings.

## Structured outbound submission

Use bounded JSON on stdin, not interpolated shell text. `bun run enqueue -- --json-stdin` takes one strict envelope. The following is a template whose identifiers come from the current claim/batch:

```json
{
  "version": 1,
  "batchId": "BATCH_FROM_CLAIM",
  "claim": { "batchId": "BATCH_FROM_CLAIM", "runId": "RUN_FROM_CLAIM", "generation": 1 },
  "inputRevision": 1,
  "actionKey": "answer:1",
  "purpose": "final",
  "payload": { "kind": "text", "spaceId": "SPACE_FROM_BOUND_BATCH", "text": "The useful answer." }
}
```

`generation` must be copied from the token, and `inputRevision` from the work actually read; neither is assumed to be 1. A task submission also supplies `taskId` and its recorded `taskInputRevision`. The batch/work revision must be a recorded permitted input to that task, with its original owner, destination and line unchanged. Purposes are progress, final, control and presentation. Typing uses control; reactions/effects require a current claim.

The bridge derives trusted scope from stored context. Ordinary answers use original request/work scope; task results use logical task plus result/input revision; option groups use option-set revision plus destination; onboarding uses installation; initial Live Mini uses existing card identity. Different requests may both use `answer:1` and receive distinct operations. Retry the same operation with the same action key and payload; claim renewal/recovery does not change its scope. Never use a claim generation, timestamp or random retry value as operation identity. A caller-authored scope is not authority. Changed payload or mismatched source context conflicts. Scoped status lookup must supply the same source/revision context; direct lookup by existing outbound ID remains available.

| Payload kind | Fields beyond kind/spaceId |
| --- | --- |
| text | text, optional attachmentPath/effect |
| reply | targetMessageId, text |
| react | targetMessageId, emoji |
| poll | title, options[] |
| voice | audioPath, optional text/durationSeconds |
| typing | state: start or stop; purpose control |
| attachment_group | attachmentPaths[], optional text; option cards require batchId and aligned cards[] |
| app | url, optional live, for ordinary static/other-host apps |
| app_update | url, targetMessageId, optional live; retains exact provider session |

Targets must be known in the original conversation/line. Poll follow-ups use ordinary text, not a synthetic vote ID as a reply target. Missing/unsupported replies may use only the adapter's verified definitive fallback; a timeout/undefined ambiguous outcome does not authorize a second message. Controls that the provider skips are reported honestly.

Artifacts must be ordinary private files within the resolver's outbound asset directory. A separately authorized export can be copied using `bun run enqueue -- --stage-file "$AUTHORIZED_EXPORT_PATH"`; staging grants no send authority. Never stage a credential, arbitrary private instance file, symlink or traversal path. All members validate before a group is queued or converted.

## Delegation and completion

`bun run batch -- delegation-intent --json-stdin` takes `{claim,task}`. Task fields are taskId, batchId, destination `{spaceId,lineId}`, owner, finalOwner and `state:"intent"`. `taskId` is a local correlation identity, durably recorded before invoking the native tool. It is separate from optional `nativeRef`, which may only become available afterward. Preserve the original task batchId, owner, destination and line. Read the returned task input's inputRevision and correlationId for the worker return. Never invent a native tool argument: Grokbot discovers and invokes its actual native schema.

Only after local intent commits, invoke native delegation. `delegation-receipt --json-stdin` retains `{claim,task}`, with state accepted and actual receipt plus optional nativeRef; use unknown for ambiguous acceptance. An intended handoff is not one that happened. Unknown outcomes retain their identity for operator reconciliation; no blind retry or second worker. The bridge records correlation and results; Grokbot owns native scheduling, task ownership, worker invocation and amendments.

A later message amends an existing task through `bun run batch -- associate-task --json-stdin` with `{claim,taskId,inputRevision?}`. Optional inputRevision is the later batch/work revision being consumed. The result is a persisted task input `{taskId,inputRevision,batchId,workRevision,correlationId,state,...}`. Its inputRevision is the task-level revision used for subsequent result reporting and task submission. Association preserves the original binding and owner; it never rewrites task.batchId. An unrelated intervening answer does not change the app task. For “build a dog app → unrelated question → add cats”, associate the cats message to the existing app task and ask its same native owner to amend it.

Original workers and amended workers report results through `bun run batch -- task-result --json-stdin` with `{taskId,inputRevision,correlationId,receipt,nativeRef?,result}` using the recorded task input and actual native evidence. This operation needs neither the expired parent claim nor the runtime's lifetime lock. It persists result work transactionally and returns `{resultId,batchId,workRevision,superseded,...}`. An identical result replay returns the existing result; conflicting identity or evidence is rejected. Superseded work is recorded with superseded:true and no workRevision; resume-task rejects it with SUPERSEDED_TASK_INPUT, so it cannot become the current final answer.

The runtime dispatches stored result continuations through the same `{batchId}` wake. Front Door may also use `bun run batch -- resume-task --json-stdin` with `{taskId,inputRevision}` to acquire fresh processing authority for that result work. Read its current work revision and use the permitted task input for new mutations. Expired tokens remain invalid. Ordinary completion must not stop the bridge, recover an old parent token, invoke another handoff or schedule native work again. `recover-delegation` is reserved for genuine offline operator reconciliation of uncertain state.

After durable final enqueue/result bookkeeping, `bun run batch -- complete --batch-id "$BATCH_ID" --run-id "$RUN_ID" --generation "$GENERATION" --input-revision "$INPUT_REVISION"` acknowledges only the revision actually consumed. If media settles after the read, its newer revision remains actionable. Processing completion does not label queued output delivered. Inspect `bun run outbound-status -- --id "$OUTBOUND_ID"` privately for actual state/reference. Do not share full private status records in ordinary chat.

Control failures preserve nonzero exit status and return bounded structured codes and supported recovery actions. Read the code: stale authority needs a fresh permitted claim; an identity conflict needs reconciliation of the existing identity; invalid input needs correction; uncertain delivery needs inspection of the existing operation. Never turn an uncertain send into another action key.

## First use, option cards and media

Atomic input acceptance reserves `onboarding:<installation-id>` and one greeting with confetti. A first bare hi is consumed by that greeting; a first question or supported non-text input also reaches useful work. Media download/transcription is not required to celebrate. There is no independent writable celebration marker. Migrated legacy celebration suppresses repetition without claiming device observation. Unknown send outcome never causes a new confetti identity.

Visual option choices use all N cards for N >= 4 in one logical attachment_group, including five/seven. Do not split after uncertain provider response. Front Door submits one canonical group with aligned metadata (`optionId`, title, details/caption, known price/qualifier, direct URL). Missing price stays missing. Image Cards returns ready files and metadata; it does not become final sender. The cards-ready route and Front Door use the same stored option-set revision, destination, source work revision and action key, so watchdog and foreground converge on one logical result. See [card delivery](../../skills/photon-image-card-delivery/SKILL.md).

Any added emoji on an exactly known option returns that option's existing details, known price and direct URL. Do not interpret sentiment as a different workflow or ask whether details are wanted. Ambiguous targets get one concise clarification. Removal is not a new selection; the locked provider stream currently emits added reactions only. A reaction never authorizes a purchase, booking or other transaction.

Media jobs preserve original metadata and atomically store ready/unavailable/failed outcomes with an unacknowledged media-result revision on the accepted work. Read continuationReason to distinguish media_ready, media_failed and media_unavailable from inbound or task_result work. Dispatch survives restart and does not require a new incoming message. Consume only the new media outcome against the original request; do not reinsert the voice note as a new user message, repeat its greeting or ask the user to text again. Duplicate settlement does not create duplicate logical work. Do not claim unreadable content was understood. First setup requires verified Moonshine; runtime restarts do not download or upgrade models. Text remains useful when media degrades.

## Live Mini and evidence

Only the [canonical helper](../../live-mini/runtime/README.md) may bind initial task-card presentation to the host ledger and bridge outbox. The task must already be durably bound. A permitted later task input uses the same card/context and signed URL with current task-revision authority, while read-only recovery can inspect existing status after expiry. Raw app sends of registered task-card URLs are rejected. Progress updates replace hosted content at the exact same URL, never a fresh bubble or Spectrum edit. A terminal slot stays occupied while initial presentation is pending/unknown, until its outcome is reconciled.

Static App Sheet URLs and supported other-host app updates remain separate capabilities. A missing provider session is a limitation to reconcile, not permission to resend. Personal loader customization remains explicit and owner-bound; a received photo alone authorizes no change.

Report local code/tests, installed dependencies, hosted checks, provider acceptance and physical-device observations separately. Logs use fixed codes and counts, not secrets, message bodies or capability URLs. [Deployment/rollback](DEPLOYMENT_ROLLBACK.md) owns release actions; reading this contract does not deploy anything.
