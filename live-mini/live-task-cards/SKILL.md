---
name: live-task-cards
metadata:
  version: 1.0.0
description: Publish and update a read-only Photon task-progress card using supplied templates and the existing messaging runtime. Never regenerate its page for ordinary task updates.
---

# Live Task Cards: Grokbot operating skill

## Optional personal dot-matrix loader

Only when the user explicitly asks to customize their loader, use the bundled `skills/dot-matrix-mini-app/SKILL.md` and follow `docs/CUSTOM_LOADERS.md`. A supplied photo alone, ordinary task, or card opening does not authorize a change. Convert the user's actual subject; a still portrait stays still unless animation is requested. Use authored motion only for an animated-loader request, and verify recognition and loop quality before selecting the prepared data asset.

Use the trusted runtime's `getLoader`, `setLoader` and `resetLoader` operations with the original request context. The runtime must resolve the owner and verify the explicit request. Never guess ownership, change the shared Grokbot asset, or accept a model-provided permission flag. Preserve task data, palettes, layout and stable URLs. The choice persists for that owner's active and future cards; terminal cards retain their final appearance. Reset to Grokbot only on request. Follow the supplied skill for artwork generation only; this package's current card contract governs integration and progress.

## When to use a card

Use one card for a substantial user-requested task with meaningful stages or a measurable batch: researching many companies, building a project, investigating a repository, processing files, or preparing a report. Require actual progress evidence and an available slot. Ordinary questions, greetings, quick answers, acknowledgements, and work already finished stay in text.

A card observes the existing task. Do not create another bot, orchestrator, transcript poller or background monitoring routine. Multiple workers contribute to the same task card through its existing owner. Do not send one card per worker.

V1 is read-only. No approval, purchase, cancellation, retry or other button. Opening the card does nothing to the task. Ask questions and receive approvals in the existing conversation. An order/booking status is eligible only for work already authorized through that workflow.

## What to invoke

Use the installed existing-runtime hook from `examples/existing-runtime.mjs`, registered through that runtime's already-validated invocation mechanism. Its returned object has:

```js
await liveCards.start(createRequest, originalAuthorizedSpace);
await liveCards.update(cardId, updateRequest, originalAuthorizedSpace);
await liveCards.sync(cardId, originalAuthorizedSpace);
```

These are real exports in this package, not pre-existing Grokbot commands. Installation wires them once. They use the existing Spectrum `app` builder for the initial send and do not start a second messaging connection.

For page publishing/inspection only, the included CLI is:

```sh
node --env-file=.env bin/live-card.mjs create examples/research.json
node --env-file=.env bin/live-card.mjs get <card-id>
node --env-file=.env bin/live-card.mjs update <card-id> update.json
node --env-file=.env bin/live-card.mjs slots
node --env-file=.env bin/live-card.mjs doctor
```

The CLI does not send the iMessage bubble. Use the runtime hook for the initial send. Do not invent enqueue flags or assume page publication is message delivery.

## Selecting the template

The reusable designs are `dots`, `segments`, `stages`, and `matrix`. Gallery names such as “Research market”, “Fix repository”, and “Place order” are illustrative content, not a menu of supported tasks or a title-to-template lookup. Any eligible task may use any compatible design. Completed and waiting are statuses; an unknown total is `progress: null`, not another template.

Prefer `matrix` for most eligible tasks. It is the user's preferred presentation, not a research-only design. Show the current step plus up to two upcoming steps from the actual plan.

1. Default to `matrix` for a meaningful multi-step task, using weighted estimated progress for the entire workflow plus the current and upcoming steps. A real item count is not required.
2. Use `stages` with `progress: null` when the user prefers milestones without an estimate or a useful weighted plan cannot be formed.
3. Use `dots` or `segments` when the user requests them or a per-item batch/checks display materially communicates the task better. They are exceptions to the matrix preference, not equally likely defaults.

Keep the selected template for the life of that card. Choose from the task structure, never from keywords in its title, and never invent a denominator or completed work to qualify for a design.

