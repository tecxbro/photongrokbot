# Baseline inventory

Base and clean clone: `8c710413c99a6fd8022727326ca682d267393953`. Origin identity verified from requested clone: tecxbro/photongrokbot. No newer delta.

Original bridge modalities: text, attachments, intended bubbles, reply, react, poll, voice, typing, attachment_group, app, app_update, iMessage effects. Original tests retained or amended only with documented changed expectations.

```text
bridge/src/attachment-group.test.ts
bridge/src/batch-claim.test.ts
bridge/src/cards-ready.test.ts
bridge/src/greeting.test.ts
bridge/src/inbound-attachment.test.ts
bridge/src/inbound.test.ts
bridge/src/outbound-app.test.ts
bridge/src/outbound-effect.test.ts
bridge/src/outbound-poll.test.ts
bridge/src/outbound-text.test.ts
bridge/src/reaction-option.test.ts
bridge/src/reply-fallback.test.ts
bridge/src/setup-confetti.test.ts
bridge/src/voice-stt.test.ts
live-mini/live-task-cards/evidence/unit-tests.tap
live-mini/live-task-cards/skills/dot-matrix-mini-app/assets/starter/dev/tap-core.test.mjs
live-mini/live-task-cards/tests/card-motion.test.mjs
live-mini/live-task-cards/tests/custom-loader-browser.mjs
live-mini/live-task-cards/tests/helpers.mjs
live-mini/live-task-cards/tests/http.test.mjs
live-mini/live-task-cards/tests/loaders.test.mjs
live-mini/live-task-cards/tests/matrix-plan.test.mjs
live-mini/live-task-cards/tests/model.test.mjs
live-mini/live-task-cards/tests/presenter.test.mjs
live-mini/live-task-cards/tests/redis.test.mjs
live-mini/live-task-cards/tests/render.test.mjs
live-mini/live-task-cards/tests/service.test.mjs
live-mini/live-task-cards/tests/workflow-progress.test.mjs
```

Initial frozen install with system Bun 1.3.14: exit 1, unsupported lockfileVersion 2; no dependency resolution accepted. Local pinned Bun 1.4.2 will be used. System Bun SQLite probe: 3.54.0, Apple source id 2026-04-09 12:25:13 8fa8248e303219400c646a885e36dfc52eae33d83f4412e3f369b2be5373aapl. Actual selected runtime is probed again.

Selected Bun 1.4.2 frozen install: exit 0 (120 packages). `PHOTON_TEST_MODE=1 bun test`: exit 1, 27 pass / 7 fail across 14 files; all seven fail from missing /tmp/gpproof-1x1.png fixture. Tests also affirm old same-owner resume and mixed reaction/greeting behavior, intentionally reversed in repair. Only disposable development checkout data used by original tests; new fixture harness will require external temporary roots. Selected Bun sqlite version/source matches probe above.

Pinned dev compiler TypeScript 6.0.3 (matching Spectrum peer range), @types/bun 1.4.2 and @types/node 22.20.4. Added actual assertion return types in existing outbound tests without weakening assertions. Initial typecheck found original assertion narrowing errors and batch-claim optional owner assertion; the latter is owned by lane02 replacement.
