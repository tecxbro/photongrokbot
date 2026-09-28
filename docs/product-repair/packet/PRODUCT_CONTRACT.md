# Product contract: required replacement behavior

This document is the new design specification. Names marked **NEW** are proposed internal interfaces/files to implement and test, not assertions that they already exist. The coordinator may refine signatures after reading callers, but must preserve the semantics below and freeze a coherent contract before downstream work.

## 1. Scope and non-goals

The deployment remains on one Grokbot account's VM. Code and private state may be in different folders on **that same VM**. No second computer, database service, transport, or model-based router is required.

Keep the six existing role profiles and Front Door's direct-answer/one-specialist/coordinated routing. The problem is concurrent writes and weak recovery, not proof that every message uses six models. Keep optional Live Mini's serverless host separate from the local bridge database.

Exclude Marketplace publication/discovery, role consolidation, new UI, a new general agent platform, and unrelated provider upgrades. Do not remove an existing supported operation to close an audit finding. A provider-specific contract that cannot be verified is an explicit remaining gate for that operation, not an invented implementation.

## 2. Private instance layout

**NEW canonical setting:** `PHOTON_INSTANCE_DIR`.

For new installations on Grokbot, default to `/workspace/photongrokbot-state` after verifying it is outside the code checkout and inside the supported durable workspace. An explicitly configured per-instance absolute path overrides that default. Tests MUST inject a temporary instance root and a test-mode guard. Never default tests to `/workspace`.

Proposed layout, all on the same VM:

```text
/workspace/<actual-code-checkout>/          tracked source, docs, templates
/workspace/photongrokbot-state/             private instance root, mode 0700
  instance.json                            non-secret binding/role configuration
  secrets/
    bridge.env                             Spectrum, sender binding, wake credentials
    live-mini.env                          publisher URL + token only as needed
  data/
    bridge.sqlite                          transactional local state
    inbound-attachments/
    outbound-assets/
    views/                                 regenerable agent-readable batch projections
  models/moonshine/...                     downloaded model artifacts
  tools/                                   pinned venv/local runtime support if needed
  live-mini/context/                       private helper context
  backups/                                 explicitly controlled migration/backups
  logs/                                    redacted, bounded operational logs
```

Config and payload files with private information use 0600; private directories use 0700. Permission modes prevent access by different OS users, not by other bots sharing the same account/OS user. This design is not a multi-tenant security sandbox.

Resolve paths once through a shared Node/Bun-compatible utility. Node-based Live Mini helpers cannot import `bun:sqlite` directly. Expose a bounded Bun control CLI for those helpers when they need bridge state. Do not create a second private-path convention.

No credentials, complete capability URLs, phone numbers, message bodies, or instance agent IDs belong in committed source/profiles. Maintain shipped generic policy files; store generated roster/bot cards in private instance state. Do not delete the user's actual bot memory.

## 3. Transactional bridge state

Use the existing Bun runtime with a local SQLite database. All clients must resolve the **same instance database**; no per-agent database. Confirm actual filesystem and SQLite build support before enabling WAL. Use a runtime containing the documented WAL-reset fix (SQLite 3.51.3 or later, or an explicitly verified fixed backport), verified by `sqlite_version()` and `sqlite_source_id()`, not the Bun version string alone.

Recommended durability settings: foreign keys ON, WAL on a supported local filesystem, synchronous FULL, bounded busy timeout and bounded retries for database-busy errors. Keep transactions synchronous and short. Never hold a database write transaction during network calls, model calls, SDK sends, media conversion, or sleeps. Use `BEGIN IMMEDIATE`/the driver's immediate transaction helper for read-modify-write claims. Database corruption and permission failures are errors, never an excuse to create an empty database.

Logical records needed (exact schema owned by lane 02):

