# Required regression matrix

These are acceptance requirements, not already-passing tests. Every implemented lane reports the real test name, command, exit code and SHA next to these IDs. Use synthetic credentials, messages, assets and destinations. Never copy real conversations into fixtures.

Deterministic barriers and fault injection are required for races/crashes; repeated concurrent promises alone are not a multi-process test. A failure under the old code followed by a pass under the new code is the preferred evidence.

## Privacy and setup

| ID | Required assertion |
|---|---|
| P01 | Legacy prod.env/state paths are excluded by repository rules without relying on global Git excludes. |
| P02 | Tracked secrets are detected separately; adding ignore rules is not reported as untracking/history removal. |
| P03 | Sample .env.example files remain distributable; real .env/.env.bak/prod.env are excluded. |
| P04 | New private root is outside checkout, 0700; credential/private data files are 0600. |
| P05 | Path traversal, symlink escape, another instance and default live path in test mode are rejected. |
| P06 | Redacted inspection/doctor/errors never include seeded secret values, message bodies or full k= URLs. |
| P07 | Retention removes only eligible resolved data; unknown sends, active tasks and dedupe tombstones remain. |
| P08 | Export/delete/prune is instance-scoped, previewable and cannot follow symlinks into source/another project. |
| S01 | Interrupt/resume at every setup phase; rerun creates no duplicate bot/routine/project or changed key. |
| S02 | Existing private env is preserved; missing/conflicting required keys produce redacted diagnostics. |
| S03 | CLI file selection is consistent across start, enqueue, read-batch and Node Live Mini helper. |
| S04 | Generic iMessage setup does not provision Live Mini; explicit recorded enablement performs only missing authorized steps. |
| S05 | Core six roles and required Moonshine remain required for full first setup; later media failure does not disable text. |
| R01 | Same installation identity survives code update and restart; missing state after unexpected loss fails closed. |
| R02 | Wrong/missing persistent-workspace or unsupported SQLite build is surfaced; no silent fresh instance. |

## Transactions, claims and migration

| ID | Required assertion |
|---|---|
| D01 | Separate enqueue/status-update processes cannot lose any operation whose enqueue returned success. |
| D02 | Crash before/after input commit leaves each accepted provider event recoverable exactly once in local state. |
| D03 | Crash at batch formation/wake intent boundary cannot erase input or lose automatic recovery eligibility. |
| D04 | Malformed/permission-denied legacy files or corrupt DB cannot become an empty replacement. |
| D05 | Same logical operation+same payload returns original IDs; same key+changed payload conflicts. |
| D06 | Intended multi-bubble enqueue is one local transaction; partial child insertion rolls back. |
| D07 | Long retained history does not require scanning/rewriting every record for each new send. |
| D08 | DB-busy retries are bounded; network/media awaits never occur inside write transactions. |
| C01 | Two simultaneous invocations of the same bot for one batch have one claim winner. |
| C02 | Expired run cannot renew/complete/enqueue under a newer fencing generation. |
| C03 | No reaction/effect or native handoff is attempted before a valid processing claim. |
| C04 | Unknown native handoff acceptance retains its intent and is not blindly issued again. |
| M01 | Migration dry-run changes neither legacy input nor the target instance. |
| M02 | Rerun imports the same immutable source once; detects conflicting/changed legacy inputs. |
| M03 | Migration preserves poll/session/presentation/option and original-conversation mappings. |
| M04 | Ambiguous legacy queued sends become review-needed/unknown, not automatically resent. |
| M05 | Legacy celebrated marker preserves no-repeat behavior without being labelled device-observed. |
| M06 | Migration refuses a running old writer; simulated code rollback does not replay old already-sent queues. |

## Conversation, onboarding and wakes

| ID | Required assertion |
|---|---|
| U01 | First authorized hi produces one logical greeting-with-confetti and no competing canned/Front Door greeting. |
| U02 | First substantive question receives onboarding once AND reaches Front Door as useful work. |
| U03 | First supported voice/image triggers onboarding without requiring successful media processing. |
| U04 | Unauthorized input, outbound echo and pure receipt never trigger onboarding or private attachment read. |
| U05 | Duplicate first input/restart/unknown result reuse the original onboarding operation. |
| U06 | Pending question plus okay/yeah routes to Front Door rather than a canned acknowledgement. |
| U07 | Reaction plus greeting/okay cannot bypass card-selection handling. |
| U08 | Two authorized conversations remain isolated; reply to an older message retains its target. |
| W01 | Webhook payload contains batchId only; URL/bearer/body secrets are absent from logs. |
| W02 | HTTP acknowledgement is distinct from claimed/delegated/completed; abandoned unclaimed work remains recoverable. |
| W03 | Hanging network request has one in-flight attempt per job and bounded backoff; permanent rejection stops. |
| W04 | Shutdown leaves durable jobs/uncertain attempts, stops typing safely and prevents a second live Spectrum owner. |

## Delivery and authorization

