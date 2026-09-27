# Canonical publication verification — 2026-09-26

Publication target: `https://github.com/tecxbro/live-mini-app`, release `handoff-2026-09-26`.

The dedicated publication checkout was populated from the verified 106-file handoff archive, including previously untracked implementation files. Fresh checks in this portable checkout passed: 115 package tests, 7 bundled skill tests, syntax checks for 57 packaged JavaScript modules, validation of four task examples and two loader assets, and the Vercel build. The README and handoff now identify the canonical source and require installation/production build comparison before another live card send.

This publication does not verify or change Grokbot's installed runtime, the existing Blob-backed production host, or a physical iPhone. Those environment-specific integration and migration steps remain explicit in `HANDOFF.md`.

---

# Personal loader handoff addendum — 2026-09-26

The handoff now contains the full portable dot-matrix skill and a tested opt-in preference implementation. It is ready for installation/integration, with the actual executor and device acceptance steps still required.

Grokbot remains the default. An explicit request can select a validated custom still or authored animation for that owner; a photo alone cannot. Active/future owner-bound cards inherit it at stable URLs. Reset restores Grokbot; terminal and archived cards retain their snapshot. User identity is resolved by trusted runtime callbacks, not model-supplied data.

Current local evidence: 115 package tests, 7 skill tests, browser checks across all four layouts, owner isolation, reset/reopen/history, 16 × 20 variable-grid playback, four observed loop cycles, reduced motion, and no browser JavaScript errors. The complete 15-file skill matches its installed source. Packaging includes the new runtime, data validator, examples, instructions and tests.

Installation must wire the real owner resolver and explicit-request callback and connect photo intake/generation through the bundled skill. No production deployment, live messaging or physical iPhone verification was performed for this change.

---

## Prior handoff context

# Grokbot handoff readiness — 2026-09-26

Verdict: ready to hand off for installation and integration, subject to the explicit environment/device acceptance steps in `HANDOFF.md`. It is not a claim that the running Grokbot or a Vercel host has already been connected.

## Resolved package findings

- Removed triple-tap theme switching. Dark is the default; requested light mode is saved JSON for a new/active card. Single-tap still switches the local task/Grokbot view.
- Consolidated the design contract around four layouts, final black/white palettes, no photographic headers, task-specific JSON, and stable URLs with no progress-related Spectrum send/edit.
- Updated the current test report and excluded historical browser evidence from the handoff archive.
- Added explicit-allowlist packaging plus per-file and archive SHA-256 checks. This captures current required source files even when they are untracked in the authoring repository, without distributing local state or messaging credentials.
- Fresh local checks: 101 tests passed, 45 modules and four JSON examples validated, Vercel build succeeded. A real locally saved card changed palette on polling without a URL or selected-view change.

- Unified live/demo motion with bounded dot batches, interruptible text transitions, smooth segment/stage fills, hidden-page suspension, and softer system typography. No character artwork/choreography changes.

- Matrix is the preferred whole-workflow estimate layout. Its `activityPlan` shows the current action bright at the bottom and upcoming actions faded above, without visible prefixes, keyed to stable stage IDs; legacy saved histories remain compatible. The handoff includes `docs/ICONS.md` with all six supported icons and selection rules.

- Weighted estimated progress now fills locally between confirmed milestones, holds below each stage endpoint, survives reopening/pauses using server-owned elapsed time, and only reaches 100 on actual task completion. Grokbot supplies the budget once and updates stage states at milestones.

## What Grokbot must finish at installation

1. Verify/extract the supplied archive and run its checks.
2. Identify the actual task executor and attach the adapter to its existing authorized runtime.
3. Configure the authorized Vercel project with real durable Redis storage.
4. Verify the initial card and same-URL JSON updates on the intended iPhone before calling the integration device-verified.
5. Stop task-owned temporary servers after work/review finishes; retain the hosted deployment, storage and shared bot runtime.

No Spectrum operation is part of packaging or publishing these design changes. Terminal card snapshots remain immutable; their final theme cannot be changed through ordinary progress updates.
