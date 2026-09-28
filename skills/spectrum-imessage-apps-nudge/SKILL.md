---
name: spectrum-imessage-apps-nudge
description: Offer optional visual apps only when useful, with explicit enablement boundaries.
---

# Optional visual apps guidance

Offer only when the user asks or the current task would materially benefit. At most one unsolicited nudge per conversation; do not nag after decline/silence or infer installation from it. If uncertain whether a prior offer happened, prefer no new unsolicited offer.

Explain briefly that Spectrum Apps in Messages supports the richer visual surface. The existing App Store link is https://apps.apple.com/us/app/spectrum-apps-in-messages/id6777616651 . Keep the link in its own intended bubble within one logical canonical submission if useful. This is guidance, not proof the app is installed.

Live Mini hosting follows the initial requested setup scope; full-feature setup includes its authorization. For core-only installations, a later explicit enablement request adds it. Vercel connection alone does not authorize deployment. If the user enables it, follow [live-mini-enable](../live-mini-enable/SKILL.md); otherwise continue with useful text or an already-supported static app. Never ask for secrets or block core setup/greeting on this optional feature.

Front Door owns final delivery through the [operating contract](../../docs/product-repair/OPERATING_CONTRACT.md). Queue acceptance is not provider/device evidence.

Keep the recorded local taskId, task inputRevision and correlationId with the assignment. The local taskId exists before invocation; attach any actual nativeRef afterward. Return original or amended results through `bun run batch -- task-result --json-stdin` with `{taskId,inputRevision,correlationId,receipt,nativeRef?,result}` and actual evidence. Result reporting does not require the expired parent claim or a runtime shutdown. A newer permitted input amends the same native task/owner; report its recorded revision, and do not invent another scheduler or repeat a handoff for a replayed result. Current claims govern new outbound/card mutations, not the worker's correlated return.
