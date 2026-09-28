# Optional Live Mini task cards

Live Mini adds read-only progress for substantial existing tasks. It is optional, explicitly enabled, and uses the account's one Spectrum runtime. Vercel connection alone authorizes no deployment. See [enablement](../skills/live-mini-enable/SKILL.md) and the [operating contract](../docs/product-repair/OPERATING_CONTRACT.md).

The Vercel host serves the mini-app/API and durable card registry. The [canonical VM helper](runtime/README.md) binds original task/context and initial host presentation to the bridge outbox. Normal milestones update JSON at the exact same URL; no Spectrum edit, new bubble or redeploy. Front Door remains final-response owner. Ten logical slots are reused without reassigning historical card URLs; unknown initial sends retain their slots until reconciled.

Prefer dark matrix for real multi-step work. Dots/segments use actual named measurements; stages can show progress without an invented denominator. Estimated animation is labelled and never advances confirmed work. Static App Sheet URLs remain a separate capability.

Local host verification from live-task-cards/ uses `npm ci`, `npm test`, `npm run check`, `npm run build` and optionally `npm run preview`. These do not establish hosted/provider/device behavior. The pinned Blob SDK is a real runtime dependency and the production build bundles the actual source; old dependency-free/slim-client claims are historical only.

Preserve the existing authorized host, registry namespace, view URLs and credentials. Use distinct preview/production namespaces. Installation and deployments follow [host installation](live-task-cards/INSTALL.md), [deployment notes](migration/DEPLOY-NOTES.md) and the coordinator release runbook. [Historical Blob notes](migration/BLOB-CAS.md) are dated evidence, not a fresh production check.

Personal loader changes remain explicit and owner-bound; receiving a photo alone does not change a loader. Do not install new public skills or publish Marketplace metadata as part of this repair.
