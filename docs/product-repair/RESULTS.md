# Product repair results

## Final integrated verification

The integrated branch `repair/product-integrated` passed its fresh full run at **`abb12a85283e327d64bcb2dc1d89b79b7b9c989d`**: **47 commands, zero failures; 265 named Bun tests, 132 host tests, seven embedded-skill tests, and 23 Node helper tests**. Frozen installs, TypeScript typecheck, host check/build, instruction consistency, source manifests and the 110-file host handoff check all passed. The preserved script-style validators also ran. [Full outputs](evidence/final-integrated-tests.json) and the [exact command/result ledger](evidence/final-checks.json) record this coordinator run separately from the independent runs below.

The final disposition is **24 locally fixed findings, two explicit deferrals; 92 PASS_LOCAL acceptance rows and M06 PARTIAL**. The per-finding table and independent reasoning below remain the review record. M06 did not execute a historical runtime rollback; after new external activity, recovery keeps old writers stopped and requires reconciliation or a forward fix. Provider, target VM, native provisioning, real Moonshine inference and device checks remain [unverified](UNVERIFIED.md).

[CHANGED_FILES.txt](CHANGED_FILES.txt) is the exact file inventory against audit base `8c710413c99a6fd8022727326ca682d267393953`. The [deployment/rollback runbook](DEPLOYMENT_ROLLBACK.md) includes executable locked recovery, export and migration procedures. The commit after this tested candidate only finalizes evidence, reports, the checkpoint and manifests; it changes no implementation or test content. The integrated checkout is the reviewable deliverable; no remote push/merge or deployment was performed.

## Independent review record

The independent frozen-install suite passed **46 commands with zero failures** at `1e565a42396564959bb7461be7d82b40a10a7ef9`: **263 named Bun tests, 132 host tests, seven embedded-skill tests, and 23 Node helper tests**, plus typecheck, host check and build. Repeated deterministic process/crash suites and helper recovery tests also passed. The review then reproduced and closed a standalone-export defect and a runbook execution gap with separate targeted checks at `c550d051453db80c3f338dbee19e5f9674b46782`: 56 tests and typecheck passed; the independent export reproduction now succeeds.

After the targeted fixes, the independent disposition is **24 FIXED locally and two DEFERRED** across all 26 original findings, with no known open implementation finding in this reviewed scope. The 93-row matrix is **92 PASS_LOCAL and one PARTIAL (M06)**. The original full-suite run preceded the export/runbook fixes; its historical boundary was 90 local passes and three partial rows (P08, M06, T01). The later targeted evidence closes P08 and T01 without relabeling that earlier run. This is not a 93/93 acceptance claim or deployment approval; the final integrated verification above supplies the coordinator full-suite result.

## Identity and scope

- Original baseline: `8c710413c99a6fd8022727326ca682d267393953`.
- Integrated F3 supplied for independent review: `2f8d0f733076ea4229cd34dd98f62ce9235479d6`.
- Independent acceptance tests and generated manifest committed before the full run: `1e565a42396564959bb7461be7d82b40a10a7ef9`, branch `repair/product-09`, isolated `09-review` worktree.
- Supplemental fixes: coordinator `02efdf7`/`e2b8f47`, storage `f720356`, and independent test-order correction `c550d05`; independently targeted-tested SHA `c550d051453db80c3f338dbee19e5f9674b46782`. Corresponding review-branch picks are `d5bda9d`, `917fb9b`, `879e63d`.
- This report and evidence are a later documentation delta. Lane 09 authored acceptance tests/reporting only; implementation fixes were cherry-picked from their owning lanes. The coordinator completed final integration, exact changed-file listing and the subsequent integrated verification recorded above.
- Tests used `PHOTON_TEST_MODE=1`, `NODE_ENV=test`, and a distinct canonical temporary `PHOTON_INSTANCE_DIR` per bridge test process. Fixtures were synthetic and removed afterward. Loopback test servers were local doubles. No default instance, live VM, real secret, provider send, iMessage, deployment or account/resource mutation was used.

