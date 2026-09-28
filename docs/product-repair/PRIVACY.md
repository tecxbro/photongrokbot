# Private instance and retention

The canonical resolver selects one private persistent root outside code: `PHOTON_INSTANCE_DIR`, default `/workspace/photongrokbot-state`. It rejects production paths outside `/workspace`, checkout-contained state, unsafe/symlink components and conflicting overrides. Tests require explicit synthetic paths and test mode. The account's bots share a Unix identity/VM; file permissions and supported protocol checks do not create isolation between those trusted bots.

| Instance-relative path | Content |
| --- | --- |
| instance.json | Installation identity and bootstrap checkpoint; durable setup moves into canonical metadata after DB creation. |
| secrets/bridge.env | Project credentials, exact authorized sender and native webhook credentials. |
| secrets/live-mini.env | Optional host origin and publisher token. |
| data/bridge.sqlite plus SQLite sidecars | Accepted events, batches, claims, task bindings, wakes, outbox, onboarding and provider references. |
| data/inbound-attachments / data/outbound-assets | Originals, transcripts/derived media, authorized staged outputs. |
| models / tools | Pinned Moonshine weights and Python environment. |
| live-mini/context | Private task/card identity and progress recovery evidence. |
| logs / backups | Diagnostics, consistent snapshots, immutable migration/export evidence. |

Directories are 0700; private files are 0600 or stricter. Private model/tool files may follow installed read permissions within the 0700 root; actual verifier guards the supported read path. Do not place runtime data under bridge/data or check secrets into Git. Ignore rules do not erase history.

## Retention defaults

Resolved event/outbound payloads age out after 30 days. Owned intermediates age out after 7 days only when unreferenced and safe; unresolved/active/unknown work and identity/deduplication/provider evidence are retained. Logs retain at most 30 days and 10 MiB according to the implemented preview. Backups have a separate 30-day policy, retaining at least three backup groups; they are omitted from normal prune unless explicitly included. Legacy raw evidence/metadata and backup contents may retain originals after active payload redaction, so a prune is not a claim of complete erasure.

Commands from bridge/:

```sh
bun run prune-instance -- --inspect
bun run prune-instance
bun run prune-instance -- --delete-resolved
bun run export-instance
```

These are inspection/previews. Preview reports counts and a planId without dumping bodies. Apply requires the same preview plan, a fixed `--now` for prune, and the exclusive runtime lock while the runtime is stopped. Obtain paths from the canonical resolver; never bypass it to guess a lock location. For a selected private root, the lock is `$PHOTON_INSTANCE_DIR/runtime.lock`.

```sh
python3 tools/with-instance-lock.py "$PHOTON_INSTANCE_DIR/runtime.lock" bun run src/prune-instance.ts --apply --plan-id "$PLAN_ID" --now "$PREVIEW_NOW"
python3 tools/with-instance-lock.py "$PHOTON_INSTANCE_DIR/runtime.lock" bun run src/export-instance.ts --apply --plan-id "$PLAN_ID"
```

Use `--delete-resolved` consistently in both preview and apply for immediate resolved-payload deletion. `--include-backups` is an explicit separate choice in both phases. For selected immutable migration snapshots, apply temporarily adds owner-write only to the exact reviewed snapshot directories, leaves files read-only, and restores surviving directory modes after a partial failure. Unselected snapshots keep their modes. The preview is revalidated before deletion; changed state rejects it. Failed artifact cleanup remains a durable cleanup intent. Never delete arbitrary files because they resemble an attachment name.

Exports go into a private backup directory and contain private content, including a consistent SQLite snapshot. They omit credentials but are not public artifacts. Protect copies and account for their separate retention. Complete account erasure includes deliberate handling of credentials, backup copies, hosted card storage and upstream provider records; it is not implemented by the resolved-only prune.

A corrupt/missing existing database, permission mismatch or wrong installation identity is an error, not empty state. Do not copy only a running SQLite main file; include a consistent backup through the supported export/backup path. Recovery and deployment order are in [migration](MIGRATION.md) and [deployment/rollback](DEPLOYMENT_ROLLBACK.md).
