# Canonical Grokbot integration

The [VM helper](../../runtime/README.md) is the sole integrated task-card entrypoint. The host owns stored card content/presentation ledger; the bridge owns the one Spectrum transport/outbox. A native task must already have a durable original binding and current invocation. Never accept a model-selected recipient or raw-send a task-card URL.

Initial presentation registers exact card/task/batch/destination/full URL, claims the host ledger, and queues one canonical operation. The actual send result settles that same host attempt. If local/provider acceptance is known but host settlement failed, replay settlement only; no additional Spectrum call. Missing/unknown evidence keeps the slot occupied and requires reconciliation.

Every update supplies an explicit expectedRevision and stable requestId for that exact payload. A retry of a lost response reuses both. A definitive revision conflict requires reading/reconciling state and an intentionally authored new operation; no automatic rebasing. Milestone calls persist pending/applied evidence through restart. No anonymous helper task key or process-global destination is accepted.

Progress replaces complete hosted content at the unchanged URL. Preserve stage IDs, template, theme and workflow budget unless the supported contract explicitly permits the requested change. Only confirmed evidence marks stages done. Matrix animation eases within the unlocked range and never writes progress or advances stages; old measured counts remain factual and are not converted to estimates.

Complete saves truthful terminal content and releases only after initial presentation is reconciled. Pending/unknown presentation prevents release. A new task may reuse a free slot but gets a new card identity; old URLs remain historical.

The source standalone example is a generic package integration reference, not a second production transport for photongrokbot. Do not install it alongside the canonical helper. Owner-bound loader hooks remain explicit; real request authorization/device behavior must be verified in the actual executor before enabling personalization.

The [API](API.md) documents host fields. The [operating contract](../../../docs/product-repair/OPERATING_CONTRACT.md) governs private claims and delivery. Provider acceptance and device display are separate evidence.
