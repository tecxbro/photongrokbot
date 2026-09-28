---
name: getting-started
description: Authorized resumable setup for the shared-VM Photon Spectrum product.
---

# Authorized setup

Follow the [operating contract](../../docs/product-repair/OPERATING_CONTRACT.md). This workflow applies only after the user requests setup. The bot performs technical steps on the shared agent VM; it never asks the user to paste secrets or run engineer commands. Browser device-login approval and an unknown authorized sender identity are legitimate human inputs. A routine message wake has no bootstrap authority.

## 1. Establish private bootstrap

Inspect checkout identity and the actual VM facts needed by [VM checks](../../docs/product-repair/packet/VM_CHECK.md). Use pinned Bun 1.4.2, the frozen bridge lock and Python/ffmpeg appropriate to that host. Do not silently upgrade dependencies. Install the bundled Photon CLI/Spectrum/iMessage skills into the executor's supported skill directory without overwriting unrelated local changes, then read them and matching official docs. Unknown native/provider tool schemas must be inspected before calls.

Select an explicit persistent private root outside code, default `/workspace/photongrokbot-state`; set PHOTON_INSTANCE_DIR to that verified path. From bridge/:

```sh
bun install --frozen-lockfile
bun run setup-state -- init --authorized
bun run setup-state -- initialize-storage
bun run setup-state -- status
```

These commands create local identity/storage only. A previous initialization with a missing database is state loss to recover, not a fresh install. Interrupted bootstrap uses the same identity. The exclusive setup lock cannot be stolen on timeout; `recover-lock` first previews a verified-dead owner, then requires its exact nonce for apply.

## 2. Discover or create authorized resources safely

Use the installed Photon CLI and [official docs index](https://photon.codes/docs/llms.txt), keeping Stable/Beta/package/API versions aligned. Reuse the user's intended project/line if verified; default new setup uses the free-plan project name grokbot when available. A name collision or lost response does not justify blindly creating the next project. No billing upgrade is implicit.

For each setup resource, record intent before the actual create/modify call:

```sh
bun run setup-state -- intent --json-stdin
bun run setup-state -- receipt --json-stdin
bun run setup-state -- uncertain --json-stdin
```

Intent input is `{ "resource": "spectrum-project" }`. Capture its operationId. Receipt input is `{ "resource": "spectrum-project", "operationId": "THE_RETURNED_ID", "resourceId": "THE_VERIFIED_RESOURCE_ID", "verified": true }`, recorded only after actual read/tool evidence. Uncertain input is the same resource/operationId without fabricated success. On rerun, inspect and reuse the recorded resource; reconcile intent/unknown before another provider call. Never rotate credentials as a retry strategy.

Device authentication uses the exact verification URL and short code returned by `photon login --no-browser`. The user approves in their browser; project secrets and CLI tokens stay private. Capture the bot-hosted line number but do not invite texting yet.

## 3. Mandatory Moonshine and six roles

Run [Moonshine installation](../../stt/INSTALL.md) using pinned packages and immutable model hashes. Verify it through the implemented command, not merely directory existence:

```sh
bun run setup-state -- verify-moonshine
```

Create/reuse all six core roles through the actual authorized native tool: Front Door, Master Orchestrator, Creator, Feature Add, Image Cards and App Sheet. For each, record intent then verified receipt using resource names front-door, orchestrator, creator, feature-add, image-cards and app-sheet. Render the [role templates](../../agents/README.md) privately with actual bot IDs and matching agent UUIDs. Use ORCHESTRATOR_BOT_ID and ORCHESTRATOR_AGENT_UUID consistently. Templates themselves are not configured workers.

```sh
bun run setup-state -- registry
```

All six verified identities must be present. A bootstrap coordinator that created Front Door may transfer the remaining setup using the actual native handoff; it does not invite first text early. Preserve operation/checkpoint identity through that transfer.

## 4. Front Door finishes sender, native routine and config

After core roles exist, use the already-known authorized sender if verified, otherwise ask once for its exact iMessage identity. Register that user on the intended project using documented actual CLI behavior. Record owner-binding evidence. The sender is not the hosted destination number.

Create/reuse the Front Door webhook routine by inspecting the native routine tool schema. [The redacted routine file](../../routines/photon-imessage-wake.REDACTED.json) is a descriptive contract, not a fabricated create-tool payload. Record wake-routine intent and actual receipt. The body is batchId only; the bot privately retains returned URL/bearer. If the tool cannot provide a needed contract, report that specific integration gate without making up an API.

Write complete literal config through `bun run setup-state -- write-bridge-env --json-stdin`, with a bounded `{text: ...}` envelope prepared inside the secure setup executor. It contains SPECTRUM_PROJECT_ID, SPECTRUM_PROJECT_SECRET, AUTHORIZED_SENDER_ID, GROK_ORCHESTRATOR_WEBHOOK_URL and GROK_ORCHESTRATOR_WEBHOOK_KEY. Never paste these values into chat, source them as shell, or store them in the checkout. Record bridge-config evidence after validation. Existing credentials remain unchanged on a routine rerun.

## 5. Ready, start, then first text

```sh
bun run setup-state -- status
bun run preflight
bun run start
```

Require fullSetupComplete, six verified roles, actual sender/line/routine/config and verified Moonshine before first readiness. Start only through the locked launcher; verify one live owner. Process connection alone is not provider/device proof.

Only now give the bot's hosted iMessage line and invite the user to text it from the authorized identity (suggest hi). Atomic acceptance handles one greeting with confetti. A first question/non-text input also remains useful work; do not send a second celebration or write a marker. Report physical observation separately from provider acceptance.

## Optional Live Mini

Core setup does not require Live Mini. A connected Vercel account is not permission to deploy. If the user explicitly enables it, follow [live-mini-enable](../live-mini-enable/SKILL.md), reusing existing resources/keys and recording environment revision before deployment. Do not block first-text readiness on it.
