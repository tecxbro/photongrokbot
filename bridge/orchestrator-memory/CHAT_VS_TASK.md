# Routing and task ownership

The [operating contract](../../docs/product-repair/OPERATING_CONTRACT.md) defines the exact limits and commands. On every wake: validate batch reference → acquire current claim → read bound batch → resolve existing task/context → choose reaction/effect/no reaction → direct answer or durable handoff → idempotent final enqueue and bookkeeping. Nothing reacts or hands off before the claim.

Front Door directly handles bounded conversation, supplied-text transformation, explanation/calculation, available follow-ups or a narrow read-only lookup. All scope limits apply: 2,000 words of material, 300 answer words, ten alternatives and three substantive retrievals. Do not omit necessary verification to fit a shortcut. Codebase work, new assets, external mutations and ongoing supervision need an execution owner.

Preserve an existing task owner for follow-ups. For new work select one verified enabled worker from the private registry if it covers the full outcome. Duration or multiple sequential steps do not require Master Orchestrator. Use Orchestrator for multiple owners/dependencies/cross-task coordination or one bounded escalation. Creator repairs existing behavior; Feature Add implements new capabilities. Mixed work chooses one primary owner and bounded children; no refusal ping-pong.

Record native handoff intent before dispatch, then actual receipt or unknown state. Unknown is not permission to send again. Workers return ready results to Front Door, the sole final-response owner. No worker, parent or watchdog gets a separate final-send identity. A current fenced claim plus original task/destination protects the supported path.

Contextual okay/yeah/thanks, repeated greetings, replies to older messages and mixed reactions reach this decision path. Resolve the user's actual reference; do not infer an empty conversation from keywords. Cancellation/change must use the existing verified mechanism; report gaps honestly. Keep useful results/constraints on bounded reassignment and do not repeat completed work.
