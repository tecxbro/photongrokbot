# Documentation and evidence index

Checked during preparation on September 27, 2026 PT. These are primary sources. Read the exact versioned package source/types when a method contract is not specified by the docs. This packet does not authorize provider calls.

## GIT-IGNORE: Git ignore rules
https://git-scm.com/docs/gitignore
Verified official manual. Ignore rules apply to untracked files; they do not erase tracked history.

## GIT-CHECK: Git check-ignore
https://git-scm.com/docs/git-check-ignore
Verified official command reference. Use --no-index for rule diagnostics and separately inspect tracking.

## GIT-WORKTREE: Git worktree
https://git-scm.com/docs/git-worktree
Verified official reference for isolated linked worktrees. A worktree is not a separate production VM.

## BUN-SQLITE: Bun SQLite
https://bun.com/docs/runtime/sqlite
Verified native driver/transaction reference, including immediate transactions. Runtime version must still be pinned and tested.

## SQLITE-TXN: SQLite transactions
https://www.sqlite.org/lang_transaction.html
Verified transaction and concurrent-writer semantics.

## SQLITE-WAL: SQLite WAL
https://www.sqlite.org/wal.html
Verified same-host/filesystem constraints, busy handling and WAL-reset fix notes. Check the actual embedded SQLite build.

## SQLITE-BACKUP: SQLite backup
https://www.sqlite.org/backup.html
Verified official backup reference; copying only a live main DB can omit active WAL content.

## BUN-SPAWN: Bun subprocesses
https://bun.com/docs/runtime/child-process
Verified spawn/streams/process-lifecycle reference. Match the selected Bun version in tests.

## NODE-CHILD: Node subprocesses
https://nodejs.org/api/child_process.html
Verified official manual. The live host currently targets Node 22 in source; current reference alone does not establish every API on Node 22.

## GROK-WORK: Grok Bot work/shared computer
https://cursor.com/docs/grok-bot/work
Verified account bots share files/command credentials; /workspace is the documented durable project location. Public bot sharing does not share the account VM.

## GROK-RECOVERY: Grok Bot computer recovery
https://cursor.com/help/grok-bot/computer-recovery
Opened official recovery page. Do not infer arbitrary daemon uptime or file-sync SLA; inspect the actual environment.

## GROK-ROUTINES: Grok Bot routines
https://cursor.com/help/grok-bot/routines
Opened official routines page. Actual create/modify tool payloads and webhook acceptance details must come from the native tool schema, not guessed REST calls.

## PHOTON-INDEX: Photon documentation index
https://photon.codes/docs/llms.txt
Fetched official index; it distinguishes documentation versions. Select the contract matching the installed package and do not mix Stable/Beta.

## PHOTON-AUTH: Photon CLI authentication
https://photon.codes/docs/cli/authentication
Verified device login, --no-browser, credentials/config directory and project scoping. Bridge project secrets are not the CLI login token.

## PHOTON-INSTALL: Photon CLI installation
https://photon.codes/docs/cli/installation
Verified npm/binary installation and published checksum guidance. Pin a tested release, not arbitrary latest on every bootstrap.

## PHOTON-PROJECTS: Photon CLI projects
https://photon.codes/docs/cli/projects
Verified create/list/project flags and secret rotation behavior. Do not rotate existing secrets on routine setup reruns.

## PHOTON-SPECTRUM: Photon CLI Spectrum
https://photon.codes/docs/cli/spectrum
Verified users/lines/platform commands. Not authority for undocumented SDK response shapes.

## VERCEL-BLOB: Vercel Blob SDK
https://vercel.com/docs/vercel-blob/using-blob-sdk
Verified allowOverwrite/addRandomSuffix/ifMatch and ETag semantics. Use the actual pinned SDK error types; no invented conditional headers.

## Repository contract references pinned to the audit commit