The full executed-name mapping is [REVIEW_MATRIX.md](REVIEW_MATRIX.md), with structured requirements, exact test names, command labels and exits in [REVIEW_MATRIX.json](REVIEW_MATRIX.json). Every named test was matched against captured execution output, not inferred from its source or a lane handoff.

## Commands and observed results

Pinned executable directory: `/Users/darshan/Downloads/photongrokbot-product-repair/.repair-tools/node_modules/.bin`. Bun **1.4.2**, Node **22.23.3**, Python **3.12.6**, FFmpeg **7.1.1**. Frozen packages inspected: Spectrum **12.8.0**, heif2jpeg **0.1.6**, official Vercel Blob SDK **2.8.0**, TypeScript **6.0.3**. A real in-memory query in selected Bun measured SQLite **3.54.0**, source ID `2026-04-09 12:25:13 8fa8248e303219400c646a885e36dfc52eae33d83f4412e3f369b2be5373aapl`. These are local macOS facts, not target VM facts.

```sh
export PATH=/Users/darshan/Downloads/photongrokbot-product-repair/.repair-tools/node_modules/.bin:$PATH
PHOTON_TEST_BUN=/Users/darshan/Downloads/photongrokbot-product-repair/.repair-tools/node_modules/.bin/bun \
PHOTON_TEST_REPORT=/Users/darshan/Downloads/photongrokbot-product-repair/.review-evidence/full.json \
node scripts/test-product.mjs all
```

The root script performs frozen installs and discovers every bridge `.test.ts` file, giving each file its own temporary instance. It ran 38 isolated bridge files, bridge typecheck, five host commands, and the helper suite. [Raw full-suite evidence](evidence/review-full.json) retains every command label, exit and output; [command ledger](evidence/review-command-ledger.json) expands the exact commands and working directories.

| Command / working directory | Exit | Observation |
| --- | ---: | --- |
| `bun install --frozen-lockfile` / `bridge` | 0 | Fresh review install, then frozen check within full suite; no lockfile drift. |
| `npm ci` / `live-mini/live-task-cards` | 0 | Fresh review install, repeated by full suite. |
| `node scripts/test-product.mjs all` / repository root | 0 | 46 commands, zero failed; counts above. |
| `bun run typecheck` / `bridge` | 0 | Included in full suite. |
| `npm test`, `npm run test:skill`, `npm run check`, `npm run build` / host | 0 each | 132 tests, seven skill tests, validated bundle/build. |
| `node --test live-mini/runtime/live-card-milestones.test.mjs` / root | 0 | 23 tests; selected Bun explicitly propagated for child controls. |
| `bun test src/tests/storage/process.test.ts` / `bridge`, three extra runs | 0 each | 23 tests per run, including concurrent processes and commit-boundary deaths. |
| `bun test src/delivery-process.test.ts` / `bridge`, three extra runs | 0 each | Five tests per run, including fake provider effect followed by SIGKILL. |
| `bun test src/inbound-process.test.ts` / `bridge`, three extra runs | 0 each | Five tests per run, receiver/controller commit boundaries. |
| Helper command above, one extra run | 0 | 23 more passing tests, including four Node SIGKILL and four lost-response cases. |
| `bun run --cwd bridge check:instructions` / root | 0 | `INSTRUCTIONS_OK` at tested SHA. |
| `bun run --cwd bridge scripts/refresh-manifests.ts --check` / root | 0 | 352 manifest entries at tested SHA. |
| `npm run --prefix live-mini/live-task-cards verify:handoff` / root | 0 | 110 host files checked. |
| Actual export/read-only diagnostic / disposable fixture | 0 diagnostic process | **Behavior failed:** successful export, then first query gives `SQLITE_CANTOPEN`; the diagnostic catches and records the error. |

[Repeated-run evidence](evidence/review-stress.json) records exact commands, exits and outputs: 99 additional Bun test executions and 23 additional helper tests. Repetition is supplementary; race correctness comes from deterministic barriers/fault points and real separate processes, not a random pass count.

