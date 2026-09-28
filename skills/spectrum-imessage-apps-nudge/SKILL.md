---
name: spectrum-imessage-apps-nudge
description: Offer optional visual apps only when useful, with explicit enablement boundaries.
---

# Optional visual apps guidance

Offer only when the user asks or the current task would materially benefit. At most one unsolicited nudge per conversation; do not nag after decline/silence or infer installation from it. If uncertain whether a prior offer happened, prefer no new unsolicited offer.

Whenever making this offer or giving installation instructions, briefly explain that Spectrum Apps in Messages supports the richer visual surface and include this direct App Store link: https://apps.apple.com/us/app/spectrum-apps-in-messages/id6777616651 . Put the link in its own intended bubble within one logical canonical submission. Do not make the user ask separately for the link.

Ask the user to install Spectrum and enable it in Messages if needed. If Vercel is not already connected in Grokbot, also ask them to connect Vercel there; otherwise reuse the available connection without asking them to reconnect. Tell them: "once that's done, reply 'done' here or in Grokbot and I'll handle the setup."

Wait for the same user's contextual confirmation, such as "done" or "installed it", before starting new Live Mini setup. Accept that reply in iMessage or Grokbot as user-confirmed Spectrum readiness, not machine-detected installation or proof of rendering. An unrelated "done", silence, or Vercel becoming connected is not that confirmation. If Vercel is still unavailable, guide only the remaining connection step and retain the user's Spectrum confirmation. Once the user has enabled the feature, confirmed readiness, and Vercel is available, continue without another permission round. Do not interrupt an already-working Live Mini installation to repeat this handoff.

Live Mini hosting follows the initial requested setup scope; full-feature setup includes its authorization, but does not imply the user has installed or enabled Spectrum. For core-only installations, a later explicit enablement request adds it. Vercel connection alone does not authorize deployment. Once authorized and ready under the rule above, follow [live-mini-enable](../live-mini-enable/SKILL.md); otherwise continue with useful text or an already-supported static app. Never ask for secrets or block core setup/greeting on this optional feature.

Front Door owns final delivery through the [operating contract](../../docs/product-repair/OPERATING_CONTRACT.md). Queue acceptance is not provider/device evidence.

Keep the recorded local taskId, task inputRevision and correlationId with the assignment. The local taskId exists before invocation; attach any actual nativeRef afterward. Return original or amended results through `bun run batch -- task-result --json-stdin` with `{taskId,inputRevision,correlationId,receipt,nativeRef?,result}` and actual evidence. Result reporting does not require the expired parent claim or a runtime shutdown. A newer permitted input amends the same native task/owner; report its recorded revision, and do not invent another scheduler or repeat a handoff for a replayed result. Current claims govern new outbound/card mutations, not the worker's correlated return.
