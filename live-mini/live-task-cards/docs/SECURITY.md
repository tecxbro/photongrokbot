# Security and operating limits

This is a one-user/setup publishing host. A single server-side publisher token grants access to that setup's card API. Workers sharing it are trusted publishers; this is not per-worker isolation or a multi-tenant authorization system. Route calls through the existing runtime's task/recipient checks.

The read URL contains an HMAC-derived capability bound to one slot and unique card ID. It is read-only, not an authenticated identity. Anyone with the complete URL can view the card. Query strings can appear in browser history and hosting logs. Use minimal status summaries; do not put passwords, tokens, private message bodies, addresses or sensitive research inside a broadly shareable progress card.

Private pages and view JSON use no-store, no-referrer, noindex and a restrictive script/resource policy. The browser never receives the publisher token, Redis credential, task conversation reference or provider session. There are no cross-origin API grants, forms, user-action routes or external assets. Load/GET never executes work.

Header assets are local and allowlisted. Text is escaped for both HTML and JSON bootstrap. Content accepts no raw HTML/CSS/JavaScript or user-defined URLs. The writer token and view secret must differ. Change/rotate them through deliberate deployment procedures; rotating the view secret invalidates existing read links.

The Redis store uses atomic EVAL compare-and-swap against a bounded document. It is designed for small, personal ten-slot workloads, not a high-throughput multi-tenant service. Reads fetch that registry internally; the public response includes one permitted card only. Use durable, non-evicting storage. Back up that namespace. Infrastructure data loss cannot safely be interpreted as proof that no messages were sent.

The default archive is bounded by 30 days/100 records; active and unknown assignments are not evicted by age. Adjust that product retention policy deliberately. There is a 3 MB registry safety bound and a 16 KiB API request bound. The documented configuration caps do not establish a free or unlimited hosting budget.

Visible pages poll at a nominal ten seconds, stop when hidden or terminal, refresh on resume, and back off after failures. This makes network requests, not reasoning-model wakes. The code does not install cron jobs or poll Grok transcripts. A signed URL is not an anti-abuse service: use the authorized host's appropriate access/rate controls for deployment, without weakening unrelated account security.

Local file storage is development-only. The lock is not stolen on timeout. A crashed local lock needs a verified-dead owner and explicit removal of the lock alone. Do not delete the data file or reset production state to clear a conflict.

The presentation ledger prevents cooperative publishers from concurrently dispatching the same card operation. It cannot undo an already-sent provider request or guarantee exactly-once delivery by an external system. Unknown outcomes must be reconciled. No automatic unsend is implemented.

Personal loader changes require the publisher token plus explicit-user-request authorization in the trusted runtime. The host cannot infer consent from pixels or a boolean field. Bind task ownership to the actual requester, especially in shared conversations. Only validated numeric dot assets are served; no original photo, owner reference or cross-owner preference is included in card reads. Dot portraits are visible to holders of the existing card capability. Loader writes allow 192 KiB bodies, assets are capped at 128 KiB, and the existing 3 MB registry bound remains in force.