- **SDK-CAPABILITIES:** [photon-skills/spectrum/capability-semantics.md](https://github.com/tecxbro/photongrokbot/blob/8c710413c99a6fd8022727326ca682d267393953/photon-skills/spectrum/capability-semantics.md)
- **SDK-PROVIDER:** [photon-skills/spectrum/providers/imessage.md](https://github.com/tecxbro/photongrokbot/blob/8c710413c99a6fd8022727326ca682d267393953/photon-skills/spectrum/providers/imessage.md)
- **SDK-MESSAGES:** [photon-skills/spectrum/messages.md](https://github.com/tecxbro/photongrokbot/blob/8c710413c99a6fd8022727326ca682d267393953/photon-skills/spectrum/messages.md)
- **LOCAL-STT:** [stt/INSTALL.md](https://github.com/tecxbro/photongrokbot/blob/8c710413c99a6fd8022727326ca682d267393953/stt/INSTALL.md)
- **LOCAL-STATE:** [bridge/src/storage.ts](https://github.com/tecxbro/photongrokbot/blob/8c710413c99a6fd8022727326ca682d267393953/bridge/src/storage.ts)
- **LOCAL-RUNTIME:** [bridge/src/runtime.ts](https://github.com/tecxbro/photongrokbot/blob/8c710413c99a6fd8022727326ca682d267393953/bridge/src/runtime.ts)
- **LOCAL-CONFIG:** [bridge/src/config.ts](https://github.com/tecxbro/photongrokbot/blob/8c710413c99a6fd8022727326ca682d267393953/bridge/src/config.ts)
- **LOCAL-LIVE-HELPER:** [live-mini/runtime/live-card-milestones.mjs](https://github.com/tecxbro/photongrokbot/blob/8c710413c99a6fd8022727326ca682d267393953/live-mini/runtime/live-card-milestones.mjs)
- **LOCAL-LIVE-SERVICE:** [live-mini/live-task-cards/src/service.mjs](https://github.com/tecxbro/photongrokbot/blob/8c710413c99a6fd8022727326ca682d267393953/live-mini/live-task-cards/src/service.mjs)
- **LOCAL-LIVE-PRESENTER:** [live-mini/live-task-cards/src/spectrum-presenter.mjs](https://github.com/tecxbro/photongrokbot/blob/8c710413c99a6fd8022727326ca682d267393953/live-mini/live-task-cards/src/spectrum-presenter.mjs)
- **LOCAL-LIVE-STORE:** [live-mini/live-task-cards/src/store.mjs](https://github.com/tecxbro/photongrokbot/blob/8c710413c99a6fd8022727326ca682d267393953/live-mini/live-task-cards/src/store.mjs)
- **LOCAL-LIVE-BUILD:** [live-mini/live-task-cards/scripts/build.mjs](https://github.com/tecxbro/photongrokbot/blob/8c710413c99a6fd8022727326ca682d267393953/live-mini/live-task-cards/scripts/build.mjs)

Vendored SDK references are repository evidence, not proof of the exact package installed on the VM. Read `bridge/bun.lock`, the resolved package version and installed provider implementation before changing the send adapter. Keep Photon docs/package/API-origin versions aligned.

## Explicitly unverified or inaccessible

- `live-mini/secrets/prod.env` returned Not Found at the base commit. No actual VM copy was read; do not claim to know its values. The helper definitely consumes PUBLIC_BASE_URL and PUBLISHER_TOKEN from that configured file when present.
- The linked Photon Stable index/skill page and the guessed Spectrum subsection URLs did not load reliably here. Do not treat those fetch failures as proof a capability does not exist. Use the official index and the repository-bundled version references, then inspect the locked SDK. Do not invent alternative commands or merge Beta contracts to fill a gap.
- Provider-supported send idempotency/correlation and per-operation undefined/error meaning require locked SDK evidence. Default unknown-result behavior is no blind resend.
- Native Grok tool schemas, persistent-process startup/resume and the actual VM filesystem/runtime versions require the bounded checks in VM_CHECK.md.
- The exact compiled Vercel artifact with an official Blob dependency and real conditional-write behavior were not executed here. Lane 04 must test the built artifact; real provider checks remain opt-in.
- Full source product tests are to be run by the implementing agent. This packet provides the regression requirements and narrow tested support tools, not a claim of a completed product build.
