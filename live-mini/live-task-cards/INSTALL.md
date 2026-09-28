# Install the host and canonical helper

Read the [operating contract](../../docs/product-repair/OPERATING_CONTRACT.md) and [explicit enablement](../../skills/live-mini-enable/SKILL.md). Reuse the intended existing host/resources and preserve populated storage, keys and historical URLs. Connector access alone is not authorization to deploy.

## Source and local checks

Use the integrated product branch and verify its current manifests. Older release archives and evidence/ reports describe their own dated snapshots. Regenerate source digests only after source is final; do not claim an old archive sidecar describes a new tree.

From this directory, Node 22+:

```sh
npm ci
npm run verify:handoff
npm test
npm run check
npm run build
```

The build bundles pinned official @vercel/blob and actual application source into Vercel output. No alternate storage shim is generated. `npm run preview` is an optional synthetic local page preview, not a provider/device test. Do not use convenience .env/.data development defaults for real private instance state. For any authenticated local host, set DATA_FILE to a guarded private directory outside code and keep its complete environment private.

## Authorized host configuration

Configure the existing authorized Vercel project through its actual tool. Use stable bare HTTPS PUBLIC_BASE_URL, STORE=blob by default, private BLOB_READ_WRITE_TOKEN and unique BLOB_PATHNAME. Preserve existing namespace; preview has a separate namespace. Generate missing PUBLISHER_TOKEN and VIEW_SIGNING_SECRET as distinct random values of at least 32 characters; never rotate present values on rerun or paste them into chat. Existing Redis uses its actual durable REST configuration only through deliberate migration/compatibility work. Production file storage is rejected.

Set environment before final deployment, then record the exact environment revision in private setup. Host health/doctor and real conditional writes require authorized provider checks. Do not weaken account-wide deployment protection or create another registry to bypass a failure.

## VM integration and rollback

Install the [canonical helper](../runtime/README.md) on the shared VM with the private instance. It derives task/destination from durable state and initial presentation from the host ledger, then enqueues through the one Spectrum runtime. Do not install the standalone examples as an independent production sender. Ordinary progress updates the exact same URL.

Unknown initial sends retain their identity and slot. Reconcile provider/native evidence before any retry or release. Code rollback must keep compatible state, host namespace and view secret. Follow [migration](../../docs/product-repair/MIGRATION.md) and [deployment/rollback](../../docs/product-repair/DEPLOYMENT_ROLLBACK.md).

Record PID/cwd/port/session for temporary previews. Stop only that owned process after review, verify exit, and keep persistent Vercel/storage/shared Spectrum services available. No broad kill command, namespace reset or credential rotation is cleanup.
