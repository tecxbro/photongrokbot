---
name: photon-image-card-delivery
description: Deliver complete option cards through one canonical grouped operation.
---

# Option card delivery

Follow the [operating contract](../../docs/product-repair/OPERATING_CONTRACT.md). Image Cards creates assets and returns them to Front Door. Front Door is the sole final-response owner. Do not open another Spectrum client or send each image while generating.

For a visual choice with N >= 4 options, stage every card privately and submit all N in one attachment_group, including five/seven. Preserve parallel paths and cards metadata: optionId, title, details/caption, known price/priceQualifier, direct URL. Missing price stays absent. Do not pad a smaller set or split a possibly accepted group.

The strict cards-ready command, from bridge/, is:

```sh
bun run enqueue -- --cards-ready --json-stdin
```

Input is `{ "submission": <canonical Submission>, "expectedCount": N, "revision": "v1", "readyAt": "ISO timestamp" }`. Submission uses purpose final, the current fenced claim and consumed inputRevision, recorded option-set batch/destination and actionKey `cards:<batchId>:<revision>`. Its payload is attachment_group with the same batchId, all private attachmentPaths and aligned cards. See the [tested envelope](../../docs/product-repair/examples/cards-ready.json); replace every template identifier from actual state, never by guessing.

The command records readiness; it does not prove delivery. Foreground submission and watchdog reuse this exact key/payload, source work revision and option-set revision. The bridge derives the trusted scope; never use a renewed claim generation as a new option set. A duplicate can refresh the current valid claim/ready time, not change the result. Do not create handwritten marker files or infer acceptance by matching filenames. After send, canonical storage retains actual provider parent/part references for option resolution.

Any added emoji on a known option returns the exact existing details, known price and direct URL without asking whether details are wanted or using sentiment routing. One ambiguous target gets one clarification. Reactions do not authorize purchases/bookings. Preserve all unknown provider outcomes until reconciled; no new group identity to test delivery.

Queue acceptance, provider acceptance and physical Photos-style stack observation are separate. If asset generation fails, return verified text/links and its limitation to Front Door; never mark incomplete assets ready.

Keep the recorded local taskId, task inputRevision and correlationId with the assignment. The local taskId exists before invocation; attach any actual nativeRef afterward. Return original or amended results through `bun run batch -- task-result --json-stdin` with `{taskId,inputRevision,correlationId,receipt,nativeRef?,result}` and actual evidence. Result reporting does not require the expired parent claim or a runtime shutdown. A newer permitted input amends the same native task/owner; report its recorded revision, and do not invent another scheduler or repeat a handoff for a replayed result. Current claims govern new outbound/card mutations, not the worker's correlated return.
