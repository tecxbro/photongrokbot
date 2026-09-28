# Lane 05: inbound, onboarding and native wakes

Implemented on `repair/product-05` from F1 `4122908`. Coordinator owns runtime wiring; lane 02 owns transactions and claims. This lane does not open a Spectrum connection, send messages, create routines or access a live instance.

## Exact files

- `bridge/src/inbound.ts`, `inbound.test.ts`
- `bridge/src/greeting.ts`, `greeting.test.ts`
- `bridge/src/setup-confetti.ts`, `setup-confetti.test.ts`
- `bridge/src/inbound-controller.ts`, `inbound-controller.test.ts`
- `bridge/src/onboarding.ts`
- `bridge/src/wake-dispatcher.ts`, `wake-dispatcher.test.ts`
- `bridge/src/inbound-process.test.ts`
- This handoff.

Code commits before this handoff: `fe10844`, `bf29206`, `8c126fe`. Required coordinator/state APIs: per-destination `formBatches`, expired-claim recovery, `claimWake(at?, excludedBatchIds?)`, poll identity fields, and transactionally reserved onboarding.

## Coordinator integration contract

`InboundController.receive(space, message)` is synchronous. It returns `ignored` with a fixed reason, or `accepted` with `result`, normalized `record`, original `destination`, and optional `mediaReference`/`readableContent`. Authorization and origin checks precede any bridge-controlled media read. Successful `store.accept` precedes the return. Runtime may then notify media, best-effort mark read without awaiting it, and notify outbound processing. The controller never reads attachment bytes, sends a reaction or issues native handoff.

The input boundary accepts the full unknown SDK content union and copies supported fields after local narrowing. Existing sender-authorized DM/group scope is preserved. `space.phone` is required, and message/target space and line must match when supplied. No new recipients/groups are authorized.

Call `flushDue()` on the coordinator lifecycle tick. It forms immutable batches only for due conversation/line pairs; one chat cannot pull another chat forward. Call `flushAll()` after startup recovery to restore pending accepted work; call `stop()` on shutdown. Both retain continuation scheduling for store pages of 250. Pending work remains durable if shutdown ends before all pages drain.

Use synchronous `enrichInbound(record, destination)` for lane 06 option resolution before acceptance. The controller rejects enrichment that alters event ID, sender, space or line. Replies preserve the original target, poll records preserve the full provider event ID plus conservatively parsed exact poll/option identifiers, and attachment references carry original metadata.

`createWakeDispatcher({store,url,key,...})` exposes `notify`, `drain` and `stop`, with no internal recurring timer. A tick is single-flight and processes at most 32 jobs. Defaults: 10-second attempt timeout, five attempts, 1-second exponential backoff with bounded jitter up to five minutes, 60-second acknowledgement grace. Raw transports remain excluded by batch until they actually settle; four unresolved transports is the global cap. Timeout settlement never clears that exclusion, and late responses cannot overwrite it. Response streams are cancelled without reading private bodies. A fully noncooperative transport can consume a slot until it settles or the process restarts; shutdown still returns promptly after aborting logical attempts.

The native payload contains only `{batchId}`. Exactly HTTP 200 is acknowledged according to the official routine contract. Other 2xx retain bounded recovery as `WAKE_UNEXPECTED_HTTP`; 408/425/429/5xx retry with backoff; remaining non-200 responses fail permanently. HTTP acknowledgement is never a processing claim or completed task. Native workers must claim using the lane 02 command before side effects. Expired/abandoned claims are fenced by storage, while active/delegated or unknown native handoffs stay held for reconciliation.

`readOnboarding` exposes reservation, actual outbox state, provenance and `deviceObserved:false`. The deprecated independent marker writer throws. Legacy celebrated state prevents a new celebration without inventing device evidence. Only a first bare greeting is suppressed from Front Door work; first substantive/non-text input receives onboarding and remains useful work. Later greetings, acknowledgements, thanks and all reactions retain context.

## Evidence and source boundaries

Inspected installed `spectrum-ts`, `@spectrum-ts/core`, and `@spectrum-ts/imessage` 12.8.0 under the frozen lock. The vendored messages/provider references are explanatory; exact fields come from the installed package:

