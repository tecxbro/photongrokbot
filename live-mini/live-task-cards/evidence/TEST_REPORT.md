# Personal loader verification — 2026-09-26

This section supersedes the historical task-motion counts below.

- 115 package tests passed, including 14 personal-loader checks; zero failures.
- 7 bundled skill starter tests passed, including 30/60/120fps numerical transitions and the original Grokbot cycle.
- All 15 bundled skill files matched the installed source byte-for-byte.
- Browser checks passed for matrix, dots/research, segments/checks and stages at 300 × 240 and 300 × 300 viewports: animated replacement, saved theme/latest task, selected-view and playback preservation on ordinary updates, Enter/Space and rapid reversals, reduced motion, explicit reset, static loader, reopening and frozen terminal appearance. No page JavaScript errors occurred.
- An explicitly synthetic 16 × 20 dot portrait exercised the variable-grid renderer. Four uninterrupted two-second authored cycles were observed with captures around joins. Numerical sampling of four cycles at 30/60/120fps remained bounded; maximum successive intensity changes were 0.100/0.050/0.025. This is local functional evidence, not a physical-device frame-rate benchmark or a real-photo likeness claim.
- The publisher tests cover explicit-request denial, owner isolation, restart persistence, preserved clocks/URLs, authenticated asset access, concurrency, idempotency, reset/history, legacy state, larger bounded loader uploads and asset collection. No real Spectrum operation was performed.
- The browser fixture, local file state and owned server were cleaned up after verification.

Actual photo intake, user-request authorization, generation tools and task-owner resolution still must be connected in the deployed Grokbot executor. Real Redis, Vercel hosting and iPhone acceptance remain installation checks. See `clean-install.txt` for the final archive extraction, checksum, tests, syntax/examples and build checks.

---

## Historical verification before personal loaders

# Current package verification — 2026-09-26

This report supersedes the earlier 80-test report. Old browser-check files left in the authoring workspace are historical and are not included as current handoff evidence.

## Fresh checks

| Check | Result |
| --- | --- |
| `npm test` | 101 passed, zero failures |
| `npm run check` | 45 JavaScript modules; all four JSON examples validated |
| `npm run build` | Vercel Build Output generated successfully |
| Saved-card browser check | Dark default; immediate single-tap Grokbot view; JSON update to light applied on the open page at the same URL without losing the selected view; no browser warnings/errors observed |

The automated tests exercise schema validation, arbitrary task labels, theme validation, actual file storage and HTTP create/update/read, stable URLs, initial-send-only runtime behavior, state revisions, ten slots, idempotency, terminal history, unknown send handling and recovery boundaries. Theme tests verify dark/light changes at the same URL and no extra Spectrum operation. Triple-tap code and its four obsolete tests were removed; three theme-contract/update tests were added to the prior 91-test suite.

Provider tests use Spectrum doubles. Redis tests use a simulated REST/CAS boundary. These do not prove a physical iPhone, running Grokbot, real Upstash service or Vercel deployment.

The browser check used a real local file-backed card host and authenticated JSON update, not the static playback demo. The temporary host is task-owned and is stopped after verification. Existing user-review servers remain running until the user is finished with them.

## Task motion verification

The updated shared renderer was exercised locally in the Codex browser at a 300 × 240 viewport. Research dot updates and segment updates received three revisions 90ms apart; both settled to the latest value (43/50, 86%) with zero outgoing text layers left behind. Stage changes and waiting/completed states retained the task shell; light-mode completion was visually checked. Matrix activity updates changed 41/100 to 51/100 and preserved the mounted card. A real saved card then received an authenticated JSON update from 27/50 to 43/50; polling rendered the new title and count at the identical URL.

Two additional tests cover the bounded dot stagger and proportional initial fills for large totals. Reduced-motion and hidden-page handling are implemented, but no physical iPhone frame-rate or OS reduced-motion acceptance is claimed. Browser observations are functional/visual evidence, not a measured 60fps benchmark. The existing Grokbot character animation files were unchanged.

## Planned matrix steps

The matrix example now has a full task-specific activity plan. Four additional tests cover plan/schema alignment, legacy history compatibility, queue advancement, waiting/terminal states and queued intent (one prior history test was replaced). A full counter alone does not advance a stage. All 96 tests pass.

Browser checks at 300 × 240 confirmed Now/Next/Later and supported icons in dark and light mode. Fixed the demo palette selection so shared state refreshes retain the requested preview theme. Advancing saved stage state promoted Analyze market findings from Next to Now and retained Prepare research report as Next. Waiting displayed the reason without losing the future plan; completion displayed only the outcome. Accessible card text includes all visible cues and labels. The character animation data and standalone final/light-mode variants remain unchanged; only the shared task-card component gained the plan display mode.

## Handoff verification

`clean-install.txt` records checks against a fresh extracted snapshot. `MANIFEST.sha256.json` records each packaged source file. The archive SHA-256 sidecar verifies the archive itself. Packaging uses an explicit allowlist and excludes environment secrets, `.data`, messaging receipts, repositories, unrelated mini-apps and generated build output.

## Remaining installation acceptance

- Identify and connect the actual Grokbot executor in its existing authorized Spectrum runtime.
- Configure the authorized Vercel deployment and actual durable Redis storage.
- Verify one authorized initial iMessage card, hosted JSON updates at the identical URL, reopen, final state and slot reuse on the intended iPhone.
- Light/dark is a saved preference for new/active cards. Terminal task snapshots remain immutable, including their final theme.

The published Sites gallery is a static design demonstration, not the production authenticated publishing API. No current device-verification claim is made.

## Matrix visual correction and replay

Restored the previous visual hierarchy: bright current action at the bottom, upcoming actions faded above it, no visible Now/Next/Later text. Browser verification observed Verify exit and Analyze move to y=36px with full opacity; Report moved to y=18px at 0.57 opacity. No cue elements remained. The card remained 300 × 240. Standalone demo controls live outside the card and are absent from embedded previews and real saved-card pages. Playback performs no fetch/write/send; its two snapshots are explicitly simulated. The full 96-test suite, 43-module syntax check, core component syntax check and build passed.

## Softer movement and thinking text

Changed planned-row movement to 560ms and opacity to 420ms; text and icons use a shared scale transform rather than interpolated font sizes. Current running text uses a 2.8s monochrome thinking mask. Browser style inspection confirmed the active shimmer and 0.56s/0.42s transitions, with the next row at scale 0.916667. A waiting update removed the shimmer. Reduced-motion CSS disables the effect; hidden-page and character-view selectors suppress it. The previous design and 300 × 240 card remain intact. All 96 tests, 43-module checks and build passed; no physical-device frame-rate measurement is claimed.

## Weighted whole-workflow progress

New matrix cards use server-validated stage weights totaling 100, optional per-stage pacing, and progress:null. Their local estimate cannot exceed the active stage cap or advance the plan. Only confirmed overall completion reaches 100. Counts are marked approximate and announced as workflow estimates. This supersedes measured per-stage counts for the new matrix example; legacy measured cards remain supported.

All 101 tests pass. New tests cover cap holds even after a day, phase changes, terminal/nonterminal completion boundaries, invalid budgets, clock persistence through theme/pause/resume/reopen, no writes from local estimates, and rejection of backward milestones or budget changes. Browser verification observed Verify hold at 47, Analyze unlock at 50 then hold at 72, Report unlock at 75, Deliver unlock at 90, and 100 only after the explicit final confirmation. Demo confirmation controls simulate milestone writes locally; no messages were sent.
