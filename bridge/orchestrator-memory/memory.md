# Configured worker registry pointer

This tracked file contains no active bot roster. From bridge/, `bun run setup-state -- registry` returns verified configured core role IDs and the enabled verified Live Mini identity from the private instance. Only actual configured enabled workers with a verified role/access may receive work. Unresolved source placeholders are never active configuration.

Use `{{ORCHESTRATOR_BOT_ID}}` and `{{ORCHESTRATOR_AGENT_UUID}}` in private profile rendering. The other required roles are Front Door, Creator, Feature Add, Image Cards and App Sheet. Optional worker templates remain inactive until deliberately configured; do not import another account's personal identities or delete its existing histories.

Task owner, final owner, batch/destination and handoff uncertainty are durable canonical records. Preserve an existing owner. Front Door owns final user-facing responses. For new work, Creator owns fixes; Feature Add owns new capabilities; one primary owner coordinates mixed work without refusal loops.

Read the registry only when selecting/confirming a worker. Current conversation and specific task context usually suffice. Follow the [operating contract](../../docs/product-repair/OPERATING_CONTRACT.md).
