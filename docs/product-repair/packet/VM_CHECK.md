# Bounded, read-only Grokbot VM check

The coding agent should resolve code/SDK questions itself first. This is for the environment the external coding agent cannot see. Do not ask Darshan to paste secret values or whole logs.

## Prompt to send to Grokbot only when needed

> Inspect the existing Photon/Grokbot installation on your shared VM **read-only**. Do not modify/restart the bridge, install packages, create bots/routines, deploy, send messages, rotate keys or print secret values.
>
> Identify the actual code checkout and configured private-state location. Report only: path labels, whether expected files exist, their permissions, whether those known paths are Git-tracked/ignored, and whether recognized required environment keys are present (booleans; never values). `prod.env` is specifically the configured Live Mini publisher file; do not search every file on the account for secrets.
>
> Run the attached `inspect_instance_redacted.py --repo <actual-checkout>` locally; add `--instance-dir <known-private-root>` only if already configured. Return its redacted JSON. It does not contact a provider or change files. Do not use `cat prod.env`, `env`, `printenv`, shell tracing, raw ps/proc environment dumps or whole message/queue logs.
>
> Report OS, Node/Bun/Python/ffmpeg versions and the **Bun embedded** `sqlite_version()`/`sqlite_source_id()` from an in-memory database. No package install just to obtain them. Report the filesystem type/mount for the intended state directory and whether it is the supported /workspace durable location, without unrelated mounts or credentials.
>
> Describe the existing bridge process manager/startup mechanism and the documented process behavior after a VM recovery. If unknown, say unknown; do not simulate recovery on the live machine. Is there a supported single-instance startup mechanism? Do not assume a background process survives because files persist.
>
> For native Grok create/update routine and SendToAgent, list available tool names and required non-secret field/schema shapes only. Do not execute them. State what returned acknowledgement/reference is available to record safely. No fake webhook URL or guessed REST endpoint.

## Machine-local probe example (no provider call)

```bash
bun -e 'import { Database } from "bun:sqlite"; const db = new Database(":memory:"); console.log(db.query("SELECT sqlite_version() AS version, sqlite_source_id() AS sourceId").get()); db.close();'
```

This is based on the documented Bun SQLite API and is to be run on the actual supported VM. It was not run against the user's VM while preparing this packet.

## What an unresolved answer changes

- State mount is not local/lock-capable: do not silently enable unsafe WAL or move to an external provider; record the concrete deployment blocker and continue other code work.
- Runtime SQLite lacks the fix: select/pin a supported fixed Bun/SQLite build and test it in development, without upgrading the live VM now.
- No verified daemon restart guarantee: complete storage/recovery/singleton code and explicitly withhold an “always-on after recovery” claim.
- Native tool acknowledgement is not durable/task-correlated: preserve uncertainty and design a supported reconciliation step; do not issue duplicate task handoffs automatically.

## Interpretation of prod.env report

A present PUBLISHER_TOKEN is expected private runtime configuration; it is not automatically a leak. A tracked secret file is a separate finding from a missing ignore rule. If a secret was committed/pushed, report the affected path/provider/category without value and prepare deliberate rotation/history handling; do not silently rotate or rewrite history.