| Locked provider source | Verified contract |
| --- | --- |
| `@spectrum-ts/imessage/dist/index.js:279` (`spaceSchema`) | DM/group and required phone field. |
| Same file:1066,1070,1201 (`asProviderReply`, `buildMessageBase`, `buildContentMessage`) | Original target and space binding, sender, direction, timestamp, readable attachment reference. |
| Same file:1365 (`toReactionMessages`),2349 (`message.reactionAdded`) | Added reactions carry exact target and synthetic event identity. Removal is not emitted on this stream; no removal field is fabricated. |
| Same file:2127 (`buildPollOptionMessage`) | Poll event ID combines original poll ID, sender ID, option ID, selected/deselected and millisecond timestamp. Parsing is conditional on that exact shape. |
| `@spectrum-ts/core/dist/attachment-Dy4PsNVw.d.ts:533` | Message content is a union; timestamp is Date and `read()` is asynchronous. |

The [official Grok routines page](https://cursor.com/help/grok-bot/routines) was read during this repair. It specifies POST with bearer key and optional JSON; HTTP 200 starts a run without proving completion. It does not expose the native routine-create schema, so setup must inspect that actual tool schema before authorized provisioning.

The [official Photon index](https://photon.codes/docs/llms.txt) was read and requires consistent Stable/Beta selection. Its linked Stable index was inaccessible through the available fetch tool; this did not justify inventing SDK fields or mixing Beta. Locked source and repository references establish the inbound implementation. SDK-internal pre-delivery target/vCard reads are outside the bridge receiver's authorization ordering; the bridge never performs its own byte read before authorization/commit.

## Finding closure and regression evidence

| Finding / matrix | Lane result |
| --- | --- |
| DAT-02 / D02,D03 | Atomic acceptance and batch/wake creation use canonical store; real child processes killed before/after commit replay to one record, membership and onboarding operation. |
| UX-01 / U01–U05 | First hi has one logical confetti greeting; first question/non-text is retained; unauthorized/echo/receipt causes no state/read; replay/unknown preserves identity. |
| UX-02 / U06,U07 | Contextual okay/yeah/thanks and mixed reaction greetings reach Front Door. |
| CTX-01 / U08 | Original replies, poll IDs, attachment metadata, authorized existing group scope, conversation/line isolation preserved. |
| REL-02 / W01–W03 | Bounded durable wake, exact payload, credential-safe diagnostics, exact-200 ack distinct from claim, no duplicate physical request while aborted transport remains unresolved. Three separate dispatch processes claim one job. |
| OPS-01 / W04 | No controller timers; stopped receiver rejects new work, pending work persists, dispatcher abort/join is bounded. Runtime typing/one-Spectrum-owner remains coordinator integration scope. |
| C01–C04 / D04 | Canonical store owns claim contention, fencing, ambiguous handoff retention and corrupt-state refusal. This lane tests expired claim fencing and suppression of active/unknown re-wakes; broader claim/migration tests remain lane 02. |

Fresh command from repository root:

```sh
PHOTON_TEST_MODE=1 PHOTON_INSTANCE_DIR=/private/tmp/photon-lane05-import-guard /Users/darshan/Downloads/photongrokbot-product-repair/.repair-tools/node_modules/.bin/bun test bridge/src/inbound.test.ts bridge/src/greeting.test.ts bridge/src/setup-confetti.test.ts bridge/src/inbound-controller.test.ts bridge/src/wake-dispatcher.test.ts bridge/src/inbound-process.test.ts
```

Result: **43 tests passed, 185 assertions, zero failures**. Every durable fixture creates a unique private realpath temporary root; child fault hooks require explicit test mode. Mock transports never make network requests. The ignored-abort regression was also run against the previous dispatcher: it failed with five underlying calls; restoring the fix passed with one.

`bun run typecheck` in this isolated lane still reports 16 legacy import errors in untouched runtime/enqueue/old outbound tests, with no lane 05 errors. Coordinator must verify the integrated branch after the other owned replacements; this lane does not claim that its isolated full-tree typecheck passed.

## Unverified provider/device gates

- Actual native routine-create schema, live configured webhook origin/key, VM lifecycle and host process resume behavior.
- Native fetch cancellation behavior on the deployment runtime; the local noncooperative mock establishes safe bounded fallback only.
- Real provider event delivery/redelivery and read-receipt behavior, original reply/poll reaction mapping on devices, and phone-line allocation.
- Provider acceptance and physical confetti observation. Local queue/accepted fixtures are never device evidence.

Recovery uses the same batch, claim and onboarding identities. Never create a fresh celebration or native handoff merely because its outcome is unknown. Stop the runtime and follow the coordinator deployment/rollback runbook before switching code/state; do not restore old writable JSON queues.