Five retained historical script-style validators (`inbound`, `outbound-app`, `outbound-effect`, `outbound-poll`, `outbound-text`) report zero named Bun tests while running their original assertions and emitting their `ALL_*_TESTS_PASSED` markers. They are included in the 38 files, not added to the 263 named-test count. No skipped/todo/only test directive was identified. The unchanged optional `tests/custom-loader-browser.mjs` is outside package scripts and was not executed; browser/physical-device rendering is not claimed.

## Supplemental independent verification

The full suite above remains attributed to `1e565a4`. After the code/doc fixes and the test-only ordering correction were committed, these targeted commands ran at `c550d051453db80c3f338dbee19e5f9674b46782`, each using the pinned Bun and a distinct guarded private temporary root:

| Command, from `bridge/` | Exit | Observed |
| --- | ---: | --- |
| `bun test src/tests/acceptance/recovery-runbook.test.ts` | 0 | Two tests, 53 assertions; all corrected maintenance entrypoints exercised. |
| `bun test src/tests/storage/storage.test.ts` | 0 | 48 tests, 243 assertions; consistent standalone snapshot and existing store contracts. |
| `bun test src/tests/acceptance/review.test.ts` | 0 | Six tests, 69 assertions; independent cross-boundary regressions still pass. |
| `bun run typecheck` | 0 | Full bridge typecheck. |
| Original independent export probe, pointed at the fixed source | 0 | First readonly query succeeds, header read version 1, no WAL/SHM sidecars before opening. |

[Exact targeted commands and output](evidence/review-followup.json) and the [fixed export probe](evidence/review-export-fixed.json) are separate from original full evidence. The changed backup implementation, its new real-SQLite regression, all corrected runbook examples and the executable recovery test were independently inspected. No new implementation defect was found in that focused review. The full integrated suite has not been relabelled as executed at this later commit; the coordinator must run it after integrating all review artifacts.

## Per-finding disposition after the independently tested followups

“FIXED” below means reviewed implementation and executed local regression evidence support the original code repair. It does not assert real provider acceptance, VM durability, or device behavior. Matrix IDs link each item to exact named tests and expected/observed boundaries. Commit references identify the implementation and important followup changes, all ancestors of the supplemental tested commit. Original full-suite mappings retain their own earlier SHA.

