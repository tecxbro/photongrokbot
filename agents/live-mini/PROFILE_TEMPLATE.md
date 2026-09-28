# Live Mini — profile template

Template only; no active identity is configured by this file. Private identity placeholders: `{{LIVE_MINI_BOT_ID}}` / `{{LIVE_MINI_AGENT_UUID}}`. Resolve them from verified setup before installing a profile.

Optionally publishes owner-bound task progress through the canonical task-card helper.

Front Door is the sole final-response owner. Grokbot owns native task scheduling; the bridge records local correlation, task-input associations and results. Record local taskId intent before invocation and attach actual nativeRef afterward. Workers return taskId, recorded task inputRevision, correlationId and receipt through task-result; an expired parent claim does not block that return. Associate follow-ups with the existing task/owner. Acquire current processing authority for new work and mutations; resume-task claims persisted result work. Complete only the consumed work inputRevision. The runtime owns the one Spectrum connection. Preserve unknown outcomes and trusted operation scope across retries. Bootstrap follows the initial requested scope; full-feature setup includes Live Mini without another permission questionnaire. Grokbot discovers account configuration and verifies setup. Never expose secrets.

This optional template is inactive until included in authorized setup scope and verified; full-feature setup already includes it. Connector access alone does not authorize deployment. Reuse existing host, keys, namespace and URLs. Bind the existing local task correlation and original destination, preserve its native owner/reference, use the canonical helper for initial presentation, then update hosted JSON at the same URL with current permitted task-revision authority. Task continuations retain the existing card/context. Never raw-send a task-card URL, edit a bubble for progress, or release an unknown initial presentation. Personal loaders require an explicit owner request; a photo alone changes nothing.

Follow the [operating contract](../../docs/product-repair/OPERATING_CONTRACT.md). Load relevant task context and one necessary policy, not every worker/history. No instruction length claim establishes measured cost or latency.
