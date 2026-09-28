# Exact replacement map

This is an index for the implementing coding agent. Existing paths and symbol names refer to commit `8c710413c99a6fd8022727326ca682d267393953`. Use symbol anchors rather than blindly applying historical line numbers. New files/interfaces are explicitly proposed in the lane briefs. These changes have **not** been applied to the repository.

## 1. Private secrets and generated state — owners 01 and 07

**Root `.gitignore`:** apply `patches/0001-ignore-private-instance-files.patch` after checking the actual diff. The original bridge and nested Live Mini host ignore files remain intact. Test both ignored private files and allowed empty examples. Already-tracked secrets need a separate reviewed response; adding an ignore rule does not untrack or rotate them.

**`live-mini/runtime/live-card-milestones.mjs`:** replace `DEFAULT_STATE_DIR = join(__dirname, 'state')` and `DEFAULT_SECRETS = join(INSTALL_ROOT, 'secrets', 'prod.env')` with the shared instance resolver's private `live-mini/context/` and `secrets/live-mini.env` paths. Keep explicit supported configuration overrides, but reject ambiguous/conflicting roots. No fallback that silently opens another instance.

Replace `statePath()`'s truncated/sanitized task name with a deterministic collision-resistant name derived from the full scoped installation/conversation/task identity. Do not put private identity strings in filenames unnecessarily. Replace direct `writeFileSync` of context with atomic private-file replacement under one serialized update path. Keep the full access URL privately for reuse; omit it from normal output/logs.

**`bridge/src/config.ts`, `bridge/scripts/start-runtime.sh`, `bridge/.env.example`:** one authoritative parser/resolver, not two shell/TypeScript interpretations. Do not make every arbitrary key in the file an environment override. Read the allowlisted private bridge fields; preserve existing values on setup rerun.

See lane 01/07 and tests P01–P08, H01–H08.

## 2. Shared queue, claims and crash ordering — owner 02; runtime wiring owner 00

**`bridge/src/storage.ts`:** replace the `withLock()` Promise chain and mutable JSON implementations of `enqueueOutbound`, `updateOutbound`, handled/pending/wake writes and batch reads with a single injected SQLite store. Every separate `bun run enqueue` process opens the same instance DB. A transaction owns read–modify–write; no old JSON queue writer remains.

Preserve text/poll/effect preparation as pure helpers. Insert every intended child bubble in one transaction with stable operation/sequence identity. Replace broad `readJson` fallback with missing-only initialization in the legacy importer and fail-closed validation everywhere else.

**`bridge/src/batch-claim.ts`:** replace `tryClaimBatch()` and completion's file-create/read/unlink logic with an atomic compare-and-update on a unique invocation/fencing generation. Same bot ID is not same run. Do not fix this merely by adding another Promise lock.

**`bridge/src/runtime.ts:onMessage()` and `flushPending()`:** replace “mark handled, then save input” and “clear pending, then write unread” with the atomic accept/batch/wake transactions. Read acknowledgement is after durable acceptance; processed status follows real processing progress, not receipt alone.

**`bridge/src/read-batch.ts`, `bridge/scripts/find-recent-msg.mjs`:** read bounded validated records through the DB/control interface, not raw mutable queue files.

See lane 02, PRODUCT_CONTRACT sections 3–5/9 and tests D01–D08, C01–C04, M01–M06.

## 3. Greeting, first-use confetti and conversation context — owner 05

**`bridge/src/greeting.ts`:** the acknowledgement/thanks vocabulary must no longer bypass the agent. `isGreetingOnlyBatch()` must reject every mixed non-text batch, including reactions. A safe post-onboarding greeting shortcut additionally needs trusted idle/no-pending-question state; default to Front Door when this is not available.

**`bridge/src/greeting.test.ts`:** reverse the expectation that “hi plus reaction” is eligible. Add pending-question + “okay,” card reaction + “okay,” and ordinary greeting controls.

**`bridge/src/setup-confetti.ts`:** stop treating an independent file boolean as authority. It becomes a wrapper over one installation-scoped onboarding operation in the transactional store. Atomically reserve/enqueue once; accepted/unknown/observed are distinct evidence states.

**`bridge/src/inbound.ts`, `bridge/src/types.ts`:** preserve reply target and original conversation/line metadata. Verify actual Spectrum fields before assigning them. No invented event fields to make a test pass.

**`runtime.ts`:** first `hi` takes onboarding, not a competing canned response. First real question still gets processed after the one greeting/confetti. Per-conversation batching replaces the global mixed pending batch.

See lane 05 and U01–U08.

## 4. Outbound send, cards and sender validation — owner 06

**`bridge/src/runtime.ts:drainOutbound/sendOutbound/scheduleRetry`:** delegate to the new typed delivery dispatcher, assembled by 00. Replace overlapping file scans with exclusive eligible-operation claims, durable attempts and normalized provider results. Retry only definitively unapplied transient failures. Recovered in-flight sends are uncertain, not newly queued.

**`bridge/src/reply-fallback.ts`:** remove the catch-all “try plain send after reply throws” behavior. A verified missing/unreplyable target can take a documented fallback. Timeout, ambiguous undefined and unclassified exceptions must not issue a second physical message.