| Finding | Status | Implementation / commits | Independent evidence and limit |
| --- | --- | --- | --- |
| REL-01 Marketplace packaging | DEFERRED | Explicit user scope; no packaging/publication repair. | Marketplace compliance, discovery and asset rights remain unverified. |
| SEC-01 private default paths | FIXED | `.gitignore`, `shared/instance-paths.mjs`, helper; `4008a20`, `ceef54a`, `6e46d1f`. | P01–P05, S03, H03/H08; paths, modes, tracked-file distinction, instance isolation and guard rejection pass. |
| INS-01 personal active instructions | FIXED | Operating profiles, memory templates and checker; `dbc83fb`. | T02–T04 plus current-tree scan; active roster removed. One inactive source comment is advisory in SECURITY_REVIEW. |
| DAT-01 competing queue writers | FIXED | `storage.ts`, canonical submit/CLI; `05bec25`, `582d972`, `5375af4`. | D01/D05/D06, C01; separate-process acknowledged writes survive and all child bubbles commit together. |
| DAT-02 inbound crash order | FIXED | `storage.ts`, `inbound-controller.ts`; `05bec25`, `2dc516a`, `3677b1a`, `993f705`. | D02/D03, U01–U08; receiver and batch/wake SIGKILL boundaries, exact conversation/line dedupe. |
| DAT-03 corrupt state becomes empty | FIXED | SQLite schema/open, migration importer; `05bec25`, `520dd0a`, `6e20b6b`. | D04, R01/R02, M01–M05; malformed state fails closed and unknown evidence remains quarantined. |
| UX-01 contextual casual shortcut | FIXED | `greeting.ts`, inbound controller; `2dc516a`. | U06/U07 and greeting tests; acknowledgments and mixed reactions reach Front Door. |
| UX-02 onboarding/confetti ownership | FIXED | `onboarding.ts`, store, runtime, active profiles; `05bec25`, `2dc516a`, `dbc83fb`. | U01–U05, O07; one durable greeting/effect operation, later real question retained. No device celebration observed. |
| REL-02 batch invocation ownership | FIXED | `batch-claim.ts`, fenced store, controls; `05bec25`, `5818c4e`, `f8aa929`. | C01–C04, X02/X03; same bot is not same run, stale generation rejected, uncertain handoff not repeated. Native tool receipt semantics remain gated. |
| REL-03 ambiguous provider retry | FIXED | dispatcher, provider outcomes, reply fallback; `582d972`, `8dd753a`, `1685789`. | O01–O09, delivery SIGKILL, REVIEW uncertain-effect restart; no blind retry or fallback after ambiguous effect. |
| REL-04 card delivery race | FIXED | `cards-ready.ts`, canonical submit/store; `582d972`, `1813f7d`, `905fa96`. | K01–K04 and task-card reservation tests; exact grouped operation wins, metadata alignment and single initial card enforced. |
| LIV-01 Blob create/CAS | FIXED | official SDK-backed store; `8bb2d0e`. | L01–L06; deterministic absent-read/create conflict, valid validator, bounded conflict/lost response. Actual Blob service untested. |
| LIV-02 stale helper conflict overwrite | FIXED | `live-card-milestones.mjs`; `6e46d1f`, `44bd1a3`. | H01/H02/H05; no stale rebase or new request suffix, recovery identity preserved. |
| INS-02 routing/placeholders | FIXED | Profiles, skills, role generation/checker; `dbc83fb`. | T02–T04; canonical role vocabulary and bugfix/feature ownership agree. Supplemental T01 maintenance examples execute successfully. |
| SEC-02 implicit Vercel consent | FIXED | setup feature/revision authorization, Live Mini instructions; `ceef54a`, `4c171c5`, `dbc83fb`. | S04, T04; no generic setup deployment authorization, changed environment requires recorded review. No deployment exercised. |
| CTX-01 conversation/reply context | FIXED | inbound shaping, store, send adapter; `2dc516a`, `4c8fbf4`, `993f705`. | U08, X01, REVIEW same-ID per conversation/line; exact original target/destination preserved. Locked SDK fields checked locally. |
| MED-01 blocking voice | FIXED | attachment stream, media worker, bounded subprocess/STT; `128c2e5`, `f467cd0`, `b2efa7c`. | A01–A07 and independent actual controller→worker stream test; late text progresses, bounded cancel and exact enrichment. Real Moonshine inference untested. |
| SEC-03 privacy/retention | FIXED | Privacy/export/store; `ceef54a`, `e28d9df`, `6e20b6b`, `f720356`. | P06/P07 and P08 scope/prune pass. Supplemental real SQLite and CLI export tests now pass first read-only query, integrity, committed-WAL content and credential exclusion; independent reproduction turns green. |
| SET-01 resumable setup | FIXED | `setup-state.ts`, private configuration/bootstrap; `ceef54a`, `6e20b6b`. | S01–S05, R01; resume preserves identities, unknown native creation requires reconciliation, intent-only/empty/schema-first bootstrap disk states recover. Actual provisioning not executed. |
| OPS-01 bounded loops/shutdown | FIXED | job loop, runtime, wake/dispatch workers, activity; `29f40c7`, `3677b1a`, `aae31ac`, `80bf1c7`. | W01–W04/O09/A02, process lock tests; non-overlap, bounded shutdown, uncertain typing cleanup, no lease steal. Supplemental T01 uses verified direct source entrypoints under the lock. |
| LIV-03 exposed lower-level send | FIXED | helper + presentation control + profile; `6e46d1f`, `1651b9b`, `905fa96`, `dbc83fb`. | H04–H08, X04/X05; original-task binding, one bridge action and ledger settlement, no replacement on unknown. |
| LIV-04 URL check after overwrite | FIXED | helper context validation; `6e46d1f`. | H03; changed token or path rejects before overwrite and preserves previous context byte-for-byte. |
| LIV-05 custom Blob client burden | FIXED | pinned official SDK, bundled host build; `8bb2d0e`. | B01/B02 and L01–L06; standalone artifact imports and serves assets without checkout/credentials. Hosted deployment untested. |
| SEC-04 prompts used as authorization | FIXED | inbound authorization, fenced submission and task presentation; `2dc516a`, `582d972`, `1813f7d`, `44bd1a3`. | X01–X05, U04, H04; unauthorized input, changed destination, stale claim and arbitrary second card action rejected in code. |
| TST-01 critical release evidence | FIXED | Test harness, process barriers and independent tests; `410a875`, `8dd753a`, `3677b1a`, `6e46d1f`, `1e565a4`, `02efdf7`, `e2b8f47`, `c550d05`. | Full suites plus targeted followups support 92 local matrix rows. New real export/recovery tests catch the previously missed boundary. M06 historical rollback and external lifecycle/provider/device checks remain explicitly unexecuted; no universal release-proof claim. |
| EFF-01 role/lazy-setup redesign | DEFERRED | Explicit user scope: preserve one Spectrum runtime, six roles, required STT and existing modalities. | No role simplification or lazy-setup redesign was introduced. |