Grokbot supplies the display content as JSON: a task-specific `title`, `theme`, optional `subtitle` and `eyebrow`, `status`, stage IDs/labels/states, current `detail`, measured `progress` or null, and `activityPlan` plus `workflow` for new matrix cards. Titles, labels, units and counts in `examples/` and `/demo/` are fixtures only; do not copy them unless they actually describe the user's task. Runtime-issued request/task IDs and the authorized conversation reference wrap this content; the model must not invent a recipient. Follow the exact schema and length limits in `docs/API.md`.

Use the shared final dark/light design and image-free renderer. Default to `content.theme: "dark"`; use `"light"` when the user asks. For an active card, copy the latest content and change only its theme through the normal update, keeping its exact URL. Terminal snapshots retain their final theme. There is no theme gesture or theme button. Set `header: "none"` for new content; legacy header fields do not display artwork. Do not generate new HTML/CSS, images, branding or a new design per task. The layout is reusable; its task content is data.

## Naming the current and upcoming steps

Derive 2–10 meaningful matrix stages (2–4 for other layouts) from the user's requested outcome and execution plan. Keep their IDs stable and short labels within 12 characters. For `matrix`, supply one `activityPlan` entry per stage, in the same order: `{stageId, icon, label}`. Use clear verb–object labels up to 50 characters, such as "Verify company profiles" or "Run integration checks". Keep the wording stable as a step moves from upcoming to current; choose icons using `docs/ICONS.md`.

The renderer shows the first unfinished step brightly at the bottom, with the next steps faded above it. Do not add visible Now/Next/Later labels. These are planned actions, not claims that future work already happened. Completed steps leave the display. Queued work remains planned, waiting shows the blocking reason, and terminal cards show the actual outcome without upcoming steps. Do not use the legacy `activityHistory` field for new cards.

When the executor confirms a step finished, mark it `done` and mark the next step `active` only when it actually starts. Save the updated stage states, detail and status together in one revision. Retain the plan's IDs/icons/labels unless the plan itself changes. If blocked, keep the blocked step and show the reason in `detail.title`; pending steps remain upcoming. Never advance the plan because a counter filled, time passed, or an animation ended. The matrix count represents the entire workflow estimate. Only confirmed completion of the promised outcome unlocks 100.

See the complete update example in `docs/INTEGRATION.md`. Icon keys are fixed supported assets; labels and stage names are task-specific data. Use `working` when no specific icon fits. Never generate new icons or invent unsupported keys per task.

## Weighted workflow progress

For new matrix cards, use `progress: null` and `workflow.weights`, one `{stageId, weight, paceSeconds}` entry per stage in the same order. Assign positive integer weights summing to 100 based on expected relative effort; larger tasks get larger ranges. Choose `paceSeconds` as a pacing estimate (default 60, range 1–86400), not a completion promise. Keep weights, pacing and stage IDs fixed for the card. Names/icons remain task-specific; see `examples/matrix.json` for the five-stage example.

Grokbot publishes at stage start/completion, blockers/resumption, and final outcome. Do not send individual-dot updates. The frontend independently eases through the active stage's range, stops short of its end (10% reserve, at least one point), and waits for the next confirmed milestone. It cannot switch stages or reach 100 from a timer. Estimated dots and the `~n / 100` label represent the whole workflow, not verified items. The host owns the stage clock, preserving elapsed time across updates/reopening and freezing it while waiting or terminal. Do not author `workflowTiming` or write animation frames back to storage.

Legacy measured cards remain supported: their explicit item counts are confirmed facts and must not be synthesized from elapsed time. Do not switch an existing real card between measured and estimated modes. An explicit design demo can be updated in place.

## Create once

Use a stable unique task ID and create request ID for this specific job. Resolve `conversationRef` from the existing authorized runtime context, not an arbitrary model-provided recipient. Select the meaningful stages and approved template/header. Creation claims an available slot from `live-1` to `live-10` atomically.

Retain the returned card ID, slot, revision and original provider message relationship in the existing task's durable context. The host records the initial send outcome; progress updates do not need the SDK message object.

## Update data

