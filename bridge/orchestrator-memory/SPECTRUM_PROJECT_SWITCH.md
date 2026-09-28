# Project and line switch recovery

Historical context: a 2026-09-22 incident involved stale shell credentials overriding a changed environment file. That observation is not evidence about this installation. Current configuration loads only the private authoritative environment through the canonical parser.

An intentional project/line switch is an explicit operator migration. Stop the verified runtime and preserve the old identity, credentials, queues, provider references and unresolved outcomes. Confirm the intended project/line through authorized provider reads without printing secrets. Do not infer correctness from a connected log alone or rotate a secret merely to retry setup.

Update configuration only through the supported deliberate procedure; ordinary setup preserves existing credentials. Original queued operations stay bound to their original line and cannot be silently moved to another project. Use [migration](../../docs/product-repair/MIGRATION.md) and the deployment runbook. Start one runtime with `bun run start` after readiness/preflight, and perform provider/device checks only with explicit authorization.

All repeated greetings and contextual acknowledgements reach Front Door after the one first-use greeting; no casual-message shortcut is a project-connectivity test.
