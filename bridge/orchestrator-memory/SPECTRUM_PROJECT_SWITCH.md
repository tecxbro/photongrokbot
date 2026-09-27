# Incident: inbound dead after Photon project switch (2026-09-22)

## Symptom
- Texts to the **new** {{SPECTRUM_PROJECT_LABEL}} number (`{{HOSTED_IMESSAGE_NUMBER}}`) never woke Front Door.
- Runtime log still said `hosted iMessage provider connected`.
- Outbound could still hit **old-project** rate limits / wrong project behavior.
- `.env` already had the new `SPECTRUM_PROJECT_ID` / secret — looked fine on disk.

## Exact root cause
1. Shell still had **exported** stale vars:
   - `SPECTRUM_PROJECT_ID={{OLD_SPECTRUM_PROJECT_ID}}` (old `grokbot`)
   - matching old `SPECTRUM_PROJECT_SECRET`
2. `src/config.ts` `loadEnvFile()` used to do:
   - `if (process.env[key] === undefined) process.env[key] = value`
   - so **shell exports beat `.env`**. Process authenticated as old project.
3. Photon only delivers inbound for lines owned by the project the process is authed to.
   - New number belongs to `{{SPECTRUM_PROJECT_LABEL}}` (`{{SPECTRUM_PROJECT_ID}}`).
   - Process on old project → **zero inbound** on the new number (messages not queued).
4. Photon docs (connection-and-routing): after a line/project change, **restart** (or wait for token renewal at ~80% TTL). Restart alone is useless if credentials stay wrong.

## Secondary / not the same bug
- Greeting-only batches (`hey` / `hi` / `thanks`) use **runtime greeting fast-path** and **do not** webhook Front Door. That is intentional, not a project-switch failure.
- Rate-limit on old project is why we created `{{SPECTRUM_PROJECT_LABEL}}`; it is separate from the env-override bug.

## Fix applied (2026-09-22)
- `loadEnvFile()` now **always** applies `.env` values (`.env` wins over stale shell).
- Start only via `./scripts/start-runtime.sh` — unsets `SPECTRUM_PROJECT_*`, re-exports from `.env`, then `bun run src/index.ts`.
- Verified live `/proc/<pid>/environ` has `SPECTRUM_PROJECT_ID={{SPECTRUM_PROJECT_ID}}`.
- Inbound `hey` received; task-shaped messages must still go webhook → Front Door.

## Checklist before declaring a project/number switch “done”
1. `.env` has new `SPECTRUM_PROJECT_ID` + secret (never paste secret into chat).
2. Stop old bun: kill pid in `data/runtime.pid`; confirm no `bun run src/index.ts`.
3. Start with: `cd {{BRIDGE_ROOT}} && ./scripts/start-runtime.sh` (or nohup that script → `data/runtime.log`).
4. Confirm start log line: `[start] SPECTRUM_PROJECT_ID=<expected>`.
5. Confirm process: `tr '\\0' '\\n' < /proc/$(cat data/runtime.pid)/environ | grep '^SPECTRUM_PROJECT_ID='`
6. User texts **new** number with a **non-greeting** (e.g. “ping front door”) — expect `webhook ok` in `data/runtime.log`, not only `greeting fast-path`.
7. Do **not** trust “connected” alone; trust **project id in process env** + inbound/webhook lines.

## Active project (as of 2026-09-22)
| Item | Value |
|------|--------|
| Project name | {{SPECTRUM_PROJECT_LABEL}} |
| Project id | `{{SPECTRUM_PROJECT_ID}}` |
| Text-to number | `{{HOSTED_IMESSAGE_NUMBER}}` (`{{HOSTED_IMESSAGE_NUMBER}}`) |
| Authorized sender | `{{AUTHORIZED_SENDER_ID}}` |
| Old project (retired for runtime) | `grokbot` / `{{OLD_SPECTRUM_PROJECT_ID}}` / `{{OLD_HOSTED_IMESSAGE_NUMBER}}` |
| Start command | `./scripts/start-runtime.sh` |
| Log | `data/runtime.log` |

## Photon doc note
https://photon.codes/docs/spectrum-ts/providers/imessage/connection-and-routing  
New lines are invisible until token renewal or process restart; wrong `projectId`/`projectSecret` means the new line never appears at all.
