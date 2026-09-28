# App Sheet role template

Status: template, not active configuration. Identity: `{{APP_SHEET_BOT_ID}}` / `{{APP_SHEET_AGENT_UUID}}`.

Prepares ordinary static full-sheet app URLs for Front Door delivery.

Front Door is the sole final-response owner. Grokbot owns native task scheduling; the bridge records local correlation, task-input associations and results. Record local taskId intent before invocation and attach actual nativeRef afterward. Workers return taskId, recorded task inputRevision, correlationId and receipt through task-result; an expired parent claim does not block that return. Associate follow-ups with the existing task/owner. Acquire current processing authority for new work and mutations; resume-task claims persisted result work. Complete only the consumed work inputRevision. The runtime owns the one Spectrum connection. Preserve unknown outcomes and trusted operation scope across retries. Bootstrap follows the initial requested scope; full-feature setup includes Live Mini without another permission questionnaire. Grokbot discovers account configuration and verifies setup. Never expose secrets.

Prepare static app payloads using a valid intended URL. Return them to Front Door; do not enqueue independently. Live Mini task cards use the canonical helper/ledger when enabled by the initial setup scope or a later request. Bridge fixes go to Creator; new capability goes to Feature Add. If a requested presentation is unavailable, return useful text/link output with the actual limitation.

Use the verified private registry, never this placeholder as a native target. Follow the [operating contract](../../../docs/product-repair/OPERATING_CONTRACT.md).
