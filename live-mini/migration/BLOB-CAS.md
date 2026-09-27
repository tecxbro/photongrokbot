# Blob CAS notes — live-task-cards (scrubbed teaching copy)

**Date:** 2026-09-26 (PT)  
**Project:** `{{LIVE_TASK_CARDS_PROJECT}}` (`{{VERCEL_PROJECT_ID}}`)
**Account:** `{{VERCEL_TEAM_OR_USER}}`
**Constraints honored:** Redis/Upstash never touched; no `teamId` on Vercel API calls; prod registry pathname not wiped; secrets not printed.

## Summary

Production and preview now run Blob registry code with:

1. **`useCache: false`** on private GET (fresh reads after writes)
2. **`ifMatch` CAS** on PUT (concurrent writers retry / surface conflict)
3. **Strong ETag normalization** — private Blob GET often returns weak validators (`W/"…"`); `put` `x-if-match` requires strong. Fixed in `src/vercel-blob-lite.mjs` via `strongEtag()`.

Ordinary progress updates write JSON in the Blob registry — **no Spectrum replace**, no redeploy.

## Architecture

| Piece | Role |
|-------|------|
| `STORE=blob` | Selects `BlobStore` in `src/store.mjs` |
| `BLOB_PATHNAME` | Registry object key |
| Prod pathname | `live-task-cards:v1:{{SETUP_NAME}}.json` |
| Preview pathname | `live-task-cards:v1:{{SETUP_NAME}}-preview.json` (isolated) |
| `src/vercel-blob-lite.mjs` | BOA-safe Blob HTTP client (no `@vercel/blob` jose/OIDC in the function) |
| `BlobStore.transaction` | read → mutate → put(ifMatch) with retry; first create omits ifMatch |

Redis/Upstash adapters remain in source for optional use but were **not** configured or called during this work.

## Deployments

| Env | Deployment ID | URL | Notes |
|-----|---------------|-----|-------|
| Preview (etag fix) | `{{DEPLOYMENT_ID}}` | https://{{LIVE_TASK_CARDS_HOST}} | Full app; preview `BLOB_PATHNAME` |
| Production | `{{DEPLOYMENT_ID}}` | https://{{LIVE_TASK_CARDS_HOST}} (also `live-task-cards-{{VERCEL_SCOPE}}.vercel.app`) | Same blob-fix build; prod pathname |

Earlier doctor-only preview (`{{DEPLOYMENT_ID}}`) verified CAS selftest before the full-app path; not promoted.

### Unstick notes (upload loop)

- Large `upload_file` base64 payloads previously failed with `sha1sum_mismatch` (often `+` corruption through intermediate shells).
- Successful approach: **reuse content SHAs already on Vercel’s file store** from the prior production deployment for unchanged app modules; upload/seed only the blob-fix files (`store` slim CAS build, `config`, `vercel-blob-lite`).
- Source-style deploy + `npm run build` (same as prior prod) avoided oversized `create_deployment` inlines.

### File SHAs on production build (blob-relevant)

| Path | SHA1 | Notes |
|------|------|-------|
| `src/store.mjs` | `a043b218e03bd182bbdb0652a5c286c43f347e85` | Slim BlobStore (CAS); Redis/File stubs throw if selected |
| `src/config.mjs` | `9d5e8bd4a3a1669b24fb603f99f62dde9d58105b` | STORE=blob config |
| `src/vercel-blob-lite.mjs` | `fbcbd7e69950e6f64d6a1a11bc089c26766362d0` | Includes `strongEtag` |
| App modules (model/http/service/…) | Prior prod UIDs | Unchanged business logic reused by SHA |

Package tree still has full `src/store.mjs` (`59c6fc50…`) with File/Redis/Blob; runtime deploy used the slim Blob-focused build for size/seed reliability. Behavior for `STORE=blob` matches.

## Verification

### Preview (`{{DEPLOYMENT_ID}}`)

- `GET /api/doctor` → `storage: "blob"`
- Create card → 201
- Sequential `PUT` progress/content → 200, revision advanced
- Concurrent `PUT` same `expectedRevision` → one **200**, one **409 REVISION_CONFLICT**; loser retry → 200
- Fresh doctor/read showed persisted occupied cards
- Preview registry pathname only; **prod registry untouched** during preview tests

### Production (`{{DEPLOYMENT_ID}}`)

- `GET /api/doctor` → `storage: "blob"`, **occupied: 9** (unchanged count)
- Blob `live-task-cards:v1:{{SETUP_NAME}}.json`: before update **version 22 / 13 cards / 9 occupied**; after progress update **version 23 / 13 cards / 9 occupied** (not wiped)
- Progress update on occupied card `{{CARD_ID}}`: progress `2 → 3` of 4 steps, revision `1 → 2`, HTTP 200 — **no Spectrum replace**

## Root cause fixed

Without strong-ETag normalization, every overwrite `put` with `ifMatch` from a weak GET ETag returned **412**, exhausting `BlobStore` retries → `STORE_BUSY` even for single writers. Creates (no ifMatch) still worked, which matched the “create OK, update broken” symptom.

## Docs updated

- `live-task-cards/INSTALL.md` — Blob lite + strong ETag + preview pathname isolation
- `live-task-cards/HANDOFF.md` — Blob CAS architecture; do not touch Redis during Blob fixes

## Blockers / follow-ups

- None for success criteria.
- Optional later: promote full (non-slim) `store.mjs` into the next production build once large-file upload path is reliable, or keep slim for Blob-only hosts.
- Optional: add a unit test asserting `strongEtag('W/"abc"') === '"abc"'` and ifMatch round-trip against Blob in CI.
