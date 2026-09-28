# Product operating contract

This is the workflow authority for this repaired product. Existing role profiles and topic references summarize it and are checked for drift. Provider contracts still belong to the locked SDK and matching official docs. Internal commands below are bridge wrappers, not new Photon or Grokbot APIs.

## Architecture and authority

One account shared VM, one private instance, one Spectrum cloud connection and six core roles are required: Front Door, Master Orchestrator, Creator, Feature Add, Image Cards and App Sheet. Moonshine installation is mandatory before initial readiness. Private state is outside the code checkout. Shared-VM roles are cooperative identities, not separate security principals.

Bootstrap requires an explicit setup request. The bot may use actual authorized provisioning tools, after inspecting their schemas and recording intent. A normal message wake cannot create bots, projects, lines, routines or deployments. Tool access or a connected Vercel account alone is not enablement authority. Optional Live Mini enablement has a separate explicit authorization checkpoint and preserves existing resources and keys.

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

The registry command returns only verified configured core identities. Optional workers must be independently configured and verified in the private installation before assignment; a source template is never an active worker. The canonical placeholder is `{{ORCHESTRATOR_BOT_ID}}` with `{{ORCHESTRATOR_AGENT_UUID}}`. Substitute private deployed profiles, not tracked source. Never copy an old account roster or silently delete personal histories.

Setup resource states are intent, unknown, verified or failed. Record intent before a provider call. If the response is lost, mark unknown and reconcile the same operation/resource; do not create a replacement. A successful tool receipt is evidence only for that resource, not proof the whole product is ready. `verify-moonshine` checks actual installed package versions, immutable model files and import behavior; it cannot be replaced with a hand-written successful receipt. After first full readiness, a later media failure leaves text usable and must be reported.

## Every normal wake

1. Validate the batch reference from the exact `{ "batchId": "..." }` body.
2. Acquire a current processing claim. If busy/completed, exit without side effects.
3. Read the bound batch, including destination/line, original replies, poll identities and media readiness.
4. Resolve the existing task and necessary context. Preserve its owner and constraints.
5. Choose reaction, effect or no reaction. Only now may a fenced non-final operation be submitted.
6. Answer directly or record durable delegation intent before the actual native handoff.
7. Submit an idempotent final result through Front Door and complete processing bookkeeping. Work completion and delivery state remain distinct.

```sh
bun run batch -- claim --batch-id "$BATCH_ID"
bun run read-batch -- "$BATCH_ID"
bun run batch -- renew --batch-id "$BATCH_ID" --run-id "$RUN_ID" --generation "$GENERATION"
```

The claim command returns `{status:"acquired",token:{batchId,runId,generation},leaseUntil}`. Read, reaction and handoff follow the acquired result. Renew only actual continuing work; an expired generation cannot enqueue or complete under a newer owner. Never delete a claim file or invent a lease to recover it. On recovery, storage safely fences abandoned claims only when no unresolved native handoff/final send holds them.

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
  "actionKey": "answer:stable-task-revision",
  "purpose": "final",
  "payload": { "kind": "text", "spaceId": "SPACE_FROM_BOUND_BATCH", "text": "The useful answer." }
}
```

`generation` must be copied from the token, not assumed to be 1. `taskId`, when present, must already be bound to this original batch and an accepted/completed native task. Purposes are progress, final, control and presentation. Typing uses control; reactions/effects require a current claim. Reuse the same action key and payload for the same logical operation. Changed payload with that key conflicts. A new key is not a recovery mechanism.

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

`bun run batch -- delegation-intent --json-stdin` takes `{claim,task}`. Task fields are taskId, batchId, destination `{spaceId,lineId}`, owner, finalOwner and `state:"intent"`. Use the original bound destination and verified selected worker; finalOwner is the configured Front Door identity. The actual native tool's documented identity/correlation must determine taskId. If it cannot support pre-call durable correlation, stop at that integration gate rather than inventing a tool argument.

Only after the intent commits, call the actual native handoff. `delegation-receipt --json-stdin` uses the same envelope and state accepted with the actual receipt, unknown if acceptance is ambiguous, or completed for a verified result. Never equate an intended handoff with one that happened. Unknown outcomes retain their identity for operator reconciliation; no blind retry or second worker.

After durable final enqueue/result bookkeeping, `bun run batch -- complete --batch-id "$BATCH_ID" --run-id "$RUN_ID" --generation "$GENERATION"` marks processing complete. It does not label queued output delivered. Inspect `bun run outbound-status -- --id "$OUTBOUND_ID"` privately for actual state/reference. Do not share full private status records in ordinary chat.

## First use, option cards and media

Atomic input acceptance reserves `onboarding:<installation-id>` and one greeting with confetti. A first bare hi is consumed by that greeting; a first question or supported non-text input also reaches useful work. Media download/transcription is not required to celebrate. There is no independent writable celebration marker. Migrated legacy celebration suppresses repetition without claiming device observation. Unknown send outcome never causes a new confetti identity.

Visual option choices use all N cards for N >= 4 in one logical attachment_group, including five/seven. Do not split after uncertain provider response. Front Door submits one canonical group with aligned metadata (`optionId`, title, details/caption, known price/qualifier, direct URL). Missing price stays missing. Image Cards returns ready files and metadata; it does not become final sender. The cards-ready route uses the same action key as Front Door, so watchdog and foreground cannot create two logical results. See [card delivery](../../skills/photon-image-card-delivery/SKILL.md).

Any added emoji on an exactly known option returns that option's existing details, known price and direct URL. Do not interpret sentiment as a different workflow or ask whether details are wanted. Ambiguous targets get one concise clarification. Removal is not a new selection; the locked provider stream currently emits added reactions only. A reaction never authorizes a purchase, booking or other transaction.

Media jobs preserve original metadata and correlate later ready/unavailable/failed state to the accepted event. Do not claim unreadable content was understood. First setup requires verified Moonshine; runtime restarts do not download or upgrade models. Text remains useful when media degrades.

## Live Mini and evidence

Only the [canonical helper](../../live-mini/runtime/README.md) may bind initial task-card presentation to the host ledger and bridge outbox. The task must already be durably bound. Raw app sends of registered task-card URLs are rejected. Progress updates replace hosted content at the exact same URL, never a fresh bubble or Spectrum edit. A terminal slot stays occupied while initial presentation is pending/unknown, until its outcome is reconciled.

Static App Sheet URLs and supported other-host app updates remain separate capabilities. A missing provider session is a limitation to reconcile, not permission to resend. Personal loader customization remains explicit and owner-bound; a received photo alone authorizes no change.

Report local code/tests, installed dependencies, hosted checks, provider acceptance and physical-device observations separately. Logs use fixed codes and counts, not secrets, message bodies or capability URLs. [Deployment/rollback](DEPLOYMENT_ROLLBACK.md) owns release actions; reading this contract does not deploy anything.