- **Inbox events:** installation/provider/conversation/line-scoped provider identity, local sequence, original event metadata, payload and media state. Dedupe keys include event kind/identity as required by the verified provider. Never assume a reaction update has the same semantics as an original text with the same ID.
- **Batches and membership:** fixed conversation/line, ordered input references, eligibility/state, processing run ID and monotonic fencing generation.
- **Wake jobs:** persistent wake intent, bounded attempts, next attempt, HTTP acknowledgement, processing progress/claim, terminal/degraded diagnostics.
- **Task bindings:** references to existing Grok tasks, original destination, execution owner, final-response owner and approval state. This is a bridge routing record, not a second task orchestrator.
- **Outbox operations:** logical operation ID, original destination, payload hash, ordered bubble/group parts, delivery state and provider references.
- **Send attempts:** durable attempt identity, start, result, uncertainty and reconciliation evidence.
- **Media jobs:** input references, bounded processing state, attempt identity and correlated result.
- **Presentations/option metadata:** parent/part identity and known option details sufficient for a later reaction.
- **Instance/onboarding metadata:** stable installation ID and onboarding operation identity; no reset on every boot.

Use uniqueness constraints to reject duplicate logical operations. Repeating the same operation key with the same canonical payload returns the original operation; the same key with different payload is a conflict. The key includes the original conversation/line and logical purpose. Separate intended bubbles have distinct ordered child identities. An intentional later resend has a new authorized logical action; do not content-hash all equal messages into one forever.

`outbound-queue.json`, `pending-batch.json`, mutable handled notes and file-based claims must cease to be alternate writable truth. Compatibility JSON views may be generated from SQLite; production readers must use the control/storage interface. Existing API wrappers may remain temporarily but route to the one store.

## 4. Inbox acceptance, media and wake state

Filter inbound direction, platform and configured sender before persisting private content or reading attachments. Bind the original verified conversation/line. Do not broaden authorization during this repair. Partition already-supported authorized traffic by conversation/line; do not add group-chat support or new-recipient sending implicitly.

Persist the event and its pending work **before** marking the input processed. A read receipt is a best-effort user-interface operation after durable acceptance, not a receipt that the task is done. A duplicate event returns its existing state.

Batch formation must atomically establish batch membership and the wake intent. Do not delete durable pending input before its replacement exists. Native wake bodies stay `{"batchId":"..."}`; message content and credentials do not go into the webhook. Prefer `read-batch` as the agent's validated view, not arbitrary path construction from an untrusted string.

The receive loop must not await heavy media. Store a serializable original provider reference and minimal metadata; an in-memory SDK object is not crash recovery. A media worker produces a correlated result. Text remains readable/routable when media is pending or fails. Within a conversation, expose an ordered `media_pending` placeholder to Front Door and later a correlated enrichment; do not silently act as though omitted voice content was understood. An unavailable earlier voice attachment can still require clarification for a dependent request. Media completion must not launch a second independent copy of the original task.

HTTP 200 for a wake means acknowledged, not completed. Claims, handoff receipts and durable enqueue establish progress. A watchdog may re-notify eligible abandoned/unclaimed work with bounded backoff, but should not repeatedly wake already active/delegated work. Native Grok handoff is another external side effect: record intent and returned receipt; if acceptance is uncertain, reconcile existing task state rather than blindly creating a duplicate worker task.

## 5. Claims and original-destination validation

A processing claim identifies **one invocation**, not only a bot ID. Claim/renew/complete compare a run ID and fencing generation atomically. An expired invocation cannot write results under a newer claim. Claims are obtained before reactions, effects, final enqueue and handoff bookkeeping.

A claim alone is not exactly-once execution. Each side effect also has a stable logical identity. An uncertain send cannot be reclaimed and resent merely because a lease expires.

**NEW internal CLI contracts** to implement, version and document:

- `bun run batch -- claim --batch-id <id>`: return acquired/busy/completed plus a new invocation ID and fencing token on acquisition. A second invocation of the same bot is not an automatic resume.
- Explicit renew, complete, and delegation-intent/receipt operations: compare invocation/generation. Exact argument schema is frozen by lane 00 before implementation.
- `bun run enqueue -- --json-stdin`: validated structured submission carrying batch/task reference, active invocation/generation where applicable, logical action key and operation payload.
- `bun run outbound-status -- --id <id>`: redacted status plus provider reference only where needed by the trusted local caller; no queue-file scans.
- `bun run read-batch -- <batchId>` remains supported with strict identifier validation and a database-backed projection.

