# Authorized Live Mini deployment notes

Explicit Live Mini enablement is required. A connected Vercel account is not sufficient authority. Once enabled, use sensible defaults without a questionnaire, preserving existing project/namespace/keys and creating only missing resources. Record intent before each provider mutation; reconcile an unknown response before another attempt.

Default new persistence is private Blob using the pinned official SDK. Existing Redis installations require a deliberate compatibility decision; do not touch Redis during unrelated Blob repairs. Production rejects file storage. Use separate preview and production namespaces and stable HTTPS PUBLIC_BASE_URL. Publisher and view-signing secrets must differ and remain private; preserve them on rerun.

From live-task-cards/ run `npm ci`, `npm test`, `npm run check`, `npm run build`. The emitted Vercel output uses the real source and dependency bundle. Deploy only that host mini-app/API through the actual authorized tool; the canonical VM helper stays with the bot/runtime. Set environment before final build/deploy and record its exact setup environment revision. No download or rewritten storage shim may alter deployment semantics.

After an authorized deployment, check public health and authenticated doctor, exact storage namespace, conditional updates and stable URL behavior. Canonical initial presentation and two same-URL updates then require separately authorized provider/device checks. Health, local tests, provider acceptance and physical display are different evidence. Never send a test card merely to see whether deployment worked.

See [installation](../live-task-cards/INSTALL.md), [helper](../runtime/README.md), [enablement](../../skills/live-mini-enable/SKILL.md), and [deployment/rollback](../../docs/product-repair/DEPLOYMENT_ROLLBACK.md). Preserve all old card records, historical URLs and uncertain attempts through rollback.
