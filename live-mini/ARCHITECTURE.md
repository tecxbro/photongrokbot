# Photon × Grok × live-task-cards — architecture

Snapshot of how the pieces fit together after the 2026-09-26 Blob CAS fix.
Production card host: `https://{{LIVE_TASK_CARDS_HOST}}` (your deployment).

---

## Where the send / update rules already live

These were **not invented in chat** — they ship with the handoff package:

| Rule | Source |
|------|--------|
| When to open a card vs stay in text | `live-task-cards/SKILL.md` |
| Prefer matrix; dark default; light only on request | `SKILL.md`, `HANDOFF.md` §5 |
| Spectrum **send once** on create; progress = JSON only | `HANDOFF.md` §4–6, `INSTALL.md`, `examples/existing-runtime.mjs` |
| Same URL forever (no replace bubble / no `edit`) | `HANDOFF.md` §6, `SKILL.md` |
| Ten slots `live-1`…`live-10` | `src/model.mjs` (`SLOT_NAMES`) |
| Blob fresh reads + strong-ETag CAS | `src/store.mjs`, `src/vercel-blob-lite.mjs`, `migration/BLOB-FIX-REPORT.md` |
| Wire into existing Spectrum runtime | `HANDOFF.md` §4, `docs/INTEGRATION.md` |

This file is a **map**. The package docs above remain authoritative for behavior.

---

## Big picture

```mermaid
flowchart TB
  subgraph User
    Phone["iPhone / iMessage"]
  end

  subgraph GrokVM["Grok Bot VM (this computer)"]
    FD["Front Door / orchestrator bots"]
    Spec["Spectrum / Photon bridge<br/>{{BRIDGE_ROOT}}"]
    Pub["Publisher client<br/>(LIVE_CARDS_* — wire still open)"]
  end

  subgraph Vercel["Vercel project: {{LIVE_TASK_CARDS_PROJECT}}"]
    API["Node function<br/>API + card HTML"]
    Blob["Private Blob store<br/>{{LIVE_TASK_CARDS_BLOB_STORE}}"]
  end

  Phone <-->|iMessage| Spec
  Spec <--> FD
  FD -->|start once: Spectrum app URL| Spec
  FD -->|progress: authenticated JSON| Pub
  Pub -->|POST /api/...| API
  API -->|get useCache:false<br/>put ifMatch strong ETag| Blob
  Phone -->|opens same card URL| API
```

**Ownership split**

- **Messaging** (bubbles, Spectrum `app(url)`, space, enqueue) → Grok VM / Spectrum.
- **Card state** (slots, revisions, progress JSON, card page) → Vercel + private Blob.
- Progress never needs a new Spectrum message or a redeploy.

---

## Card lifecycle (when / how)

```mermaid
sequenceDiagram
  participant U as User (iMessage)
  participant G as Grokbot / runtime
  participant S as Spectrum
  participant V as Vercel API
  participant B as Private Blob

  Note over G: Eligible multi-step task + free slot?
  G->>V: create card (publisher auth)
  V->>B: CAS write registry (claim slot)
  V-->>G: card id, URL, revision
  G->>S: ONE send — live app bubble with that URL
  S-->>U: card appears

  loop Meaningful milestones only
    G->>V: update same card id + expectedRevision
    V->>B: fresh get + ifMatch put
    V-->>G: new revision
    Note over S: no send, no edit
    U->>V: reopen / poll same URL
    V->>B: fresh get
    V-->>U: updated UI
  end

  G->>V: terminal update + archive
  V->>B: free slot, keep card record
```

**Send rules (short)**

1. Create card only for substantial queued work with real stages (not chat fillers).
2. Prefer `matrix` + `theme: "dark"`; `light` only if asked.
3. Spectrum: **initial send only**.
4. Updates: hosted JSON at the **exact same URL**.
5. Finish: write terminal content, release slot; history stays readable.

---

## Storage model

