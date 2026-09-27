# Implemented publishing API

This API belongs to this package. These are not names of existing Photon or Grokbot endpoints.

All requests use the configured host origin. JSON writes require `Content-Type: application/json`, at most 16 KiB (192 KiB only for the loader-preference PUT), and `Authorization: Bearer <PUBLISHER_TOKEN>`. The writer credential stays in trusted server-side code. Unknown fields are rejected.

## Operations

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Public process health; does not imply storage/device readiness |
| GET | `/api/doctor` | Authenticated storage/occupancy check |
| GET | `/api/slots` | Exactly ten slots with current assignment information |
| POST | `/api/cards` | Create once, atomically assign a free slot |
| GET | `/api/cards/:id` | Trusted publisher's complete record |
| PUT | `/api/cards/:id` | Replace display content using a matching revision |
| POST | `/api/cards/:id/presentation/begin` | Claim the one initial Spectrum send |
| POST | `/api/cards/:id/presentation/settle` | Save/reconcile that exact provider outcome |
| POST | `/api/cards/:id/release` | Release a terminal assignment after the initial send is reconciled |
| POST | `/api/cards/:id/discard` | Release a never-presented draft without an uncertain send |
| GET | `/:slot/:id?k=:readKey` | Stable card page; read-only capability |
| GET | `/api/view/:slot/:id` | Display-only JSON, using the read key as a Bearer token |

New URLs omit `r`; previously sent URLs containing `r` remain readable. The page always reads the latest available record for that same ID. The read key is independent of content revision, so older messages can reopen current state. Slot-only URLs such as `/live-3` are never public card identities.

## Create

`examples/research.json`, `checks.json`, `stages.json`, and `matrix.json` are complete examples. Replace the illustrative task, request and conversation values with runtime-issued values. A create request is:

All example display names, stage labels, units and measurements are illustrative too. The renderer reads them from `content`; no title is tied to a template. Grokbot chooses the reusable layout using `SKILL.md`, then supplies the real task's content as JSON. Only the supported template/status identifiers and shared design are fixed. The authorized runtime provides `conversationRef`; it is not a model-selected recipient.

```json
{
  "requestId": "unique-create-request",
  "taskId": "unique-existing-task",
  "conversationRef": "actual-authorized-space-id",
  "content": {
    "template": "dots",
    "eyebrow": "TASK",
    "title": "Research market",
    "subtitle": "Sourcing · verifying · analysis",
    "status": "running",
    "header": "none",
    "stages": [
      { "id": "source", "label": "Source", "state": "done" },
      { "id": "verify", "label": "Verify", "state": "active" },
      { "id": "analyze", "label": "Analyze", "state": "pending" },
      { "id": "report", "label": "Report", "state": "pending" }
    ],
    "detail": { "title": "Verifying", "subtitle": "Company profiles" },
    "progress": { "completed": 27, "total": 50, "unit": "profiles verified" }
  }
}
```

Repeating the same `requestId` with the same normalized content returns the retained original record. Reusing it for different content returns `IDEMPOTENCY_CONFLICT`. Another create key for the same retained task/conversation returns `TASK_ALREADY_HAS_CARD`. Do not use creation to update an existing card.

Returned `viewUrl` is a scoped read capability. Internal IDs and URLs should remain in the task/runtime context rather than being printed alongside the user-facing card.

## Update

Use PUT with a complete `content` object, a unique request ID, and the current content revision:

```js
const record = await client.get(cardId);
const content = structuredClone(record.content);
content.progress.completed = 34; // Actual verified count, not simulated progress.

const updated = await client.update(cardId, {
  requestId: 'research-progress-002',
  expectedRevision: record.revision,
  content,
});
```

The existing shared runtime calls the same write through `liveCards.update`:

```js
await liveCards.update(cardId, {
  requestId: 'research-progress-002',
  expectedRevision: record.revision,
  content,
}, originalAuthorizedSpace);
```

Do not call both for the same logical write with different request IDs. A matching retry is safe; a stale unrelated update gets `REVISION_CONFLICT`. Confirmed content writes remain allowed during an unresolved initial send. The send attempt itself cannot be repeated until reconciled. Each milestone is one full snapshot and one state write; browser animation and polling cause no writes.
To honor a light-mode request for an active card, use the same update operation with `{ ...record.content, theme: "light" }`. The exact `viewUrl` remains unchanged. Terminal content remains immutable, including its final theme.

The selected `template` stays fixed for the card; a different template requires a new task card.

## Content validation

`template`: `dots`, `segments`, `stages`, `matrix`. `theme`: `dark` (default) or `light`, selected on user request. `header`: `none`, `study`, `hands` (legacy compatibility; new cards use `none` and artwork is not rendered). `status`: `queued`, `running`, `waiting`, `completed`, `failed`, `cancelled`. Stage state: `pending`, `active`, `done`, `blocked`.

There are 2–10 matrix stages (2–4 for other layouts) with unique IDs and labels up to 12 characters. `running` has exactly one active stage; other statuses have none. `queued` has only pending stages. `completed` has all done stages and no incomplete measurement. One blocked marker is allowed for waiting/failure/cancellation.

Title is at most 40 characters (recommend 26 or fewer). Subtitle is at most 65. Detail title is at most 24; detail subtitle at most 50. Strings are plain text, escaped during rendering. No HTML, URLs, custom colors, CSS, JavaScript, actions or callback fields are accepted; `theme` only selects an approved palette.

