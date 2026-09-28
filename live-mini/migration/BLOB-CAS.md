# Historical Blob CAS evidence and current source boundary

Historical snapshot: 2026-09-26 PT. The prior deployment notes described a slim client, validator rewriting, an occupied count of nine and a registry revision advancing from 22 to 23. Those were observations recorded for another source/deployment snapshot. They were not repeated in this product repair and do not establish the current user's host state. Original detailed logs remain in version history; no live registry or credential was read here.

Current source uses the pinned official @vercel/blob SDK through `src/blob-sdk.mjs`. Treat returned ETags as opaque; do not strip weak prefixes or invent conditional headers. Writes use documented SDK options for create-if-absent and version-matched replacement. Missing/corrupt/unreadable state cannot become an empty registry. No alternate slim implementation is substituted during build.

Production and preview require separate registry namespaces. Preserve existing history, read URLs and secrets; no Redis/Upstash change is implied by Blob work. Validate the exact source build locally, then verify real conditional-write behavior only under explicit provider authorization. See [deployment notes](DEPLOY-NOTES.md), [installation](../live-task-cards/INSTALL.md) and [API](../live-task-cards/docs/API.md).
