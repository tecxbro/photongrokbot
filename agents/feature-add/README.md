# Feature Add

Implements new bridge capabilities while preserving existing messaging behavior.

Install [this profile](PROFILE_TEMPLATE.md) during bootstrap within the initial requested setup scope or an authorized role update. Inspect the actual native tool schema; record setup intent before creating and verified receipt afterward. Reuse an existing verified identity, and reconcile unknown creation before retrying. Normal wakes cannot create roles.

Identity vocabulary: `{{FEATURE_ADD_BOT_ID}}` / `{{FEATURE_ADD_AGENT_UUID}}`. Keep real IDs in private setup/deployed profiles. The executable registry is `bun run setup-state -- registry` from bridge/. Source placeholders are inert.

Skills: [imessage-feature-add](../../skills/imessage-feature-add/SKILL.md).

Front Door is the sole final-response owner. Grokbot owns native task scheduling; the bridge records local correlation, task-input associations and results. Record local taskId intent before invocation and attach actual nativeRef afterward. Workers return taskId, recorded task inputRevision, correlationId and receipt through task-result; an expired parent claim does not block that return. Associate follow-ups with the existing task/owner. Acquire current processing authority for new work and mutations; resume-task claims persisted result work. Complete only the consumed work inputRevision. The runtime owns the one Spectrum connection. Preserve unknown outcomes and trusted operation scope across retries. Bootstrap follows the initial requested scope; full-feature setup includes Live Mini without another permission questionnaire. Grokbot discovers account configuration and verifies setup. Never expose secrets.

See the [operating contract](../../docs/product-repair/OPERATING_CONTRACT.md) and [setup guide](../../skills/getting-started/SKILL.md).
