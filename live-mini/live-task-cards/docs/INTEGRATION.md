# Grokbot milestone publishing

This package owns card state and the one-time Spectrum send. The task executor must supply confirmed facts; the card never infers completed work from elapsed time, animation, or a polling read. Register the adapter in the existing trusted Grokbot runtime, using its authorized `Space` and already installed Spectrum `app` builder. This checkout does not include that running executor.

```js
import { app } from 'spectrum-ts';
import { attachLiveTaskCards } from './live-task-cards/examples/existing-runtime.mjs';

const liveCards = attachLiveTaskCards({
  app,
  baseUrl: process.env.LIVE_CARDS_BASE_URL,
  publisherToken: process.env.LIVE_CARDS_PUBLISHER_TOKEN,
});
```

`start(createRequest, originalAuthorizedSpace)` creates the stable card identity and sends `app(viewUrl, { live: true })` once. Persist the returned card ID and revision with the existing task. A retry uses the same create `requestId`; an uncertain initial send remains claimed until its real outcome is reconciled. Never send a replacement to discover the outcome.

## Publish milestones, animate the estimate locally

New matrix cards use `activityPlan`, `progress: null`, and `workflow.weights`. Grokbot chooses meaningful stage names/icons and relative weights based on expected effort; the weights sum to 100 across the entire workflow. Larger phases get larger portions. Pacing controls how gradually each portion fills. It is a visual estimate, not evidence that individual items finished. Use `docs/ICONS.md` and the complete five-stage `examples/matrix.json`.

After verification actually finishes and analysis actually starts, read the current record and publish one snapshot:

```js
const record = await liveCards.get(cardId, originalAuthorizedSpace, taskContext);
const content = structuredClone(record.content);
content.stages = content.stages.map(stage => ({
  ...stage,
  state: ['source', 'verify'].includes(stage.id) ? 'done'
    : stage.id === 'analyze' ? 'active' : 'pending',
}));
content.detail = { title: 'Analyzing findings', subtitle: 'Comparing verified profiles' };
await liveCards.update(cardId, {
  requestId: milestoneEvent.id,
  expectedRevision: record.revision,
  content,
}, originalAuthorizedSpace, taskContext);
```

Keep the workflow budget and plan identity unchanged. The host records the new stage clock. The page polls while visible (normally every 10 seconds), sees the milestone, moves Verify out and Analyze down into the current position, and unlocks the new weighted range. No Spectrum send/edit or new URL is involved.

For weights 20/30/25/15/10: Verify animates from 20 toward 47 and holds there until confirmation. Analyze unlocks at 50 and fills toward 72. Later ranges hold at 88 and 99. Only confirmed delivery and final completion reach 100. The frontend uses a cubic ease-out within the range; it never advances the task, makes network writes or calls Grokbot for each dot. Early milestones move smoothly to the next boundary; late work holds at its cap with the thinking shimmer. The counter is visibly approximate (`~47 / 100`) and its accessible label says estimated workflow progress.

The server-owned elapsed clock survives updates/reopening, pauses while waiting and stops on failure/cancellation. A failed or cancelled task cannot visually reach 100. All saved stage advancement must come from real execution evidence; UI animation is never that evidence. Frozen terminal records and slot reuse follow the existing lifecycle.

The current/upcoming rows retain stable stage IDs, the bright current label at the bottom and faded upcoming labels above. There are no visible Now/Next/Later prefixes. Row motion/scaling takes 560ms, opacity 420ms, with reduced-motion support. Only three steps are visible even when the plan has up to ten.

The standalone demo uses accelerated six-second pacing and **Confirm** buttons outside the card to simulate Grokbot milestones. It demonstrates automatic filling, holding and manually unlocking the next range. Real saved-card routes never import the demo controls.

Legacy measured cards still use explicit `progress` values, updated only from confirmed counts. The estimated workflow mode is selected at creation and cannot be substituted for an existing card's measured facts.

The executor registration point must be verified in the deployed Grokbot checkout before wiring. The available `grokbotonimessage/main` repository contains a Photon feature runtime, but its own `AGENTS.md` says the Grok orchestrator and workers are external. Its `runtime/core/executor.ts` runs reserved Photon feature operations, so it is not a verified source of Grokbot task milestones. Identify the actual Grok executor repository and task event source before editing it.

## Evidence and delivery

The host stores a provider message reference and the initial send attempt ledger; it does not need a retained SDK message object for progress updates. An accepted Spectrum send does not prove display on a physical iPhone. Verify the open card, reopening, and collapsed Messages card on the intended device separately.

## Optional personal loaders

Bundle/install `skills/dot-matrix-mini-app` and wire the explicit-request hooks in `CUSTOM_LOADERS.md`. This is opt-in per owner. Photo receipt alone never calls personalization. Use the trusted task context for owner-bound `start`, `get`, `update` and `sync` calls.
