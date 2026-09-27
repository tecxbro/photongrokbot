# Coding + computer access (general)

Standing rules for **all** Photon ↔ Grok iMessage bots (Creator, Feature Add, Orchestrator, specialists, Front Door). Not incident-specific.

## Coding-specific tasks
- Bridge/repo implementation, PRs, non-trivial code edits → **Cursor on the web** (cloud agent / Origin).
- Do **not** drive **Cursor on the owner's computer** for coding work.

## the owner's computers
- Do **not** access the owner's registered computers (`machineId`, CopyFromBox/CopyToBox involving their disk, local tools on their machine) **until the owner specifically asks** in that turn.
- “Sent from machine …” on a chat message is **not** permission to use that machine.

## Shared agent box (allowed)
- The shared agent box under `/workspace/…` (including `{{BRIDGE_ROOT}}` runtime, markers, tests, restarts) is **not** the owner's personal computer.
- Creator / Feature Add may use the box for Spectrum runtime diagnose/repair/landings without a separate ask.

## Authority
- Live profiles + this file. Cross-links: `CONTEXT_LOADING.md`, `memory.md`, Creator/Feature Add skills, `bots/{{CREATOR_BOT_ID}}.md`, `bots/{{FEATURE_ADD_BOT_ID}}.md`.
