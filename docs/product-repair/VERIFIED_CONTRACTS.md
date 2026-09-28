# External contract evidence

Base lock pins spectrum-ts 12.8.0 and heif2jpeg 0.1.6. No upgrade of provider intended. Installed source verification follows local frozen install.

Primary references opened by coordinator: https://bun.com/docs/runtime/sqlite (sync driver, immediate transaction support, platform-dependent SQLite), https://www.sqlite.org/wal.html (local same-host WAL and patched build requirement), https://photon.codes/docs/llms.txt (select matching version). Runtime version alone is insufficient; query version/source id. System runtime probe is in BASELINE.md, selected runtime recheck pending.

Explicit external gates: actual VM filesystem/durability/daemon recovery, native Grok tool schema and acceptance receipt semantics, provider idempotency/reconciliation and actual device observations. No live provider calls, credentials, VM files or messages inspected. Unit mocks never establish device delivery.

## Locked Spectrum 12.8.0 local inspection

Paths below relative to bridge/node_modules; package resolved with frozen lock and integrity. Source line anchors are for this exact package, not a claim about deployed VM packages.

- `@spectrum-ts/imessage/dist/index.js:2341-2361` routes only message.reactionAdded into the unified stream; reactionRemoved is not mapped. `1365-1386` IDs include target guid, reaction sequence and optional part index. No invented selected field on universal reaction; addition is established by stream mapper. `994` reaction metadata.selected exists on full native-message metadata, distinct from synthetic event content.
- `buildMessageBase` ~1071 binds `space.id`, `space.phone`, actual sender and direction. `space.get` ~2899 requires phone when several dedicated lines; shared sentinel is literal `shared`. Store destination includes actual phone/sentinel, never supplied arbitrary override.
- `buildContentMessage` ~1203 wraps replies with content.target.id; original reply target must survive normalisation. Multi-part inbound group consists of child Messages `p:N/parent`; each preserves original parent/part index. Sticker attachments use normal attachment path when exposed. Only existing supported content is handled, no invented event fields.
- `getMessage` ~1280 returns undefined only for NotFoundError (or a requested child absent from actual group); other failures propagate. Thus a known local target with definitive lookup absence can use explicit reply fallback *before* any send. A reply send exception never justifies fallback.
- `core/dist/index.js:2549-2593` catches UnsupportedError as warn-and-skip/undefined; non-fire-and-forget missing message id throws. Raw undefined cannot generically mean success. `imessage/dist/index.js:2917-2965` returns message references for text/reply/reaction/content sends; typing/edit/read handlers return void after their remote call. Preflight poll target reactions/replies unsupported; app edit requires stored complete miniAppCardSession. Classify per operation, not all void the same.
- `imessage/dist/index.js:1847-1861` one group -> sendMultipart, parent guid and ordered `p:N/parent` children. Preserve all count/order/metadata. App session fields: chatGuid,messageGuid,sessionId,targetMessageGuid (`285` and `763`).
- `imessage/dist/index.js:2982` getAttachment(guid, phone) supports exact durable reference and line. Attachment/voice content expose read and stream (~1090); buffer-only residual can be avoided with stream where available.
- SDK constructs advanced client with autoIdempotency:true/retry:true. `@photon-ai/advanced-imessage/dist/client-NRHONKWO.js:1509-1515` generates a key per new RPC invocation. No exposed stable bridge operation key/reconciliation API established through Spectrum. Therefore no second Spectrum call after uncertain acceptance; internal retry is not bridge crash idempotency.

Official provider documentation: https://photon.codes/docs/spectrum-ts/providers/imessage/connection-and-routing and https://photon.codes/docs/spectrum-ts/providers/imessage/messaging-features (locked package remains authority for exact semantics).

## Lifetime process lock

Official flock reference https://man7.org/linux/man-pages/man2/flock.2.html and Python https://docs.python.org/3/library/fcntl.html were inspected. `with-instance-lock.py` opens one private regular lock file with O_NOFOLLOW, takes LOCK_EX|LOCK_NB, clears close-on-exec for that descriptor and execs the actual Bun process. The same process retains kernel ownership until exit; there is no timed lease/lockfile removal. `instance-lock.test.ts` executed separate-process contention, SIGKILL and subsequent acquisition (1 pass). VM Linux filesystem and launch/recovery verification remain gated. Bun FFI was considered but rejected because its official docs warn against production reliance.