These are internal product commands, not Photon/Grok API claims. Implement them before putting them into active skills. Do not write command examples that cannot run.

Derive the allowed destination from the accepted batch or task binding. If a caller supplies a destination, it must match. Validate reply/react/app-update targets against the same conversation/line and known authorized task context, rather than only trusting the supplied ID. Resolve cross-process outbound paths through registered artifacts or canonical allowlisted roots; reject traversal, directories, symlink escapes and secret/model paths. Arbitrary files selected by a legitimate user must be deliberately staged, not made readable through a broad `/workspace` allowlist.

Do not claim that a bot ID string or shared filesystem token cryptographically isolates hostile same-account agents. These checks prevent wrong-context/injected-data operations through the supported API; the account VM remains a trusted administrative boundary.

## 6. Outbound lifecycle and ordering

Required state meaning:

| State | Meaning | Automatic new provider send? |
|---|---|---|
| queued | Durable validated intent; not yet dispatched | Yes, after exclusive claim |
| sending | Durable attempt exists; provider operation may have begun | No competing dispatcher |
| accepted | Provider returned documented acceptance/reference | No |
| retry_wait | Proven not applied, transient/retryable | Only after bounded backoff |
| unknown | May have been applied; insufficient evidence | **No blind resend** |
| failed | Proven not applied, terminal/exhausted retry policy | No automatic retry |
| skipped | Verified unsupported/no-op control, accurately reported | No retry loop |
| cancelled | Cancelled before dispatch | No |

Device-delivered/device-observed proof is separate optional evidence, not inferred from `accepted`. Do not invent provider receipts or idempotency headers. Optional controls have different semantics: a void result is not universally success or universally failure. Lane 06 must verify each SDK operation's return/error semantics against the locked provider implementation.

Only one Spectrum runtime connection and sender owns the instance. Use a supported, held-for-lifetime process lock on the VM; do not steal a lock on a timer while the prior process may still be alive. Processing fencing does not stop an already-running network send. Recovered `sending` is normally `unknown` until reconciled, not `queued`.

Preserve ordered bubbles within one result and original conversation ordering. Do not let an interval tick dispatch bubble two ahead of an in-flight bubble one. An unresolved operation blocks dependent operations in its sequence; unrelated conversations must continue. Control events such as typing cleanup can use an explicitly separate control path, not block forever behind an unknown content send.

Reply fallback is allowed only for a **documented definitive non-application** such as a verified unreplyable target. Timeout, generic exception, ambiguous undefined, or a database failure after a provider return must not trigger an independent plain-text send.

Persist provider references for text, reply, grouped attachments, polls, voice and apps where returned. Use a durable `sent/accepted` result before setting derived markers. If provider acceptance succeeded and DB settlement failed, keep the attempt recoverably uncertain; don't re-enter the send branch on restart.

## 7. First-use confetti and normal conversation

On the first authorized user-originated content event, establish one outbox action `onboarding:<installation-id>` in the same durable unit as the onboarding reservation. The installation, not every worker or conversation, owns the one celebration. Ignore outbound echoes, unauthorized senders and pure receipts.

- First `hi`: one greeting bubble with confetti. No competing canned greeting and no additional Front Door celebration.
- First substantive question: the greeting/confetti is still sent once, and the actual question is forwarded/answered. Do not discard useful input just to finish onboarding.
- First supported voice/image/sticker: onboarding does not depend on media transcription succeeding. Route or accurately report the content through its supported path.
- Duplicate input/restart: reuse the same onboarding intent/attempt, never a fresh confetti action.
- Unknown provider outcome: preserve uncertainty and reconcile. Exactly one logical operation does not guarantee exactly one physical delivery without provider support.

Remove `okay`, `yeah`, thanks, or other contextual answers from the context-free canned shortcut. Every mixed reaction/non-text batch reaches Front Door. A normal bare-greeting shortcut is optional only when code can prove an idle, question-free, setup-complete conversation; otherwise route it to Front Door. Do not add an LLM classifier to recover this micro-optimization.

## 8. Image cards and Live Mini

