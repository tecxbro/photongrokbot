# Installation

## Verify the handoff snapshot

Use `artifacts/live-task-cards-handoff.tar.gz` and its `.sha256` sidecar supplied by the handoff. On macOS run `shasum -a 256 -c live-task-cards-handoff.tar.gz.sha256` in their directory (`sha256sum -c` on Linux), then extract into a new directory with `tar -xzf live-task-cards-handoff.tar.gz`.

Inside the extracted `live-task-cards` directory, run `npm run verify:handoff` before editing files, followed by `npm test`, `npm run check`, and `npm run build`. The manifest verifies the snapshot including required files that were untracked in the author's checkout. No dependency installation is required for these Node-only checks. Regenerate the archive after source changes rather than copying an old Git commit or the entire workspace.

## Local preview, no accounts required

Extract the archive into its own folder and run:

```sh
cd live-task-cards
node --version
npm test
npm run check
npm run preview
```

Node 22+ is required; the implementation was exercised locally with the version in `evidence/TEST_REPORT.md`. Open `http://127.0.0.1:3000`. This uses illustrative records only and does not start a messaging transport.

## Local authenticated publishing

Stop preview, then:

```sh
npm run init
npm run dev
```

`init` creates `.env` with two independent random secrets and owner-only permissions. It never overwrites existing configuration. The development store uses `.data/cards.json`. A cross-process lock and atomic rename protect updates. The data directory and `.env` are ignored by Git.

From another terminal in this folder:

```sh
npm run card -- doctor
npm run card -- create examples/research.json
npm run card -- slots
```

Create output includes the page's read-capability URL. Treat that output as private. The sample conversation ID is illustrative; replace it with the real authorized runtime reference before using a live workflow.

The CLI publishes the **page**. `examples/existing-runtime.mjs` supplies the initial-send-only integration using the existing Spectrum process.

## Vercel host

Reuse the authorized mini-app Vercel project for this user's setup. Configure it for this package, with `npm run build` as the build command and the Other/framework-none preset. The included Build Output API generator creates `.vercel/output` with one Node.js 22 function. It includes only application code, public assets and illustrative examples, not `.env` or state files.

Set these environment values using the existing authorized deployment tooling; do not paste real secrets into an ordinary chat response:

```text
PUBLIC_BASE_URL=https://<your-actual-production-host>
STORE=redis
PUBLISHER_TOKEN=<generated-random-secret-at-least-32-characters>
VIEW_SIGNING_SECRET=<another-generated-random-secret>
UPSTASH_REDIS_REST_URL=<configured-HTTPS-Redis-REST-endpoint>
UPSTASH_REDIS_REST_TOKEN=<configured-server-side-token>
REDIS_KEY=live-task-cards:v1:<unique-setup-name>
ARCHIVE_DAYS=30
MAX_ARCHIVED_CARDS=100
ENABLE_DEMOS=false
```

Use the existing configured storage service/account when appropriate. This package's production adapter is specifically Upstash-compatible Redis REST with EVAL support, not a generic PostgreSQL adapter. Configuring storage is a one-time deployment prerequisite, not a new database per task. Use a non-evicting durable database configuration; if the registry is lost, do not treat it as proof that no live cards exist.

The package intentionally rejects file-backed production persistence. A temporary serverless filesystem is not the registry. Do not change that guard to make a deployment pass.

Use distinct storage keys, view secrets and publisher secrets for preview and production. Do not let a preview write the production pool. Set `PUBLIC_BASE_URL` to the actual stable production origin, not a stale per-build preview URL.

Build locally:

```sh
npm run build
```

Deploy the built project through the already-authorized Vercel account/tool. This document and archive do not themselves create a deployment or grant billing authorization.

After deployment, check `/health` and the authenticated `/api/doctor`. Confirm that an authorized card URL can be loaded by the intended Spectrum surface. Do not disable unrelated or account-wide deployment protection to make that check pass. Public card reads rely on their narrowly scoped read key; publisher writes always require the writer credential.

## Existing runtime

Copy/import the supplied client, presenter and runtime attachment example into the existing process. Inject that process's installed Spectrum builders. Retain its exact `Space` object and sending-line context. Register only the implemented operations through the existing authenticated queue/tool mechanism. Read `docs/INTEGRATION.md`.

No package installation or test starts a new Spectrum client. No Photon credentials belong on the Vercel page host.

## Release, restart and rollback

### Stop temporary local servers after the task

Record the command, working directory, port, PID and terminal/tool session when starting a preview server, dev server or tunnel. Keep it running while the task or requested user review still needs it. Once that work is finished, stop only the temporary processes owned by this task, unless the user has asked to keep them running.

Send Ctrl-C through the recorded terminal/tool session first. For a detached process, inspect the recorded PID before stopping it (replace placeholders with the recorded values):

```sh
ps -p <recorded-pid> -o pid=,ppid=,command=
lsof -a -p <recorded-pid> -d cwd
lsof -nP -iTCP:<recorded-port> -sTCP:LISTEN
```

Confirm the PID, command, working directory and listener all identify the process this task started. Then use `kill -TERM <verified-pid>`. Recheck the PID and listener to confirm shutdown. If it remains running, investigate the same owned process before escalating; do not use a broad process-name kill or terminate an unrelated listener. Stop an owned temporary tunnel separately and verify its process exits too.

Keep the authorized Vercel deployment and durable storage available so the same card URLs continue to work after local cleanup. Do not shut down the shared Spectrum/Grokbot runtime, remove the deployment, delete task history, or rotate credentials as part of completing a task. Report the hosted URL and local cleanup outcome separately.

### Preserve hosted state

Do not wipe `.data/cards.json` or the Redis key on restart. Unknown/in-flight presentations retain their assignments. For a verified dead local development process that left a `.lock` directory, confirm the owner has stopped before manually removing only that lock; never remove the registry. Do not force-steal an active lock.

Application rollback must retain the same compatible storage namespace and view secret. The V1 registry uses schema 1 and rejects corrupt/unrecognized state. Do not downgrade by deleting state. Old card URLs remain bound to their original card, until the explicit historical retention policy makes them unavailable.

Disable card publishing through the existing runtime integration before removing a deployment. Continue normal iMessage text delivery through the original sender. Removing this package is not a reason to restart or replace the transport unless the existing deployment procedure requires it.

## Install the optional loader skill

Copy the complete `skills/dot-matrix-mini-app` directory into the actual executor's supported skill location, preserving references, scripts and assets. Follow `docs/CUSTOM_LOADERS.md` to register owner resolution and explicit-request authorization; copying the skill alone does not wire personalization. Do not overwrite a user's existing skill without checking its version/local changes. Run `npm run test:skill` to verify the bundled starter.