**`bridge/src/cards-ready.ts`:** replace `outboundAlreadyCoversBatch` path-substring matching with unique logical group submission. Front Door and watchdog call the same submission path; one group operation wins. Match metadata to exact files without filtering one array and shifting the other.

**`bridge/src/enqueue.ts`:** add the implemented structured stdin operation contract. Derive/validate original destination and task/claim identity. Arbitrary `--space-id` or a path to `prod.env` must not bypass the authorized boundary. Keep existing normal usage through supported validated adapters; document explicit trusted operator-only actions separately.

**`bridge/src/reaction-option.ts`:** preserve exact original option identity/details/known price/direct URL. Any added emoji requests that information; removal is not an additional selection. Do not add sentiment-based rejection/shortlisting rules.

See lane 06 and O01–O09, X01–X05, K01–K06.

## 5. Voice/media and runtime loops — owners 03, 05 and 00

**`bridge/src/voice-stt.ts:ensureVoiceWav16k()`** must drain stdout/stderr while waiting, enforce a deadline, terminate/reap the child on timeout and validate generated audio. Do not assume a file named note.wav has the right sample format or belongs to this input.

**`transcribeVoiceWav()`, `bridge/tools/moonshine_stt.py`, `bridge/src/inbound-attachment.ts`:** bounded input/output sizes, duration and processing jobs; no private unbounded error dumps. Work from durable original media references. Keep mandatory installed model support; a warm worker is optional only after measured benefit and proper shutdown.

**`runtime.ts` receive loop:** quick durable acceptance, then a bounded media worker. Pending voice context remains explicit; later text is not globally blocked or falsely interpreted as if voice had already been understood.

**Webhook/drain/stop loops:** await non-overlapping jobs, bound network time, join or durably checkpoint work on shutdown; no process exit that leaves a send classified as definitely unapplied.

See lanes 03/05/00 and A01–A07, W01–W04.

## 6. Blob store — owner 04

**`live-mini/live-task-cards/src/store.mjs:BlobStore.put/transaction()`**: replace unconditional first overwrite with create-only semantics. The required distinction is:

```text
Read says absent:
  put deterministic pathname with addRandomSuffix=false, allowOverwrite=false.
  A documented already-exists conflict rereads and retries the transaction.
Read returns existing body + usable validator:
  put the mutated body conditionally against that exact validator.
Existing body but no usable validator:
  fail closed; never silently overwrite.
Timeout / uncertain outcome:
  preserve the logical request identity and reconcile; not a fresh operation.
```

**`src/vercel-blob-lite.mjs`:** use a pinned official SDK if the build can package it correctly, or retain an explicitly tested adapter. Do not strip W/ to invent strong-validator safety. Verify the installed SDK's actual error classes and create-conflict behavior rather than hardcoding guessed responses.

**Host `package.json`, `package-lock.json`, `scripts/build.mjs`:** dependencies must exist in the deployed artifact, not just the checkout. Normal build uses the complete versioned animation asset; do not fetch mutable executable JS from private production storage as a default fallback.

See lane 04 and L01–L06, B01–B02.

## 7. Live Mini helper — owner 07

**`live-mini/runtime/live-card-milestones.mjs:updateMilestone()`**: delete both branches that resubmit stale content with `fresh.revision`, including the branch creating a new `-reconcile-` request ID. Surface the conflict with redacted current revision or perform an explicitly authorized semantic merge. A safe default is no second write.

**`persistAfterWrite/assertSameUrl()`**: load previous context once **before** update, compare the full returned view URL against it, then persist. Preserve previous context on mismatch. A comparison after overwriting previous data cannot establish identity.

**`sendOnce()`**: no no-context escape hatch for task cards. Require task/card/destination binding, claim host presentation, enqueue the one stable bridge action, and settle the host from durable bridge status. Replace raw queue-file polling with the typed status interface. An HTTP settlement retry never reissues the Spectrum send.

**`agents/live-mini/PROFILE_TEMPLATE.md`** is changed by 08 to call the implemented canonical operation; plain `--app-url` remains for independent non-taskcard URLs.

See lane 07 and H01–H08.

## 8. Existing profiles/setup/docs — owner 08 after interfaces exist

Replace `{{MASTER_ORCHESTRATOR_BOT_ID}}` with the single canonical vocabulary `{{ORCHESTRATOR_BOT_ID}}` in templates; validate rather than rewriting tracked source with real IDs. Remove personal roster examples from active Front Door/Orchestrator/CHAT_VS_TASK instructions, not actual user bots/memory. Resolve configured workers from private instance state.

Replace broad bridge-change routing to Creator with one consistent bugfix/Feature Add rule. Mixed work must have a recorded owner/dependency plan, not refusal ping-pong. Separate setup privileges from normal wake duties.

Replace instructions to copy `.env.example` over existing state with resumable, preserve-first setup. Replace “Vercel listing succeeds, so deploy everything” with the recorded optional feature authorization and idempotent resource reuse. Preserve user browser/phone flow, mandatory six core roles/STT and first-use greeting+confetti.

Replace manually written handled/queue notes with actually implemented claim/handoff/enqueue commands. Do not put NEW internal command names into active skill instructions before they work. Keep Marketplace metadata/discovery out of this pass.

See lane 08 and T01–T05, S01–S05.