Cards-ready markers are a durable signal, not send ownership. Front Door and watchdog both submit the same validated logical group intent, whose uniqueness is enforced in the outbox. Never dedupe on filename substring. Preserve exact expected card count, ordering and cards metadata; missing files must not shift metadata indexes. Failed/unknown sends are distinct from successfully presented cards. Intentional resend requires a new action key.

Card metadata retains existing title/details/known price/price qualifier/original direct URL. Added reactions on any emoji request those same details; removals are not new selections. Preserve real removal/target identity only if the locked SDK actually exposes it. An ambiguous target asks one focused question instead of guessing a card. No card reaction is a booking/purchase permission.

Live Mini stays optional. The host stores cards, not task execution. All initial task-card sends use one canonical claim → durable bridge outbox → provider send → host settlement protocol. A raw `--app-url` remains for independent static/arbitrary app URLs, not a bypass around task-card ownership. Subsequent progress updates change host JSON at the same full view URL without Spectrum edits/resends. Unknown send outcomes retain occupancy.

Missing Blob object: create-only conditional write. Existing object: require the version validator from that same read. An existing object without a usable validator fails closed. A creation conflict or version conflict triggers a bounded reread/retry of a side-effect-free store transaction. Never strip `W/` merely to invent a strong validator. Prefer the supported official SDK with a pinned, build-tested dependency.

Milestone revision/idempotency conflicts are surfaced; they are not fixed by assigning old content a new revision or request ID. Capture the previous full access URL before an operation, compare before writing private helper context, and preserve it on failure. Explicit signing-secret rotation is a separate authorized operation, not normal progress.

## 9. Setup, migration and lifecycle

Keep mandatory core bots + Moonshine and the no-secret-pasting setup. Make each step verify/reuse its existing recorded resource, checkpoint, and resume safely. The primary bot may use existing native tools to create/configure resources only within the user's setup authorization. Do not invent a Grok API or assume a connector can reveal secret values that its schema doesn't provide.

Never `cp .env.example .env` over an existing file. Never regex-replace instance IDs throughout tracked source. Preserve existing secrets, bot IDs, webhook URLs, line bindings and installed data. Do not rotate signing/project tokens to make a rerun easier. Configure Live Mini only under an explicit feature-enable authorization that covers provisioning; a working Vercel connector alone is not that authorization. Do not add a long questionnaire.

Legacy JSON migration is an explicit offline operation on a copy first. It must import inbox/batches/wakes, handled IDs, outbox including uncertain attempts, poll/session/presentation mappings and onboarding status with provenance. Imported already-handled IDs without complete records are not automatically replayed. Old `queued` records with a possible historical dispatch must be classified conservatively; absence of a receipt is not proof of non-delivery. Unresolved ambiguous records are reported, not silently sent or dropped.

No dual-write transition. Verify old writer processes are stopped before actual cutover. Keep immutable pre-migration backup outside Git. Once the new sender has produced external effects, restoring the old pre-send queue could duplicate messages; prefer rolling back code with compatible new state. Restoring an old data snapshot requires reconciliation of every newer send.

Keep resources under the VM's supported durable workspace, including necessary runtime/model artifacts or a verified reinstall path. Files surviving recovery does not prove arbitrary daemon processes survive it. Build a restart/preflight runbook, singleton protection, health and recoverability, and clearly record unverified VM hibernation/startup guarantees. No external host migration as a surprise fix.

## 10. Privacy retention and evidence

Proposed implementation defaults: resolved message bodies/original assets 30 days; unneeded intermediate audio/conversion files 7 days; redacted logs bounded by time and size. Keep active work, unresolved deliveries, required option mappings and backups under explicit policy; retain minimal dedupe/idempotency tombstones rather than replaying old inputs after body deletion. These are proposed product defaults, not claims about current behavior. Implement preview/export/delete/prune with tests; no live cleanup in this coding task.

List every old generated-file consumer and migrate it. Tests must never silently fall back to production defaults. Keep historical evidence dated; generate new evidence only for the SHA actually tested. Required closure is code + a regression + integrated test evidence, not a prose rule declaring a defect fixed.
