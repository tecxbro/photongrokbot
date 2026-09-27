# Live Task Cards

Four reusable, read-only task-progress layouts for Grokbot + Photon iMessage.

## Canonical package

This implementation is published at [tecxbro/live-mini-app](https://github.com/tecxbro/live-mini-app). Use this repository or its versioned release archive for installation. The initial `liveminiappdesign` commit `090fa77` is an older three-layout package and does not contain the matrix, dark/light themes, personal loaders, or the current state-only progress update flow.

The `handoff-2026-09-26` release includes all four layouts, weighted matrix workflow progress, requested light mode, and the complete opt-in personal-loader implementation and skill. `HANDOFF.md` describes how to connect them to the actual executor. Published source is not evidence that an existing production host or bot has been upgraded.

**Grokbot changes JSON data. It does not rewrite a website, generate an image, or redeploy a page for each update.**

## Start here

```sh
npm test
npm run check
npm run preview
```

Open `http://127.0.0.1:3000` locally. The gallery shows each layout at 300 × 300 and 300 × 240. All example progress is illustrative. This starts only a local page preview, not an iMessage connection or an actual task.

For a clickable research playback on the same card layout, open `http://127.0.0.1:3000/demo/research?play=1` and select **Play from dot 1**. It simulates Grokbot confirming 3, 5, 19, 20, 37 and 50 profiles. Newly confirmed dots fill in one bounded, staggered batch; the next unconfirmed dot breathes gently while waiting. Counts always show the latest confirmed measurement. This demo is available only when local examples are enabled and never writes task progress.

For an authenticated local publishing host:

```sh
npm run init
npm run dev
```

Run commands from this package directory. Node 22 or newer is required. There are **no runtime npm dependencies** and no bundled fonts. The existing messaging process supplies its installed Spectrum SDK.

## The four layouts

| `template` | Selected reference | Use |
| --- | --- | --- |
| `dots` | Research market | White/gray item matrix, current work, exact count |
| `segments` | Fix repository / QA checks | Ten white/gray segments and a percentage derived from a named measurable count |
| `stages` | Place order | Current stage, activity indicator, and completed-stage dots, without invented total-task percentages |
| `matrix` | Grokbot | Tap between measured progress and the moving Grokbot matrix; current/upcoming planned steps and weighted whole-workflow estimate |

All layouts use the final black/white palettes and no photographic headers. Dark is the default; light is selected through saved JSON when requested. A single tap switches the local task/Grokbot view. There are no task-action controls or theme gestures.

`references/` preserves the original mockups for historical context only. `public/assets/` retains legacy source artwork; the renderer does not display it. Use `header: "none"`.

## What is implemented

- Shared server/browser HTML renderer and stylesheet; four data-driven layout variants.
- Initial server rendering, visible-page refresh, resume refresh and stale-response rejection.
- Authenticated create/update/read operations for the trusted publisher.
- Ten logical slots, `live-1` through `live-10`, not ten hosting projects.
- Durable slot and revision state: local file storage for development, Upstash Redis REST adapter for Vercel.
- Atomic slot claims, optimistic content revisions, idempotent create/update requests, provider-presentation claims, unknown-outcome handling and safe final release.
- Read-only card URLs with a scoped capability, separate from the write credential.
- An existing-runtime Spectrum adapter: sends one stable card URL; later milestones write saved state only.
- CLI, example payloads, design guidelines, operating skill, installation and recovery instructions, tests and Vercel Build Output packaging.

## What is NOT claimed

No Vercel deployment, external Redis database, user's running Grokbot integration, real Spectrum call, or physical-device rendering was tested here. See `evidence/TEST_REPORT.md` for the exact local checks.

The host retains the initial send ledger. Progress updates need no original Spectrum message object and continue after runtime restart. Uncertain initial sends still require reconciliation before another send or terminal slot release.

This is a small **single-user/setup host**, not a multi-tenant SaaS. A writer token is trusted publishing authority. Read links are bearer capabilities, not proof of who is looking at them. Keep displayed information minimal.

## How updates work

```text
Grokbot task/worker produces actual progress
  -> existing authorized executor invokes supplied runtime helper
  -> helper saves validated card JSON through the publishing API
  -> Vercel page shows that record
  -> open or reopened card reads the latest saved revision
```

No approval callback is needed: the user only reads the card. Questions, approvals and final deliverables stay in the existing conversation. The actual work continues where Grokbot already runs.

## Files to read

`HANDOFF.md` is the message to give Grokbot. `INSTALL.md` explains local/Vercel setup. `DESIGN.md` locks the visual system. `SKILL.md` is the bot's operating manual. `docs/API.md` specifies the implemented API. `docs/INTEGRATION.md` explains the existing-runtime hook and its recovery boundary.

## Storage and capacity

The limit is ten **current assignments**, not ten tasks ever created. One host serves every slot and historical card. A completed card releases its slot after the initial send is reconciled. A reused slot gets a new card identity; old URLs never show a different task.

Historical read-only records are retained for up to **30 days and 100 archived cards**, whichever limit is reached first, by default. These are explicit package defaults, configurable within the documented bounds. They do not expire running/waiting/unknown assignments. An expired historical URL returns unavailable, never a new occupant. Uncertain initial sends retain their slot until reconciled.

## Deployable build

```sh
npm run build
```

Produces `.vercel/output` containing one Node.js function. No credentials are copied into that build. The production configuration requires Redis-backed storage. Installing this archive does not authorize creating paid infrastructure or bypassing platform approvals.

## Final task-card transitions

Task cards open on task details in dark mode. Tap (or press Enter/Space) to reveal Grokbot; repeat to return to the current task state. There is no triple-tap gesture. When the user requests light mode, Grokbot sets `content.theme: "light"` in the saved JSON for a new or active card. The URL stays identical. Terminal task snapshots retain their final theme.

Demo pages accept `?theme=light` or `?theme=dark` for comparison only. Use the local `/preview` gallery for the packaged layouts.

## Handoff archive

Run `npm run package:handoff` after verification to generate `artifacts/live-task-cards-handoff.tar.gz` and its SHA-256 sidecar. The archive includes the current required source files, including files not yet committed, and its own per-file hash manifest. It excludes environment secrets, local state, messaging receipts, nested repositories and build output. Verify the extracted archive following `INSTALL.md`; handing over an old Git commit is not equivalent to this snapshot.

The standalone matrix demo fills automatically to each weighted stage cap. Its **Confirm** buttons simulate Grokbot milestones and unlock the next range; **Restart** replays the estimate. All controls are outside the card and never write real task state.

## Personal loaders, only on request

The full `dot-matrix-mini-app` skill is bundled under `skills/`. With the trusted runtime hooks installed, an explicit request can replace that user's Grokbot character with a prepared photo-derived dot portrait or authored animation. A photo alone never changes it. Choices persist across restarts and apply to active/future owner-bound cards; reset restores Grokbot, while completed cards keep their snapshots. The renderer supports validated 8–32-column/row assets across all four layouts. See `docs/CUSTOM_LOADERS.md` for generation, authorization, limits and acceptance checks. No source photo is published, no shared animation is overwritten, and preference updates need no redeployment or Spectrum edit.
