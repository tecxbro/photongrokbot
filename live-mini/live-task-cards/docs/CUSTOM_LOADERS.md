# Personal dot-matrix loaders — explicit requests only

Grokbot remains the default. A user may explicitly ask to replace their character with a dot-matrix version of a supplied photo, illustration or video, or ask to reset it to Grokbot. Receiving a photo, describing a photo, opening a card, or starting a task is not a customization request. This is a separate operation from task progress.

## Skill and generation

The complete portable skill is in `skills/dot-matrix-mini-app/`: `SKILL.md`, photo/video references, the scaffold script, starter assets and its numerical tests. Install the whole directory into the actual Grokbot executor's supported skill location, or explicitly load its entrypoint and referenced files there. This archive does not assume a particular executor or skill-discovery path. Python 3 runs the scaffold; actual photo/video conversion may need the executor's existing image/video tools. This host itself performs no image generation and starts no model or messaging connection.

On an explicit customization request:

1. Resolve the requester and original attachment through the existing trusted executor. Keep the original photo private; do not upload it to the card host or package it as a public asset.
2. Read the bundled skill and `references/photo-to-matrix.md` (or `references/reference-motion.md` for a video). Inspect the supplied image before conversion. Derive recognizable dot states from that subject, preserving aspect ratio and important negative spaces. Try suitable grids at the real 168 × 168 character display size; the host accepts 8–32 columns and rows, including rectangular grids. If the subject cannot read clearly within those bounds, explain the limit and keep the previous loader.
3. A dot-matrix portrait request defaults to a still. An animated-loader request authorizes authored motion; do not describe motion invented from a photo as extracted source motion. Use the user's requested movement, or resolve a meaningful ambiguity. Never substitute Grokbot's face or motion for an unrelated subject.
4. Export a data-only asset in the format below. Compare the source crop and result at actual card size. For animation, inspect at least four cycles, including joins, at normal speed and frame by frame; verify 30/60/120fps behavior. Matching boundary poses are validated automatically, but smooth velocity, recognizability and eye behavior still require the skill's visual checks.
5. Validate with `node scripts/prepare-loader.mjs draft.json validated.json`. The destination must be new. This validates and saves a local file only; it does not select or publish it.
6. Through the existing runtime, read the owner's current preference and call `setLoader` using the original explicit request context. Keep the prior preference if preparation or validation fails. Do not request an additional confirmation when the original request already clearly authorized replacement.

The skill's standalone starter is a generation/inspection aid. Do not replace this package's shared card with the starter: preserve its current task plan, weighted estimates, dark/light palette, size, keyboard/tap behavior and stable URL. The bundled skill's older activity-history examples are fixtures, not overrides of this package's task-card contract.

## Data-only asset format

Static:

```js
{ name: 'My portrait', kind: 'static', columns: 16, rows: 20,
  cells: '...' } // Exactly 320 row-major digits, each 0–4.
```

Animation:

```js
{ name: 'My animated portrait', kind: 'animation', columns: 16, rows: 20,
  duration: 2,
  frames: [[0, '...'], [1, '...'], [2, '...']] }
```

Every frame has `columns * rows` digits. Quantize skill-generated intensities in 0–1 using `Math.round(value * 4)`. Animation times are seconds, strictly increasing from zero through `duration` (0.1–30 seconds); the last pose must equal the first. Use 3–240 frames with no extra endpoint hold. A static asset has only `cells`, no synthetic duration. Maximum normalized asset size is 128 KiB; the loader write endpoint accepts at most 192 KiB. JavaScript, HTML, image URLs, arbitrary colors, source images and extra fields are rejected. Names are plain display text, at most 40 characters.

`examples/loader-static.json` and `examples/loader-animation.json` are explicitly synthetic demonstration assets, not conversions of a user's photo. The publisher validates again even if local preparation was skipped.

## Runtime wiring and request authorization

Pass two callbacks when attaching the existing runtime:

