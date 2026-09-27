# Give this package to Grokbot

## Verify the source you are installing

Take this package from [tecxbro/live-mini-app](https://github.com/tecxbro/live-mini-app), release `handoff-2026-09-26`, or its matching release attachment. Use your own installation tools and execution workflow. The old `liveminiappdesign` commit `090fa77` is not this package.

Before integration, confirm the installed source includes `public/matrix-live.mjs`, `public/card-theme.mjs`, `src/loaders.mjs`, `docs/CUSTOM_LOADERS.md`, and the complete `skills/dot-matrix-mini-app` directory. Its model accepts four templates including `matrix`, and both `dark` and `light` themes. Verify the file manifest and report the installed commit or archive checksum. A three-layout navy-only installation is the wrong source.

Compare the actual production host build with this source before sending another card. An accepted new message can still point to an old host build. Preserve existing stable URLs, saved task history, credentials and the messaging runtime while integrating. If the existing host uses a different persistence adapter, such as Blob, inspect its data and routes and plan a compatible migration; do not point the new implementation at an empty registry or silently discard existing cards. Report any unresolved migration or executor prerequisite explicitly.

## Install and connect

Install and connect the supplied `live-task-cards` implementation. Do not rewrite it or generate new designs/images for ordinary task updates. Explicit requests for a personal dot-matrix loader use the bundled conversion skill as described below.

The reusable styles are already implemented: `dots`, `segments`, `stages`, and `matrix`, with the final dark/light palettes and no photographic headers. Gallery titles and sample counts are fixtures, not fixed card identities. Follow the selection rules in `SKILL.md` and supply each real task's title, stage labels, detail and confirmed progress through JSON. This is read-only task progress, not an approval/payment system.

Prefer the dark `matrix` layout for substantial multi-step tasks; assign weighted estimated progress for the whole workflow and show the current/upcoming steps. Use `stages` when an estimate is unsuitable, and the other layouts only for an explicit preference or a materially clearer display. Derive names from the user's task and actual execution evidence. The matrix lines show the current step brightly at the bottom and upcoming steps faded above it, without extra prefixes, from a task-specific `activityPlan` matched to stable stage IDs. Finished steps leave the queue. Use `docs/ICONS.md` to select supported icons; keep upcoming work distinct from confirmed completion.

1. Read `README.md`, `DESIGN.md`, `INSTALL.md`, and `SKILL.md`. Keep the reference screenshots for visual comparison only. Set `header: "none"`; do not reintroduce photographic headers, mountains, Orchid identity or the rainbow icon.

2. Verify the archive SHA-256 sidecar and its extracted `MANIFEST.sha256.json` using `INSTALL.md`. Extract this package into its own directory, leaving the running messaging program and unrelated files intact. Run the included tests and syntax/example checks. Start the local preview and inspect all four templates at 300 × 300 and 300 × 240. The screenshots are layout references; do not reproduce inaccurate visual counts or colored active indicators.

3. Confirm the existing approved Vercel host and durable storage configuration. This package ships a working Redis REST adapter and local development store. Production needs the configured Redis endpoint/token, two distinct generated secrets, and the real production origin. Do not create paid resources or change permissions without the existing authorization. Use one hosting project, not ten projects.

4. Connect `examples/existing-runtime.mjs` inside the existing shared Spectrum runtime using its installed `app` export and actual authorized `Space`. Register the supplied `start`, `get`, `update`, and `sync` operations through the existing trusted execution path. Also wire the owner and explicit-request hooks for `getLoader`, `setLoader`, and `resetLoader` using `docs/CUSTOM_LOADERS.md`. The adapter sends the initial card once; progress updates write hosted JSON and never call Spectrum `send` or `edit`. Do not create another Spectrum connection or introduce Grok API usage. The current enqueue command's interface is not established by this package: inspect it rather than inventing flags.

5. Use dark mode by default. If the user asks for light mode, set `content.theme: "light"` for the new or active card through JSON at the same URL; do not add a theme gesture or change the URL. Keep the returned card ID and revision in the existing task context. Use the ten logical slots automatically. Grokbot supplies stage weights and pacing once, then changes stage states/detail/status at meaningful milestones. The frontend fills locally to each stage cap. Use `progress: null` plus `workflow.weights` for this mode, and never treat animated estimates as confirmed item counts. The server-owned stage clock preserves progress through reopen/pause; 100 requires actual completion. Legacy measured cards still accept confirmed count updates. No new HTML/CSS/JS per task, no per-update image generation and no deployment for a counter change.

6. Keep the original card URL byte-for-byte unchanged, including its path and query. Update the content served at that address: C becomes D at the same URL. Never append a refresh/version parameter, send a replacement bubble, or call Spectrum `edit` for ordinary content updates. An explicitly requested design change is deployed to the same Vercel project and route; ordinary task progress only changes the saved JSON. The optional initial-message store is for auditing, not a prerequisite for progress updates. Uncertain initial sends must be reconciled without resending.

7. Verify one authorized real card: original send, two hosted JSON updates with the exact same URL and no additional Spectrum calls, reopen, final update, slot release, then slot reuse without changing the first card's history. Confine any live test to the expressly authorized conversation. Do not automatically send test cards to other people.

8. Follow the server lifecycle in `SKILL.md` and `INSTALL.md`: record ownership when starting local preview/dev servers or tunnels, then stop those temporary processes after the task and requested review finish. Honor an instruction to keep them running for now. Verify shutdown; leave the persistent Vercel host, stable card URLs, durable storage, and shared messaging runtime intact.

Return exact installation paths, changes made to the existing runtime, test results, and separate states for code installed, host deployed, runtime connected, and device verified. Do not call an accepted SDK send “device verified.”

## On-request personal loaders

The complete `dot-matrix-mini-app` skill is included at `skills/dot-matrix-mini-app/SKILL.md`, with its references, scaffold, assets and tests. Read `docs/CUSTOM_LOADERS.md`. Install it in the actual executor and wire the trusted owner-resolution and explicit-request hooks; neither hook is a guessed Grokbot API. An image alone must never change a loader. On an explicit request, generate and visually verify a data-only still or animation, validate it with `scripts/prepare-loader.mjs`, then select it for that owner. Active/future cards inherit the choice at their existing URLs; terminal history remains unchanged. Support an explicit reset to Grokbot. Never replace the shared animation file to customize one person, and never call Spectrum send/edit for a loader preference change.

Include personalization in installation acceptance: plain-photo no-op, explicit replacement, owner isolation, restart inheritance, same-URL refresh, reduced-motion behavior, terminal history and reset. Use `npm run test:skill` in addition to the package checks. The archive supplies the capability; connecting the real photo input, generation tools, request authorization and iPhone surface remains the installer's work.