`progress` is null or `{completed, total, unit}`. Integers satisfy `0 <= completed <= total <= 1,000,000`, with positive total and a named unit. There is no arbitrary `percentage` field.

`matrix` normally uses `workflow` with `progress: null` and `activityPlan`. Supply one plan entry for each of the 2–10 stages, in identical order: `{stageId, icon, label}`. `stageId` must match the associated stage ID; labels are plain text up to 50 characters. The renderer filters out done stages and shows the first three remaining steps: current at the bottom, upcoming above, with no visible prefixes. Completed stages must form a prefix, with the current/blocked stage first among unfinished work. An active plan must have unfinished work. Terminal states show only the confirmed outcome from `detail.title`.

Supported icon keys and selection rules are in `docs/ICONS.md`. Do not send custom SVG, URLs or invented keys. `activityHistory` remains accepted only for legacy saved cards (1–3 `{icon,label}` entries, last current); do not combine it with `activityPlan` or reinterpret previous work as future steps. New cards must use the plan field.

## Estimated workflow contract

Set `progress: null` and supply the full budget, matching stage IDs in order:

```json
"workflow": {
  "weights": [
    {"stageId":"source", "weight":20, "paceSeconds":60},
    {"stageId":"verify", "weight":30, "paceSeconds":90},
    {"stageId":"analyze", "weight":25, "paceSeconds":60},
    {"stageId":"report", "weight":15, "paceSeconds":45},
    {"stageId":"deliver", "weight":10, "paceSeconds":20}
  ]
}
```

Weights are integers 1–100 and sum to 100. Pacing is integer seconds 1–86400 (default 60), describing visual easing, not a deadline. The display begins at the sum of confirmed completed-stage weights and eases to the active stage endpoint minus `max(1, ceil(weight * 0.1))`, capped at 99. Only `status: "completed"` with every stage done renders 100. The counter is an overall estimate, not a measured item count.

Read responses include server-owned `workflowTiming: {stageId, elapsedMs, resumedAt}`. Do not submit this field in create/update payloads. Elapsed time is preserved on same-stage writes, frozen while waiting/failed/cancelled, resumed when running, and reset when advancing to a new stage. Reopening reads this clock instead of restarting the animation. Changing budgets/pacing or progress mode, or reverting a confirmed done stage, returns `WORKFLOW_CONFLICT`. Send full content with the same workflow configuration and fresh revision/request ID on each milestone. No per-dot writes are required.

The measured `progress` contract remains valid for older matrix cards and the other layouts. Never combine it with `workflow` or reinterpret actual item counts as workflow percentages.

## Provider presentation ledger

The supplied runtime helper handles these calls. They do not call Photon themselves.

Begin body: `{ "revision": 1 }`. A new claim returns its `attempt.id`, `kind: "send"`, and the revision at claim time. Once the initial message reference is accepted, later begin calls return `skipped: true`. Another in-flight or unknown initial send blocks duplicate dispatch; it is not silently timed out or stolen.

Settlement body:

```json
{
  "attemptId": "actual-attempt-id",
  "outcome": "accepted",
  "messageRef": "actual-original-provider-message-id"
}
```

Outcomes are `accepted`, `not_applied`, or `unknown`. `not_applied` requires evidence that the provider operation did not happen; a timeout is not that evidence. `unknown` retains the attempt and slot. After checking the original provider/runtime result, settle the same attempt as accepted or not applied. Do not issue a new send to discover what happened.

The host stores only the opaque reference from the one initial send. State updates do not require the original SDK message object or a provider edit.

## Release, discard and history

Release body: `{ "expectedRevision": 3 }`. The task must be terminal, no initial send may be pending, and the initial message reference must be accepted or reconciled. The helper releases automatically after a terminal update when the send is settled; a later `sync()` releases a terminal card whose initial send was reconciled afterward.

Discard body: `{}`. It only applies to a draft with no accepted message and no unresolved send. Discarding a draft does not cancel the real underlying task.

Historical records expire under the explicit configured retention policy. Idempotent retry lookup is bounded by retained history; do not replay month-old creation requests as new work. Old URLs are never reassigned, even after history pruning.

## Errors and evidence

HTTP errors have `{ "error": { "code", "message" } }`. Authentication failure is 401, missing/unavailable card 404, stale/occupied/conflicting state 409, invalid input 400, oversized body 413, storage/configuration trouble 503.

A returned card record proves stored state. A settled presentation records trusted runtime-reported provider acceptance. Neither constitutes physical-device evidence.

## Personal loader preferences

`GET /api/loader-preference?ownerRef=<encoded-owner>` returns `{revision, loader}`; an unset owner returns revision 0 and loader null. `PUT /api/loader-preference` takes `{ownerRef, requestId, expectedRevision, action, asset?}`. `action` is `replace` with a validated asset or `reset` without one. Both require the publisher token; public card read capabilities cannot access these operations. The existing executor must verify explicit user intent before making the write. The optional runtime hooks enforce this boundary; see `CUSTOM_LOADERS.md`.

Create optionally accepts trusted `ownerRef`; the runtime supplies it from its resolver and rejects model-supplied values. It is immutable for that card and never appears in the public view. A successful preference write bumps revisions for that owner's active cards without changing task content or clocks. Concurrent milestone writers must re-read after `REVISION_CONFLICT`. The public view includes only `loader: null` for Grokbot or the selected asset with its content-addressed `id`. Terminal/archived cards retain their selected asset. Preferences and assets are optional additive fields in schema 1; older state reads normally. Do not roll back to an older writer after saving custom-loader records without a compatibility review.