## Review discoveries, closure, and remaining boundary

**P08: standalone export defect, independently reproduced and fixed.** A real store with a committed synthetic event/batch was exported through `exportInstance` preview/apply. Export returned `applied:true`; the export directory had no WAL/SHM files, the serialized SQLite header retained read version 2, and its first `Database(path, {readonly:true})` query against `sqlite_master` threw `SQLITE_CANTOPEN`. This is not a credential or scope leak; it is unusable first-read backup behavior. [Diagnostic output](evidence/review-export-probe.json) and [preserved source](evidence/review-export-probe.ts.txt) record the reproduction. Existing P08 tests use a fake backup writer and did not detect it. Fix `f720356` uses `VACUUM INTO` in a private temporary directory, bounded copy to an exclusively created private destination, and file/directory sync. At `c550d051453db80c3f338dbee19e5f9674b46782`, the new storage test verifies first read-only access, integrity, committed WAL rows, immutability after later source writes, DELETE journal mode, private mode and no sidecars; all pass. The actual export CLI test and the original independent probe both pass. [Fixed probe output](evidence/review-export-fixed.json) records read version 1 and `READ_ONLY_QUERY_OK`. The live source remains WAL. No actual VM backup/restore is claimed.

**T01: incomplete operating-command execution, fixed and exercised.** The runbook references offline outbound reconciliation without an executable walkthrough, and the coordinator reproduced inherited lock-FD loss when its Python lock wrapper launches `bun run <package-script>`. Direct `bun run src/<entry>.ts` retains the descriptor. Existing checker/tests validated links and several commands but did not execute every wrapper example. Coordinator commits `02efdf7` and `e2b8f47` correct all three protected examples and add real CLI coverage. Independently rerun at `c550d051453db80c3f338dbee19e5f9674b46782`, the two runbook tests execute 12 command invocations: original unknown-operation accepted/cancelled reconciliation, refusal without the lock, refusal of accepted state without a message reference, original status checks, export preview/apply/read-only verification, and prune preview/refusal/locked apply. The maintenance commands preserve original IDs and attempts, do not create an eligible resend, and exclude the seeded secret. The old alias FD diagnosis is attributed to the coordinator; this review independently verifies the corrected commands and their lock rejection boundary. The added prune assertion initially assumed list order and failed with the same retained IDs in reverse order; `c550d05` correctly compares sorted identity sets. [Historical failing assertion](evidence/review-followup-order-assertion.json) is preserved; final targeted results are all green.

**M06: intentionally partial rollback evidence.** Tests execute refusal of a live old PID, stopped-writer attestation, the cutover marker, and zero eligible imported sends. They do not launch historical code rollback. Once the new runtime has accepted input or performed an external operation, the runbook prohibits old JSON writers and requires preservation/reconciliation or a forward repair. No automatic reverse migration is claimed or simulated. After the two fixes, M06 remains partial unless a separately scoped safe lifecycle check is actually performed.

## Synthetic migration observation

The independent executable migration test used a new private fixture and copied synthetic legacy JSON, not a live legacy directory. It ran `src/migrate-legacy-state.ts` directly, and apply/rerun ran beneath the actual Python instance lock with explicit `--writers-stopped`.

