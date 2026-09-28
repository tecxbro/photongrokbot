---
name: live-mini-enable
description: Explicitly enable optional Live Mini while preserving existing resources and secrets.
---

# Explicit Live Mini enablement

Use only after an explicit request to enable this optional feature. Connector access alone is not deployment authority. Core six-role/Moonshine setup and first greeting do not depend on Live Mini. Follow the [operating contract](../../docs/product-repair/OPERATING_CONTRACT.md).

Once authorized, use sensible defaults without a configuration questionnaire: reuse the intended existing Vercel project/private Blob namespace, preserve publisher/view keys, and create only missing verified resources. Do not replace a populated registry with empty state, rotate keys or touch unrelated Redis resources. Inspect actual tool schemas and existing project configuration before provisioning.

From bridge/, record explicit enablement with `bun run setup-state -- authorize-live-mini --authorized`. Record live-project intent/receipt. Write the complete private PUBLIC_BASE_URL/PUBLISHER_TOKEN through `write-live-env --json-stdin`; PUBLIC_BASE_URL must be an HTTPS bare origin. Record live-env receipt with the exact returned environmentRevision, and only then live-deployment intent/receipt for that same revision. A lost provider response becomes unknown to reconcile, not a new deployment. No secrets are pasted in chat.

Build/test the host and follow [deployment notes](../../live-mini/migration/DEPLOY-NOTES.md) and the coordinator release runbook. The host contains the mini-app/API only; the canonical VM helper remains with the bot/runtime. Verify authorized storage/health, canonical initial presentation, same-URL updates and eventual device behavior as separate tiers. Do not claim deployment solely because build succeeded.

Spectrum Apps installation guidance is human-facing only; there is no reliable machine gate to infer installation. If Live Mini is unavailable on a fitting task, offer once, then keep useful text/static output on decline. A later connection does not substitute for enablement consent.
