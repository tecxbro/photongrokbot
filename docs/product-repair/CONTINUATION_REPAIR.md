# Continuation repair evidence

This is a source-kit repair in `00-integration`, based on `bf61810ef2595274774b997a451f2e123de90341`. The local working-tree changes have not been deployed or pushed. Grokbot still discovers and builds its native integration.

| Requirement | Implementation and regression evidence |
| --- | --- |
| Late voice and attachments | Settlement atomically updates the original event, appends a snapshot work revision and persists wake intent. Completion acknowledges only the claim's consumed revision. Held transcription, ready/failed/unavailable, duplicate settlement, read/completion races and restart tests live in `bridge/src/tests/storage/media-continuation.test.ts` and `process.test.ts`. |
| Native results and amendments | Local task identity and per-input correlation are separate from `nativeRef`. Original binding stays immutable. `associate-task`, `task-result`, and `resume-task` operate through the existing store and wake path. Results can return after parent claim expiry while the runtime lock is held elsewhere. Dog app → unrelated question → add cats runs through public controls in `agent-continuation-flow.test.ts`. Superseded inputs cannot send. |
| Scoped output | Stored request/work, task-input, option-set, installation and card identities determine scope. Same-request retries reuse their operation; separate requests can both use `answer:1` and say “Done.” Native-result inference, ordinary progress before task binding and scope preservation after recovery are covered by `operation-scope.test.ts`. |
| Existing installations | Migration 002 upgrades version 1 in place, preserving IDs, provider references, uncertainty, bindings, mappings and onboarding. Read-only opens refuse an upgrade without performing it. Legacy JSON import writes explicit current-schema columns. Migration tests create a real version-1 fixture from unchanged migration 001. |
| Live Mini and safe errors | Current task-input authority can replace expired parent authority. Private contexts retain original batch identity and exact signed URL. Existing card presentation and settlement are reused. Safe structured CLI codes distinguish stale claims, source conflicts, invalid input and unknown delivery. Blob store and SDK are unchanged. |
| Instructions and setup | Instruction catalog is the source for generated profiles. Setup retains six core roles and mandatory Moonshine, records initial core/full scope and includes an enabled verified optional role in the registry. README copies remain identical. |
| Retention and exports | Unconsumed revisions, pending media and unresolved task results protect their assets. Resolved snapshot bodies and results redact with canonical records. Cross-line provider-ID regression prevents unrelated deletion. Private exports include the database's correlations and pending results plus assets. |

Verification commands, from the repository root unless stated otherwise:

```sh
node scripts/test-product.mjs all
cd bridge
bun run scripts/generate-role-instructions.ts
bun run scripts/check-instructions.ts
bun run scripts/refresh-manifests.ts
bun run scripts/refresh-manifests.ts --check
cd ../live-mini/live-task-cards
npm run verify:handoff
```

The harness uses pinned Bun 1.4.2 and Node 22, guarded temporary instances, synthetic native/provider ports and local host/helper tests. The harness report is kept in the surrounding repair workspace as `continuation-final-tests.json`, outside the distributable kit. Its base SHA identifies the starting commit; `MANIFEST.txt` identifies the tested working-tree inventory.

These checks establish source behavior and local build/test results. Native Grokbot installation, real account provisioning, hosted reachability, provider delivery and device rendering remain later installation checks. No runtime credentials, actual account IDs or private signed URLs were accessed for this repair.
