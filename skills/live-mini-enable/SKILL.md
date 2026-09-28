---
name: live-mini-enable
description: Explicitly enable optional Live Mini while preserving existing resources and secrets.
---

# Explicit Live Mini enablement

Use when the initial setup request includes this optional feature (including full-feature setup), or when the user later enables it. Existing scope is sufficient authorization; do not add a permission questionnaire. Connector access alone is not deployment authority. Core six-role/Moonshine setup and first greeting do not depend on Live Mini. Follow the [operating contract](../../docs/product-repair/OPERATING_CONTRACT.md).

Before starting a new implementation or deployment, follow the [Spectrum app readiness handoff](../spectrum-imessage-apps-nudge/SKILL.md): send the existing App Store link, ask the user to install Spectrum and enable it in Messages if needed, and ask them to connect Vercel in Grokbot only when it is not already connected. Wait for their contextual "done" or equivalent in iMessage or Grokbot. Treat this as user-confirmed readiness, not a device-detection check. Full-feature authorization does not substitute for this confirmation. If Vercel remains unavailable, retain the Spectrum confirmation and guide only the missing connection. Do not repeat the handoff for an already-working installation.

Once authorized, user-confirmed ready, and Vercel is available, use sensible defaults without a configuration questionnaire: reuse the intended existing Vercel project/private Blob namespace, preserve publisher/view keys, and create only missing verified resources. Do not replace a populated registry with empty state, rotate keys or touch unrelated Redis resources. Inspect actual tool schemas and existing project configuration before provisioning.

From bridge/, `init --authorized --scope full` records included enablement. For a later feature request, record enablement with `bun run setup-state -- authorize-live-mini --authorized`. These commands record authorization; they do not establish Spectrum readiness. Discover/reuse the intended native Live Mini role using its actual tool schema; record `live-mini` intent and verified receipt so its identity appears in `setup-state -- registry`. A template is not an enabled worker. Record live-project intent/receipt. Write the complete private PUBLIC_BASE_URL/PUBLISHER_TOKEN through `write-live-env --json-stdin`; PUBLIC_BASE_URL must be an HTTPS bare origin. Record live-env receipt with the exact returned environmentRevision, and only then live-deployment intent/receipt for that same revision. A lost provider response becomes unknown to reconcile, not a new deployment. No secrets are pasted in chat.

Build/test the host and follow [deployment notes](../../live-mini/migration/DEPLOY-NOTES.md) and the coordinator release runbook. The host contains the mini-app/API only; the canonical VM helper remains with the bot/runtime. Verify authorized storage/health, canonical initial presentation, same-URL updates and eventual device behavior as separate tiers. Do not claim deployment solely because build succeeded.

There is no reliable machine gate to infer Spectrum installation; use the user's readiness confirmation above. If Live Mini is unavailable on a fitting task, offer once, then keep useful text/static output on decline or while prerequisites remain pending. A later connection alone does not expand setup scope or replace the user's confirmation.
