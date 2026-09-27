---
name: dot-matrix-mini-app
description: Convert photos, illustrations, or video references into monochrome Canvas dot-matrix visuals and compact character/progress cards. Use for physical-dot image conversion, reference-derived animation, seamless loops, and reversible tap transitions, not ordinary progress reporting or messaging/backend deployment.
---

# Dot Matrix Mini App

Create recognizable images or moving characters **from the dots themselves**. Preserve negative-space eyes where the subject has them. A field of dots behind an illustration does not satisfy this design.

## Start from the requested scope

For a **photo or still illustration**, read [photo-to-matrix conversion](references/photo-to-matrix.md). Default to a static dot representation unless animation is requested; one photo does not provide a motion sequence. Use the generic renderer, not the bundled Grokbot face or eye motion.

For another card like the established Grokbot design, use the bundled working starter. For an existing app, inspect its renderer and state flow first and adapt the relevant pieces without replacing the app. An image-only or character-only request should not acquire the progress card's footer, controls, or backend.

Create a standalone copy in a new directory:

```sh
python3 <skill-directory>/scripts/scaffold.py <destination-directory>
```

Open its `index.html` directly, or serve that directory locally. `compare.html` provides A/B transitions. The starter includes the measured Grokbot motion and needs no video, network request, build step, or original workspace. Read [the starter contract](references/card-contract.md) when adapting layout, data, or transitions.

For a **video reference**, read [reference motion and loop extraction](references/reference-motion.md). Reuse the renderer and interaction system, but derive new animation data and loop boundaries. Do not reuse Grokbot's resolution or timestamps as findings about another character.

## Established design defaults

These are the approved Grokbot-card defaults, not restrictions on explicit user changes:

- A 300×240 card; a 14×14 square matrix drawn at 168×168, centered horizontally with a 5px top inset.
- Monochrome circles on near-black navy. Dot diameter is 70% of pitch; inactive dots remain visible. No character image overlay, glow, gradient, or spatial blur.
- Start in progress view. Tap/click/Enter/Space selects the character; repeat to return. No timed view changes or tap-to-pause behavior.
- A, coordinated center-out brightness morph, is preferred. B, simultaneous dissolve, remains an optional comparison. Keep comparison labels and development controls outside the card.
- Progress shows the latest three supplied activities vertically: current bright at the bottom, preceding rows smaller and faded above. Character view retains only current activity and exact count on the same baseline. No header image or horizontal stage stepper.

The included 41/100 and activity history are **demo fixture data**. For real task content, replace them with supplied facts; never infer work from elapsed animation time. Counts need not equal the physical number of dots.

## Motion invariants

Keep three independent concerns: confirmed task data, selected view/transition state, and character playback phase. Updating one must not reset another.

- Dot centers and radii remain fixed between views. Morph cell intensity, not dot position or size.
- Preserve displayed intensity **and velocity** when a tap interrupts a transition. Hold character phase during the morph; resume the same phase afterward.
- Apply confirmed progress with a short monotonic fill. Do not replay flashing reveals or invent continuous progress.
- Honor reduced motion with immediate view changes and a static character pose.
- A seamless loop needs matching **pose and motion**, especially eyes. Replaying the entire input video or fading mismatched endpoints can look like a restart even when every brightness value is continuous. Find the source's actual repeated cycle before adding a transition.

## Verify and deliver

For a still photo, compare the source crop and dot reconstruction at the intended display size; record which candidate sizes lost identifying details and which first retained them. Do not report animation checks for a static output.

When using the card starter, run its numerical checks with `node --test dev/tap-core.test.mjs`. Its source-cycle regression describes the bundled Grokbot; replace that fixture when changing the character rather than forcing unrelated footage into its timestamps.

Exercise actual card clicks, keyboard toggles, rapid reversals, and task updates while the character is visible. Verify latest counts on return, fixed dot geometry, and legible unclipped activity text at actual card size. Inspect both the clean animation and source-only character comparisons when deriving new motion.

For loop changes, render at least four uninterrupted cycles and inspect the joins at normal speed and frame-by-frame. Check 30/60/120fps playback, eye openings, gaze direction, and movement speed across the boundary; brightness continuity alone is insufficient. Keep source pauses that express the reference's timing, but do not append an endpoint hold.

Deliver the runnable local prototype, relevant captures, and a brief account of the tested resolution/loop choice. Keep backend integration, messaging, deployment, and new task orchestration outside the local prototype unless explicitly requested.
