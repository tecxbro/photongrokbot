# Roles and private registry

Six core roles are required before readiness: [Front Door](front-door/README.md), [Master Orchestrator](master-orchestrator/README.md), [Creator](creator/README.md), [Feature Add](feature-add/README.md), [Image Cards](image-cards/README.md), and [App Sheet](app-sheet/README.md). [Live Mini](live-mini/README.md) is optional and explicitly enabled.

Read the [operating contract](../docs/product-repair/OPERATING_CONTRACT.md). These are inert profile templates, not an active roster. Authorized bootstrap uses actual native tool schemas, reuses verified resources, records intent before create and reconciles unknown outcomes. `bun run setup-state -- registry` from bridge/ exposes only verified configured core IDs. Render private installed profiles with those identities; keep tracked placeholders unchanged.

Creator owns repairs; Feature Add owns new capabilities. Front Door owns every final user-facing response. Mixed work preserves an existing owner or chooses one primary owner with bounded children. An ordinary wake never provisions a worker. Mandatory Moonshine and all six roles precede the invitation to text the hosted bot line.

Role profiles/READMEs are generated from `bridge/scripts/instruction-catalog.ts`; run `bun run bridge/scripts/generate-role-instructions.ts` from repository root after changing the catalog. The instruction checker rejects drift.
