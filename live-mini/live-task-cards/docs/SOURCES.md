# Sources and implementation decisions

## User-provided basis

The current conversation selected three images: Research market (dot grid), Fix repository (segmented progress), and Place order (stage tracker). Copies are in `references/01-dot-grid.png`, `02-segments.png`, and `03-stages.png`.

The current design instruction supersedes the original navy reference: final black or white surfaces with neutral gray; no blue/green/amber status accents. The source images establish the visual direction, not a functioning backend, exact dot count, truthful percentage, hosting plan, or device dimensions.

The earlier supplied `live-mini-app-task-progress-v1.md` establishes read-only V1, task-following use, no user-action callback, one shared runtime, ten logical slots, and preserved old-card identity. This implementation carries that scope forward.

`public/assets/study.png` is the already-supplied blue/soft-focus study scene (`d3ebd72c-db8e-4756-9d9e-d0181bd97845.png`). `hands.png` is the already-supplied reaching-hands scene (`5ca79aaa-5eeb-47f1-bc7a-6e34ff087e23.png`). They are copied without generating new images. They are retained historical source assets and are not rendered as task headers, not proof of task activity or a claim of independently established third-party licensing.

## Documentation consulted September 23, 2026 (historical provenance)

Photon app cards:

```text
https://photon.codes/docs/spectrum-ts/content/app
https://photon.codes/docs/spectrum-ts/providers/imessage/messaging-features/apps
```

The current package uses one initial send and stable-URL JSON updates, not provider edits. These sources document live-rendering requests, the matching-extension prerequisite, retaining the original returned message for edit, provider-managed session metadata, and successful edits without a replacement message. They do not prove that the user's current runtime has our integration or a verified session-recovery mechanism.

Vercel Node and Build Output API:

```text
https://vercel.com/docs/functions/runtimes/node-js
https://vercel.com/docs/build-output-api/configuration
https://vercel.com/docs/build-output-api/primitives
https://vercel.com/docs/storage
```

Used for the one-function build format, Node.js handler configuration, routing, and the separation between compute and durable storage. The generated build uses `runtime: nodejs22.x`, `handler: index.mjs`, `launcherType: Nodejs`, and configuration version 3. A local build check is not a deployment test.

Upstash Redis REST:

```text
https://upstash.com/docs/redis/features/restapi
```

Used for server-side Bearer authentication, JSON-array command requests, response handling, and supported scripting. The implementation uses EVAL compare-and-swap rather than a non-atomic pipeline. Its external REST/Lua behavior remains a deployment smoke-test item; local tests use a boundary double.

## New implementation choices

The exact palette tokens, 300 × 300 reference / 300 × 240 compact adaptation, data schema, host API, Redis adapter, read-key model, ten-segment normalization, 50-dot cap for larger totals, archive defaults, and client refresh schedule are choices made in this package. They are not pre-existing Photon commands or evidence of code already present in the repository.

The package does not copy the original checkout renderer and does not overwrite payment routes. Its code was written from scratch for the selected task-progress templates.

## Personal loader generation skill

`skills/dot-matrix-mini-app/` is a complete, byte-identical snapshot of the locally installed `dot-matrix-mini-app` skill taken on 2026-09-26 (15 files). Its starter remains unchanged; production integration and the data-only asset format are documented separately in `docs/CUSTOM_LOADERS.md`.