| Check | Expected | Observed |
| --- | --- | --- |
| Dry-run | Neither source nor target mutates | Source file digests and target SQLite bytes unchanged; reported two outbound records. |
| Apply | Preserve ambiguous/accepted evidence without dispatch | Two records imported: one old queued record became `unknown`, one old sent record remained `accepted` with its synthetic reference. Eligible-send claim returned none. |
| Ancillary state | Preserve poll and onboarding provenance | One poll mapping retained. Onboarding remained reserved/`legacy-recorded`, with `deviceObserved:false`. |
| Exact rerun | No duplicate import | `alreadyImported:true`; still two records. |
| Changed source | Refuse implicit second migration | CLI exited 1; existing two records unchanged. |

The storage migration suite additionally exercised handled identities, pending/batch relationships, grouped references, complete mini-app sessions, unresolved native work, malformed/unreadable sources and backup manifests. Those exact test names are mapped in M01–M06. Nothing was resent, no unknown state became device-observed, and no rollback to a historical writer was performed. Follow [MIGRATION.md](MIGRATION.md) and the [deployment/rollback runbook](DEPLOYMENT_ROLLBACK.md); their corrected protected entrypoints were included in the targeted followup.

## Architecture, compatibility, and scan observations

Source inspection finds one production Spectrum construction in `runtime.ts`; runtime and helper use the canonical store/control paths. Legacy mutable-JSON queue references are confined to explicit migration. No shadow outbox, unconditional existing-Blob overwrite, fabricated strong ETag, stale-request-ID workaround, or broad reply-failure resend was found on the reviewed supported paths. Six core roles, mandatory first-setup Moonshine readiness, one installation greeting/confetti operation, and text, bubbles, reply, reaction, poll, voice, typing, grouped attachments, app, app-update and effects remain represented in implementation and executed tests. Task-card progress intentionally uses same-URL state updates and forbids a second initial send/app-edit bypass.

The 14 original bridge test files remain and executed. Reversed old expectations (same-bot claim resume and greeting mixed with reaction) match the explicit replacement contract rather than hidden feature removal. Existing host suites and embedded skill tests also executed; the optional custom-loader browser script remained unchanged and unexecuted.

Current tracked text and all five PNG assets were scanned and inspected without secret-value disclosure or credential validation. No actual credential/private key/real capability was identified; one inactive comment is advisory. See [SECURITY_REVIEW.md](SECURITY_REVIEW.md) and its sanitized evidence. Rights/licensing are not established by that inspection.

## Gates before any separately authorized deployment

1. Integrate this review and run the coordinator's final full suite and manifests at the final source commit. Independent focused verification of the export and lock-example fixes is complete; preserve both that evidence and the M06 boundary.
2. Verify the actual persistent VM filesystem, SQLite version/source, startup supervisor, one-process lifetime lock and daemon/reboot recovery with explicit VM authorization. Local APFS tests do not prove VM durability.
3. Verify native Grok role/routine/tool schema and acceptance receipts; install/prove real bounded Moonshine inference under actual VM limits. Current SIGKILL setup tests materialize equivalent disk states; they do not interrupt real provisioning APIs.
4. With separate provider authorization, verify Spectrum operation results and reconciliation, Blob create-only/CAS behavior, and hosted artifact runtime. Local SDK-shaped doubles, generated builds and loopback HTTP do not establish those services.
5. With separate device authorization, observe first-use greeting/confetti, exact conversation/reply routing, attachment groups, reactions, voice and live-card rendering. Record provider acceptance and phone observations separately. Never use unknown delivery as permission to resend.
6. Review Marketplace packaging and asset rights only when that deferred scope is opened. Use [UNVERIFIED.md](UNVERIFIED.md), [PRIVACY.md](PRIVACY.md), and [DEPLOYMENT_ROLLBACK.md](DEPLOYMENT_ROLLBACK.md) for the operational boundaries.

No deployment, push, merge, resource change, provider send, private-data export from a real instance, credential rotation, or historical-state rewrite was performed by this review.