Read the current record/revision before changing it. Submit the complete desired `content` with `expectedRevision` and a fresh update `requestId`. Reuse that request ID and exact payload only when reconciling a lost response to the same operation.

Update at meaningful milestones: a new stage, a useful count increase, a blocker, or an actual terminal result. Coalesce bursts. Do not raise saved progress based on elapsed time, a spinner, a worker going quiet, a page being opened or an unconfirmed tool call. Measured cards animate toward confirmed counts. Workflow cards animate their explicitly estimated display within the current unlocked range; they never persist that estimate as confirmed work.

The runtime helper saves state. The hosted page refreshes while visible. Do not send another bubble for each milestone, rewrite source files, commit code or redeploy just to change progress.

Keep the original URL byte-for-byte unchanged, including its path and query. Updating a URL means changing the content served there, not changing the URL string: C becomes D at the same address. Never append refresh/version parameters or call Spectrum `send`/`edit` for a content update. The only Spectrum send is the initial card creation; `liveCards.update` writes the hosted JSON. Explicit design changes deploy to the same host and route.

## Complete and free the slot

Set `completed` only after the task's promised outcome actually succeeds. Every displayed stage must be done and any named counter must be complete. `failed` means final failure, not a transient retry. `waiting` is not completion.

The runtime helper saves the final revision and releases the slot once the initial send is reconciled. The old card keeps its own final read-only record. No automatic unsend. A different task gets a new card ID even when it reuses `live-3`.

If the task needs an additional ordinary reply or final artifact, use the existing conversation. This package does not send the final report itself.

## Hosting and local server cleanup

Use the existing authorized Vercel deployment for persistent card URLs. Keep each bubble's exact URL stable; update the record or publish an explicitly requested design change at that address. A local preview server or tunnel is temporary development tooling, not the completed card's host.

When starting temporary tooling, record its working directory, command, port, process ID and terminal/tool session handle in the task context. Once the task and its checks are finished, stop only the preview/dev servers and tunnels started for that task. If the user says to keep a preview open or not to stop it yet, defer cleanup until that review is finished or the user releases it. Do not stop a shared server still needed by another active task.

Prefer Ctrl-C in the recorded terminal/tool session. If that session is unavailable, verify that the recorded PID still belongs to this task's command and working directory before sending SIGTERM with `kill -TERM <verified-pid>`. See `INSTALL.md` for inspection commands. Verify that the process exited and its listener closed; report any process that could not be stopped. Never use broad `pkill node`, `killall`, or kill whichever process happens to occupy a port.

Local cleanup must leave the Vercel deployment, durable storage, final card record, and shared Spectrum/Grokbot runtime running. Completing one task releases its logical slot; it does not delete its deployment or shut down the messaging service. No local server needs to remain running solely to serve a card already hosted on Vercel.

## Errors

- `NO_SLOT_AVAILABLE`: continue the task in text. Do not create `live-11`, overwrite another card, or create another host to bypass the limit.
- `REVISION_CONFLICT`: read the current record and reconcile. Do not force a stale update over new progress.
- `PRESENTATION_PENDING`, `PRESENTATION_UNKNOWN`, or an in-flight attempt after restart: preserve occupancy. Inspect the existing runtime/provider result and settle that exact attempt; no blind resend.
- `INITIAL_SEND_NOT_RECONCILED`: terminal content is saved, but the initial send outcome still needs reconciliation before slot release. Do not silently send a replacement card.
- `provider_accepted_ack_pending`: the SDK returned acceptance but its publishing-state acknowledgment needs reconciliation. Use the returned reconciliation payload. Do not call the SDK again for that attempt.
- `STORE_UNAVAILABLE`: do not reset storage or treat it as ten empty slots.

Provider acceptance is not proof of device rendering. An HTML page loading is not proof of an in-message refresh. Report those separately.

## Boundaries

Do not broaden account permissions, disable reviews, switch providers, provision lines or create paid infrastructure under this skill. Keep the writer token and Redis credentials server-side. Read links are capabilities: anyone holding one can view its minimal card information; they do not identify the viewer or grant permission to act.
