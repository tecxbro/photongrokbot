# Live card milestones (VM-side helper)

Not part of the Vercel deploy. Optional helper that:

1. Creates a card via the publisher HTTP API
2. Sends **one** Spectrum live app bubble (`--app-url … --live`)
3. Updates milestones with JSON PUTs at the **same** view URL
4. Completes and releases the slot

## Files

- `live-card-milestones.mjs` — `createCard` / `sendOnce` / `updateMilestone` / `completeAndRelease`
- `state/` — local per-task cardId/revision/viewUrl (create at runtime; not shipped with secrets)

## Secrets (not shipped)

Create `../secrets/local.env` (chmod 600) or export:

```text
PUBLIC_BASE_URL=https://{{LIVE_TASK_CARDS_HOST}}
PUBLISHER_TOKEN=<generated>
```

Photon / Spectrum credentials stay in `{{BRIDGE_ROOT}}/.env` — never on the Vercel project.

## Enqueue

```bash
cd "{{BRIDGE_ROOT}}"
bun run enqueue -- --space-id "<spaceId>" --app-url "<viewUrl>" --live
```

Progress updates must **not** call `--app-update` / Spectrum `edit` for ordinary milestones when using the hosted JSON same-URL pattern (preferred). Low-level `--app-update` remains documented in `bridge/orchestrator-memory/APPS.md` for other live URL hosts.