```mermaid
flowchart LR
  subgraph Registry["Blob pathname<br/>live-task-cards:v1:{{SETUP_NAME}}.json"]
    Meta["schema + version"]
    Slots["slots: live-1 … live-10<br/>null or cardId"]
    Cards["cards: id → record<br/>active + archived"]
  end

  Slots -->|"≤10 occupied"| Live["Live bubbles<br/>(currently ~9)"]
  Cards --> Hist["Retained history<br/>(e.g. 13 total records)"]
```

- **Occupied count** = how many of the 10 slots hold an active card.
- **Total cards in file** = active + archived (not a send cap; prune via `MAX_ARCHIVED_CARDS`).
- Preview uses a **separate** pathname (`…{{SETUP_NAME}}-preview.json`) so tests never touch prod.

**CAS path (why weak ETags mattered)**

```mermaid
flowchart TD
  A[Read registry get useCache:false] --> B[Change in memory]
  B --> C[put with ifMatch = strongEtag]
  C -->|412| D[Retry: re-read + apply]
  C -->|200| E[New version committed]
```

Private Blob returns weak ETags (`W/"…"`). `ifMatch` needs the strong form — `strongEtag()` in `vercel-blob-lite.mjs`.

---

## Vercel host internals

```mermaid
flowchart TB
  Req[HTTP request] --> Http[src/http.mjs]
  Http --> Svc[src/service.mjs]
  Svc --> Model[src/model.mjs<br/>slots + validation]
  Svc --> Store[src/store.mjs BlobStore]
  Store --> Lite[src/vercel-blob-lite.mjs]
  Http --> Public[public/* card UI<br/>matrix-live, themes, …]
```

Env (prod): `STORE=blob`, `BLOB_READ_WRITE_TOKEN`, `BLOB_PATHNAME`, publisher + view secrets, `PUBLIC_BASE_URL`.

---

## Grok / Spectrum side (intended vs current)

```mermaid
flowchart TB
  subgraph Intended["Handoff intent"]
    Ex["examples/existing-runtime.mjs"]
    RT["createTaskCardRuntime<br/>start / get / update / sync"]
    Pres["createSpectrumPresenter<br/>initial app send only"]
  end

  subgraph Current["As of this snapshot"]
    Bridge["Packaged LIVE_CARDS bridge<br/>was removed from {{BRIDGE_ROOT}}<br/>2026-09-26"]
    Host["Vercel host + Blob<br/>FIXED and LIVE"]
  end

  Ex --> RT --> Pres
  Host -.->|needs re-wire| Bridge
```

| Layer | Status |
|-------|--------|
| Package on disk | Pack folder `live-mini/live-task-cards/` (or `{{LIVE_MINI_PATH}}/live-task-cards/`) |
| Vercel host + Blob CAS | **Done on source deploy** (use your own deployment id) |
| Spectrum runtime attach | **Not done** — bridge removed; needs `existing-runtime.mjs` re-wired |
| Phone verify (send + 2 same-URL updates) | **Not done** |
| Personal loader skill wire | Optional / not done |

---

## Trust boundaries

```mermaid
flowchart LR
  PubTok[Publisher token] -->|writes| API
  ViewKey[Per-card read key in URL] -->|reads page/API| API
  BlobTok[BLOB_READ_WRITE_TOKEN] -->|server only| Blob
  SpecCreds[Photon / Spectrum creds] -->|VM only| Spec
```

- Blob write token stays on Vercel (and install secrets), never on the card URL.
- Photon credentials stay on the VM — not on the Vercel project.
- Card URL carries a narrowly scoped read capability, not publisher power.

---

## Key paths on this machine

```
live-mini/   (or {{LIVE_MINI_PATH}}/)
  ARCHITECTURE.md          ← this map
  live-task-cards/         ← handoff package (source of truth for card rules)
  migration/BLOB-CAS.md, DEPLOY-NOTES.md
  secrets/ (NOT shipped) — create locally; chmod 600; never paste

{{BRIDGE_ROOT}}/   ← Spectrum / iMessage runtime
```

Keep your own registry backups outside the share pack; this pack does not ship `migration/backups/`.