```js
const liveCards = attachLiveTaskCards({
  app, baseUrl, publisherToken,
  resolveOwner: async (space, context) => {
    // Implement using the ACTUAL trusted executor task/recipient context.
    // Return one stable opaque user key, scoped to this setup.
    return trustedTaskOwner(space, context);
  },
  authorizeLoaderChange: async (space, context) => {
    // Verify the ORIGINAL explicit request and attachment/requester binding.
    // Return null for a photo alone, ordinary task updates or untrusted tool claims.
    return trustedExplicitLoaderRequest(space, context);
    // On success: { action: 'replace' | 'reset', requestId: 'stable-request-event-id' }
  },
});
```

The two `trusted...` names above are integration placeholders, not pre-existing Grokbot functions. Locate the actual executor and implement these callbacks at its trusted boundary. Do not replace them with a constant `true`, a model-supplied `explicit: true`, image metadata, a photo caption, or a guessed sender. Ensure the request author is the resolved owner. For a shared/group Space, bind the task owner explicitly; the conversation ID is not a user ID. Unresolvable ownership must fail closed.

The runtime rejects personalization when either required hook is missing. Ordinary cards without the hooks continue using Grokbot. Once owner-bound cards exist, their read/update/sync operations require the same owner resolver and context, including after a restart.

```js
// context comes from the trusted executor, not the model-generated asset.
const preference = await liveCards.getLoader(originalSpace, context);
await liveCards.setLoader({ asset: validatedAsset, expectedRevision: preference.revision }, originalSpace, context);

// Only for an explicit reset request, whose callback returns action: 'reset':
const current = await liveCards.getLoader(originalSpace, resetContext);
await liveCards.resetLoader({ expectedRevision: current.revision }, originalSpace, resetContext);

// Normal task operations bind ownership through resolveOwner:
const started = await liveCards.start(createPayload, originalSpace, taskContext);
const latest = await liveCards.get(started.record.id, originalSpace, taskContext);
await liveCards.update(latest.id, { requestId: milestoneId, expectedRevision: latest.revision, content }, originalSpace, taskContext);
```

Do not pass `ownerRef`, action or request ID through the generated `setLoader` tool payload: the runtime derives them from the hooks. Use the same verified request ID, revision and asset to reconcile a lost response. A different customization with a stale preference revision is rejected. The host trusts its publisher credential; the callbacks provide user-request authorization. This does not turn the single-setup host into a multi-tenant authorization service.

## Saved behavior

A successful replacement/reset is atomic. It saves the owner's preference and changes only that owner's active, owner-bound cards, incrementing their revisions. Future cards inherit the saved choice. Existing URLs, content, stage clocks, messaging sessions and selected views are preserved; no Spectrum send/edit or deployment occurs. Explicitly replacing an asset resets that character's playback phase; ordinary progress/theme updates do not. Grid dimensions remain fixed between the task/character views for each chosen asset. Reduced motion shows a static pose.

Completed, failed, cancelled and archived cards keep their last loader. Cards created before owner binding also retain Grokbot; no guessed migration is performed. Read links expose only the selected dot asset, never the owner reference, other users' preferences or original photo. As with existing task status, anyone holding a card's read link can view its dot portrait.

The existing file/Redis registry stores preferences and content-addressed assets. Shared assets are deduplicated. Unreferenced assets are removed after replacement or historical pruning, while saved preferences and retained cards keep theirs. The original 3 MB registry bound still applies; there are at most 100 saved owner preferences in this small host. Exhaustion fails without changing the previous choice. Reset clears the selected asset but retains the preference revision for retry protection.

## Installation acceptance

Verify in the actual runtime: a plain photo does nothing; an explicit request selects a prepared loader; another user's cards remain unchanged; active cards refresh at the same URL; new cards inherit it after restart; reset restores Grokbot; terminal history is unchanged. Test one expressly authorized device conversation. Report host acceptance, runtime wiring and physical iPhone rendering separately.
