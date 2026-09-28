# Parallel implementation plan

## Ownership and dependency graph

Use one conversation with a lead coordinator, not ten independent chats making architecture decisions. Use separate worktrees, each with a synthetic private instance. These are **coding subagents**, not additional persistent product bots.

| Lane | Owner and exclusive scope | Starts after |
|---|---|---|
| 00 | Integration, shared types/contracts, runtime.ts assembly, bridge dependency/scripts and final gate | First |
| 01 | Private paths/configuration, setup helpers, ignore rules, privacy/retention commands | F0 contracts |
| 02 | Transactional storage, migration, claims, database-backed control commands | F0 contracts |
| 03 | Attachment/STT subprocess and worker implementation | F0 contracts |
| 04 | Live Mini host Blob adapter, host dependency/build changes and host tests | F0 contracts |
| 05 | Inbound scheduling, conversation/greeting/onboarding behavior, native-wake job driver | Integrated F1: 01+02+03 |
| 06 | Validated submissions, dispatch, replies/cards/option mappings and uncertainty | Integrated F1: 01+02+03 |
| 07 | Live Mini helper/presentation integration and conflict handling | F2: 04+06 contracts integrated |
| 08 | All existing profiles/skills/instruction docs, updated after code contracts exist | F2; finalize after 07 |
| 09 | Independent regression/integration review and evidence | May design tests early; final on integrated F3 |

Practical waves: **00 → (01,02,03,04) → integrate F1 → (05,06) → integrate F2 → (07,08) → integrate F3 → 09**.

Do not maximize simultaneous subagents blindly. On the shared VM, cap heavy test/model/conversion processes to available CPU/RAM; a suggested starting point is at most three coding workers concurrently, with tests serialized when they are memory-heavy. This is a scheduling default, not a hardware fact.

## Shared-file rules

Only lane 00 edits `bridge/src/runtime.ts`, `bridge/src/types.ts`, `bridge/package.json`, `bridge/bun.lock`, `bridge/tsconfig.json`, shared contract/type declarations and root test orchestration/CI.

Lane 01 owns `shared/instance-paths.mjs` implementation after lane 00 freezes its interface. Lane 02 owns `bridge/src/storage.ts` and DB internals. No other lane independently patches them. A worker needing a shared edit submits a precise patch request/example call to lane 00/02 and receives an integrated contract revision.

Lane 04 owns Live Mini host `package.json`, lockfile and `scripts/build.mjs`; those are distinct from the bridge package. Lane 07 owns `live-mini/runtime/live-card-milestones.mjs`; lane 01 specifies new private paths but does not edit that helper. Lane 08 owns all existing operating Markdown/role/routine templates; other lanes write their proposed wording in their own handoff notes, not into competing copies of a SKILL file.

## Worktree creation and base handling

Record repository, canonical local path, branch, HEAD, parent/base, dirty paths and remote divergence. Avoid echoing token-bearing remote URLs. Verify origin is the requested repository using sanitized owner/repository identity.

Never delete, reset, stash, clean, or recreate an existing worktree automatically. If the exact audit commit is not current, inspect changes and establish an explicit implementation base from the user's current work. A finding already repaired upstream is closed with evidence instead of overwritten.

Example commands, **templates for the coding agent**, not something already executed:

```bash
# Run from a VERIFIED development checkout, never the live runtime checkout.
git status --short
git worktree list --porcelain
git rev-parse HEAD
# Set these from verified paths and refs; do not paste angle-bracket placeholders literally.
# git worktree add -b repair/product-00 "$WORKTREE_PARENT/00-integration" "$IMPLEMENTATION_BASE"
# After the lead freezes F0:
# git worktree add -b repair/product-02 "$WORKTREE_PARENT/02-state" "$F0_SHA"
```

The worktree parent lives outside the tracked source tree. Branch names may be reused only if the worktree/HEAD/owner match the recorded checkpoint. Each later wave starts from the integrated commit with its dependencies, not from the original audit base.

## Frozen contracts before parallel work

Lane 00 writes `docs/product-repair/CONTRACTS.md` defining canonical instance paths, serialized data types, storage ports, claim tokens, structured enqueue payload, normalized provider result, media event lifecycle, card delivery and status interfaces. It also writes `VERIFIED_CONTRACTS.md` with known and unresolved external contracts.

Use type-only definitions or explicit unimplemented development stubs behind test-only dependency injection. Do not leave a successful no-op in a production path. F0 is a development coordination checkpoint, not a release candidate. Validate import/ownership coherence before workers start.

## Completion protocol for every lane

Return a committed diff on the lane branch; list exact files changed and why, commands run with exit codes, new test names/results, actual runtime/dependency versions, remaining integration edits and narrowly scoped unknowns. Add a small `docs/product-repair/lanes/<lane>.md` checkpoint owned by that lane.

The coordinator merges/cherry-picks dependencies into the integration worktree, updates shared wiring once, and reruns the full impacted suites. Individual worker greens are not an integrated release result. No worker pushes remotely or touches live services.

## Splitting a large lane

Lane 02 can internally split DB/migration and concurrency tests; lane 06 can split pure provider adapter and card mapping logic. Children own non-overlapping new files. The lane owner integrates before returning one coherent result. Do not create more independent storage implementations, outbox models, or protocol clients.

## Context-window checkpoint

Write the base/F0/F1/F2/F3 SHAs, worktree map, tests and next concrete task into `docs/product-repair/CHECKPOINT.md`. Do not checkpoint secrets or live message bodies. A continuation reads that file and checks actual worktree state before changing anything. Missing evidence remains missing; don't turn an interrupted task into “done.”
