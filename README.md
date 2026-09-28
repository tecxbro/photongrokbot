# Photon ↔ Grokbot iMessage build/setup kit

This is a Grokbot build/setup kit for connecting one Photon Spectrum hosted iMessage connection to six core Grokbot roles on the account's shared VM. Give Grokbot the [getting-started entry point](skills/getting-started/SKILL.md) and the desired setup scope. Grokbot reuses the kit, adapts the native integration, discovers account-specific configuration and verifies the installation; the human does not perform the technical setup. You approve device login and provide your sender identity if it is not already known. After setup passes, text the bot's hosted line from that authorized identity. The first supported message gets one greeting with confetti; a real question also reaches Front Door.

The [operating contract](docs/product-repair/OPERATING_CONTRACT.md) governs setup, claims, routing and delivery. [Architecture](01-ARCHITECTURE.md), [privacy](docs/product-repair/PRIVACY.md), [migration](docs/product-repair/MIGRATION.md), and [secret handling](02-SECRETS.md) describe the implementation boundaries.

The six required roles are Front Door, Master Orchestrator, Creator, Feature Add, Image Cards and App Sheet. Creator repairs existing behavior; Feature Add implements new capabilities. Front Door owns final user-facing responses. Roles share files and credentials on the same account VM; role names do not provide Unix isolation. Active identities come from the private verified setup registry, never from these templates.

Moonshine setup is mandatory before first readiness. Models and private state are installed outside this checkout. When media finishes after the first run, a durable continuation resumes the original request with its ready, failed or unavailable result. Text remains responsive and the bot reports failures accurately.

The bridge retains text, threaded replies, tapbacks, effects, polls, voice, attachments, grouped option cards, static app cards and supported app updates. Live Mini task cards are optional and follow the initial requested scope: a full-feature setup request already authorizes included Live Mini setup. Reuse the existing host/resources when present. Connecting Vercel alone does not authorize deployment. Initial task-card presentation uses the canonical helper/outbox; ordinary progress changes hosted JSON at the same URL.

## Install and verify code

Run from `bridge/` with the pinned Bun 1.4.2 runtime:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run scripts/check-instructions.ts
```

Production instance state defaults to `/workspace/photongrokbot-state`, or an explicitly selected private directory under `/workspace` through `PHOTON_INSTANCE_DIR`. The code checkout is not the state root. The [setup guide](skills/getting-started/SKILL.md) performs authorized bootstrap, verifies all six roles and Moonshine, and starts the one locked runtime.

Developer checks must set `PHOTON_TEST_MODE=1` and an explicit synthetic private root before importing bridge modules. Use the repository test harness and [test matrix](docs/product-repair/packet/TEST_MATRIX.md); local tests do not establish provider delivery or device rendering.

## Included source

- [Agents](agents/README.md), [skills](skills/README.md), [routine contract](routines/README.md).
- [Bridge](bridge/README.md) and compact policy references in [orchestrator memory](bridge/orchestrator-memory/README.md).
- [Moonshine installation](stt/INSTALL.md) with pinned packages/model hashes.
- [Optional Live Mini](live-mini/README.md), its host, and canonical VM helper.
- Vendored [Photon CLI](photon-skills/photon-cli/SKILL.md), [Spectrum](photon-skills/spectrum/SKILL.md) and [iMessage](photon-skills/imessage/SKILL.md) references; inspect locked package source and matching official documentation before relying on unknown SDK behavior.

No private state, credential values, personal worker registry or model weights belong in this repository. [Sharing boundaries](03-WHAT-NOT-IN-SHARE.md) apply to exports too. README.md and 00-README.md are checked as identical; regenerate inventory only after integration source is final.

Developer source inventory is generated with `bun run scripts/refresh-manifests.ts` from bridge/ after every integrated source/report change. Verify without mutation with `bun run scripts/refresh-manifests.ts --check`, then run the host's `npm run verify:handoff` from live-mini/live-task-cards/. This regenerates source digests, not a Marketplace release or deployment archive.
