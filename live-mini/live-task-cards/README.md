# Live Task Cards host

This host provides dots, segments, stages and matrix task-progress layouts. It publishes read-only card JSON/HTML and retains ten logical active slots plus bounded history. It never executes the underlying task, purchases, approvals or cancellation. Ordinary progress changes JSON at the exact same URL.

The canonical photongrokbot integration is the [VM helper](../runtime/README.md) and [operating contract](../../docs/product-repair/OPERATING_CONTRACT.md). Initial presentation passes through the existing bridge outbox and host ledger; no second Spectrum client or direct-send adapter is installed. Front Door owns final replies.

From this directory with Node 22+:

```sh
npm ci
npm test
npm run check
npm run build
```

`npm run preview` serves local illustrative layouts only, with no messaging connection. Stop only the preview process created for your task after review; leave shared services untouched. The real runtime dependency is pinned @vercel/blob, bundled by the source build. Production supports durable Blob or Redis; local file storage is development-only.

Use [INSTALL.md](INSTALL.md), [SKILL.md](SKILL.md), [HANDOFF.md](HANDOFF.md), [API](docs/API.md) and [integration](docs/INTEGRATION.md). Source release lineage and files under evidence/ are dated records, not fresh claims that a live host/runtime/device passed.

Prefer dark matrix for meaningful staged tasks; light only when requested. Measured counts are facts, weighted matrix pacing is labelled estimate, and time/animation never confirms a stage or reaches completed by itself. Personal loaders remain explicit and owner-bound; a photo alone changes nothing. See [custom loaders](docs/CUSTOM_LOADERS.md).

A card's original identity and full URL remain stable across updates/restarts. New tasks may reuse a freed slot but never an old URL. Unknown initial presentation keeps its slot. Default archived retention is 30 days/100 records; active/waiting/unknown cards are not age-evicted. Host storage loss is not evidence that no card was sent.

Deployment is an explicitly authorized operation, not a consequence of connector availability. Keep preview/production namespaces separate and credentials private. Local code/tests, host reachability, provider acceptance and device rendering must be reported separately. No measured performance gain follows from shorter prompts alone.
