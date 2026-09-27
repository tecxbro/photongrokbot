# Live Mini / live-task-cards (optional)

**Retired-but-reusable** stack for Photon Spectrum **live mini app** task-progress cards (dot-matrix / matrix animation, plus dots / segments / stages layouts).

Upstream active bots were retired; this folder ships the **source + install docs** needed to rebuild. Bridge low-level flags `--live` / `--app-update` already live in `../bridge/` and are documented in `../bridge/orchestrator-memory/APPS.md`.

Public package reference: [tecxbro/live-mini-app](https://github.com/tecxbro/live-mini-app) (release `handoff-2026-09-26` lineage).

## How it fits the architecture

```
iMessage → Spectrum bridge → Front Door
                              ├─ App Sheet     → static --app-url
                              └─ Live Mini (*) → create card on Vercel host
                                                 → ONE --app-url --live send
                                                 → progress = JSON at same URL
```

\* Optional. Create from `../agents/live-mini/` only if you want the specialist. Front Door skill already routes “live mini / update the card” to `{{LIVE_MINI_BOT_ID}}`.

**Ownership split**

| Layer | Owner |
|---|---|
| Messaging bubbles / enqueue | Bridge + Front Door |
| Card HTML + slots + revisions | Vercel host (`live-task-cards/`) + private Blob |
| Progress publisher | VM helper (`runtime/`) or `examples/existing-runtime.mjs` |

Rules of thumb (authoritative detail in `live-task-cards/SKILL.md` + `HANDOFF.md`):

1. Prefer `matrix` + dark theme for substantial multi-step work.
2. Spectrum: **initial send only** for ordinary progress.
3. Updates write hosted JSON at the **exact same URL** (no replace bubble / no `edit`).
4. Ten slots `live-1`…`live-10`; release on terminal; history stays readable.

## Layout

```text
live-mini/
  README.md                 ← you are here
  ARCHITECTURE.md           ← scrubbed map (placeholders)
  live-task-cards/          ← full handoff source (no secrets)
    README.md INSTALL.md HANDOFF.md SKILL.md DESIGN.md
    src/ public/ grokbot-matrix/ examples/ docs/ tests/ skills/
    skills/dot-matrix-mini-app/   ← optional personal loader skill
  migration/
    BLOB-CAS.md             ← strong-ETag / useCache:false teaching notes
    DEPLOY-NOTES.md         ← how to deploy without prod JSON dumps
  runtime/
    README.md
    live-card-milestones.mjs  ← optional VM publisher + one-shot send helper
```

## Quick start (local preview, no accounts)

```bash
cd live-task-cards
node --version   # need 22+
npm test && npm run check
npm run preview  # http://127.0.0.1:3000
```

Authenticated local publish: `npm run init` then `npm run dev` (creates local `.env` — never commit).

## Production rebuild (adopter)

1. Deploy `live-task-cards/` to your Vercel project per `INSTALL.md` + `migration/DEPLOY-NOTES.md` (`STORE=blob`, private Blob, distinct publisher/view secrets).
2. Wire `examples/existing-runtime.mjs` (or `runtime/live-card-milestones.mjs`) into `{{BRIDGE_ROOT}}`.
3. Optionally CreateAgent from `../agents/live-mini/PROFILE_TEMPLATE.md`; substitute `{{LIVE_MINI_BOT_ID}}`.
4. Smoke: one live send + two same-URL JSON updates; no Spectrum `edit` for ordinary milestones.

## Intentionally excluded here

- `.env` / any `secrets/*.env` with real values / Blob + publisher tokens
- `node_modules/`, `.vercel/`, `.data/`
- Bulky migration seed / `create_deployment` / upload JSON (prod hashes)
- Personal spaceIds, phones, project ids, deployment ids
- Proof scripts hardcoded to a personal conversation

See pack root `03-WHAT-NOT-IN-SHARE.md`.
