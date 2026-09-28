# Deploy notes — live-task-cards (scrubbed)

Teaching notes distilled from a successful full-host + matrix deploy. **No production IDs, phones, or upload JSON.**

## Goal

Deploy the handoff source so the host accepts all four templates (`dots|segments|stages|matrix`) with `STORE=blob` and strong-ETag CAS. Preserve any existing Blob registry pathname; do **not** wipe cards/slots. Do not touch Redis/Upstash unless you intentionally run `STORE=redis`.


## Bot deploy-all

When Vercel is **authorized** for this Grok Bot setup (connector works / list projects succeeds), the bot **deploys without asking** the human which store, which env keys, or to paste tokens. Defaults:

- `STORE=blob` (do not quiz Redis vs blob)
- Generate `PUBLISHER_TOKEN` + `VIEW_SIGNING_SECRET`; set via Vercel connector
- Create/reuse project e.g. `live-task-cards` or `grokbot-live-cards`
- Private Blob + `BLOB_PATHNAME`; set `PUBLIC_BASE_URL` to the production host after deploy
- Create Live Mini Bot if missing; wire publisher into bridge-accessible VM env (not chat)
- Smoke `GET /health` and authenticated `GET /api/doctor`

Skill: `skills/live-mini-enable`. Never paste Blob/publisher/view secrets into chat. Never gate on detecting Spectrum Apps install.

## Recommended path

1. Configure the authorized Vercel project (framework none / Other; Node 22; build `npm run build`).
2. Set env (see `../live-task-cards/INSTALL.md`):
   - `PUBLIC_BASE_URL=https://{{LIVE_TASK_CARDS_HOST}}`
   - `STORE=blob`
   - `BLOB_READ_WRITE_TOKEN` (private store)
   - `BLOB_PATHNAME=live-task-cards:v1:{{SETUP_NAME}}.json`
   - Distinct `PUBLISHER_TOKEN` + `VIEW_SIGNING_SECRET` (≥32 chars)
   - Preview uses a **separate** `BLOB_PATHNAME` (e.g. `…{{SETUP_NAME}}-preview.json`)
3. From `live-task-cards/`: `npm test && npm run check && npm run build`
4. Deploy `.vercel/output` (or source + buildCommand) through authorized tooling — this pack does not create deployments.
5. Verify `GET /health` and authenticated `GET /api/doctor` → `storage: "blob"`.
6. Create one matrix card via publisher API; confirm `template: "matrix"`.
7. Wire Spectrum: **one** `bun run enqueue -- --space-id … --app-url '<viewUrl>' --live` on create; later milestones = JSON PUT only (same URL forever). See `../live-task-cards/HANDOFF.md` and `examples/existing-runtime.mjs`.

## Large asset note (`grokbot-matrix/square-animation.js`)

The full square animation is ~103KB and ships in this pack under `live-task-cards/grokbot-matrix/square-animation.js`. Prefer deploying from this source tree / Build Output rather than pasting the file through chat or fragile base64 MCP uploads. If a deploy path truncates large files, host the full file in private Blob and have `scripts/build.mjs` fetch it at build time when `BLOB_READ_WRITE_TOKEN` is present (pattern used upstream) — or keep the full file in the deploy payload.

## Files typically deployed (app only)

`package.json`, `vercel.json`, `index.mjs`, `server.mjs`, `scripts/build.mjs`, all of `src/` needed at runtime, `public/` card UI modules + CSS, and `grokbot-matrix/*` (including full `square-animation.js`). Docs, tests, examples, and this `migration/` folder are **not** required on the host.

## Excluded from this pack’s migration folder

Bulky `create_deployment` / seed / sha-list JSON, MCP inbox payloads, API upload receipts, Blob list dumps, and any file containing real tokens or phone numbers. Rebuild from source + these notes instead.
