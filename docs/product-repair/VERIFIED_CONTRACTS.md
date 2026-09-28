# External contract evidence

Base lock pins spectrum-ts 12.8.0 and heif2jpeg 0.1.6. No upgrade of provider intended. Installed source verification follows local frozen install.

Primary references opened by coordinator: https://bun.com/docs/runtime/sqlite (sync driver, immediate transaction support, platform-dependent SQLite), https://www.sqlite.org/wal.html (local same-host WAL and patched build requirement), https://photon.codes/docs/llms.txt (select matching version). Runtime version alone is insufficient; query version/source id. System runtime probe is in BASELINE.md, selected runtime recheck pending.

Explicit external gates: actual VM filesystem/durability/daemon recovery, native Grok tool schema and acceptance receipt semantics, provider idempotency/reconciliation and actual device observations. No live provider calls, credentials, VM files or messages inspected. Unit mocks never establish device delivery.