| ID | Required assertion |
|---|---|
| O01 | Two dispatch processes or overlapping timer ticks do not send one operation twice. |
| O02 | Provider accepts then throws/times out: record unknown; no automatic fresh provider call. |
| O03 | Provider returns success but local settlement fails: restart preserves uncertainty/reference evidence. |
| O04 | Recovery of a sending attempt does not reset queued merely because the process/lease died. |
| O05 | Definitively unsupported reply permits documented fallback; ambiguous reply does not. |
| O06 | Provider references retained for all message modalities where supplied; control no-op/skip is honest. |
| O07 | Bubbles within one result remain ordered; unrelated conversations continue while one result is unknown. |
| O08 | Confirmed non-application retries are bounded; repeated permanent errors do not retry forever. |
| O09 | Typing follows real active/delegated state and stops on final/wait/cancel/failure; progress bubble alone is not final. |
| X01 | Payload destination cannot override original stored conversation/line/task binding. |
| X02 | Reply/react/update target from another conversation is rejected before SDK call. |
| X03 | Arbitrary secret path, directory, ../ traversal and symlink-to-secret cannot become an attachment. |
| X04 | Structured CLI rejects incompatible flags, missing values and unknown fields; shell characters are data. |
| X05 | Role string/authorized:true cannot create new rights through the supported API; valid authorized staging works. |
| K01 | Concurrent Front Door/watchdog card completion inserts one logical grouped send. |
| K02 | Queued/unknown/failed card entries are not equated to successful delivery by filename matching. |
| K03 | Missing middle attachment never shifts metadata to the wrong card. |
| K04 | Five/seven cards stay one group; expected count and provider parent/part mappings persist across restart. |
| K05 | Every added emoji on an option yields that exact known option details/price/direct URL, no sentiment action routing. |
| K06 | Ambiguous target asks once; removal is not a new selection; missing price is never invented. |

## Media, host and Live Mini lifecycle

| ID | Required assertion |
|---|---|
| A01 | Stalled media does not block persistence/routing of later text; pending-media context remains explicit. |
| A02 | FFmpeg/stdout/stderr pipe pressure cannot deadlock; timeout cancels and reaps the child. |
| A03 | WAV input sample rate/channels are validated or converted, not assumed from extension. |
| A04 | Oversized/truncated/malformed media fails within bounded time/resource limits. |
| A05 | Restart with missing durable provider reference reports unavailable, never selects a guessed recent attachment. |
| A06 | Interrupted media save leaves no file that is mistaken for ready output; paths stay safe. |
| A07 | Correlated transcript completion does not start a duplicate independent task; later failure leaves text usable. |
| L01 | Two simultaneous first Blob writes preserve both cards in different slots. |
| L02 | Existing missing/invalid/weak validator cannot trigger an unconditional update. |
| L03 | Seeded valid ETag conflict retries preserve both changes within bounded CAS budget. |
| L04 | Timeout after Blob commit is reconciled by original request identity; no invented new ID. |
| L05 | Unexpected 304/cache/error/corrupt registry does not initialize empty state. |
| L06 | Read-size and write-size limits are enforced; errors contain no private tokens/URLs. |
| B01 | Generated Vercel function imports dependency bundle and resolves local assets without source-tree dependencies. |
| B02 | Normal build uses committed verified assets and no production Blob credentials or mutable code fetch. |
| H01 | Stale milestone revision conflicts; helper never retries old content under the newest revision. |
| H02 | Idempotency conflict retains original request identity rather than manufacturing a reconcile suffix. |
| H03 | Changed full URL path or k token fails before helper state overwrite; old context survives. |
| H04 | No card send without stored card/task/original conversation context; supplied URL/space mismatch rejects. |
| H05 | Crash/lost response after create/claim/enqueue/send/settle recovers same identities without new physical send. |
| H06 | Unknown initial send keeps slot occupied and does not permit a replacement task card. |
| H07 | Normal milestones update same URL JSON only; terminal settled record releases without Spectrum edit/resend. |
| H08 | Node helper queries the canonical bridge status contract, never raw mutable queue JSON. |

## Instructions and final evidence

| ID | Required assertion |
|---|---|
| T01 | All operating CLI examples execute in a synthetic instance and point to existing paths. |
| T02 | Required role placeholders/vocabulary are consistent; disabled optional template placeholders are allowed only as templates. |
| T03 | No old personal roster is treated as active; generic policies and actual user histories are not deleted. |
| T04 | Bootstrap versus normal wake, one final-response owner, any-emoji cards and code-owned onboarding agree everywhere. |
| T05 | Original suites plus all new tests run from frozen installs at recorded SHA; historical evidence not relabelled. |

## Integration-only and external gates

Tests must fail rather than silently selecting the default production instance. Shared fixtures must permit concurrent suites without cross-test queue/config contamination. Preserve all original operation coverage and inspect any removed test.

Provider mocks establish local behavior, not real Photon/Vercel/Grok guarantees. A separately authorized disposable-instance check covers the actual locked SDK, Blob first-write semantics, native routine acceptance, VM recovery/startup and first phone greeting+confetti. Do not run that check during this coding task or claim device observation from provider acceptance.
