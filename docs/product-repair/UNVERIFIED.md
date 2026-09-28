# External gates not executed

These checks require separate authorization and an actual disposable environment
or the operator's bounded read-only VM report. None is established by mocks,
source inspection, HTTP acknowledgment, or a provider-accepted reference.

| Gate | Evidence required before a deployment claim |
| --- | --- |
| VM durable state | Actual persistent mount, supported local filesystem, permissions, available disk, SQLite version/source ID and WAL locking behavior |
| VM startup/recovery | Actual supervisor and native VM restart guarantees; one lifetime lock owner and one Spectrum listener after recovery |
| Native setup tools | Available bot/routine creation and inspection schemas, exact resource identities and reconciliation behavior; no invented endpoint or payload |
| Native delegation | Actual SendToAgent acknowledgment/task correlation and exact receipt recovery after a lost response |
| Moonshine installation | Locked Python wheels and complete verified model artifacts installed on the target; successful real model inference within measured CPU/RAM/time bounds |
| Media cancellation | Target provider streaming behavior, decoder availability, process-group isolation and any preconfigured Linux cgroup limits |
| Photon routing | Locked SDK against the actual hosted project and original line; shared-mode sentinel and dedicated-line behavior |
| Photon outcomes | Real returned message references, reply unsupported/missing behavior, optional control capabilities, mini-app session fields and provider history reconciliation |
| Blob first create/CAS | Actual official SDK service behavior for simultaneous create-only requests, exact strong ETags and response loss after commit |
| Vercel function | Clean generated artifact import is tested locally; real deployment/runtime environment and configured private Blob remain unverified |
| Initial task card | Actual host claim, one provider app send, exact returned reference, host settlement and retained occupancy during uncertainty |
| Physical phone | First authorized greeting and confetti, text/replies, effects/reactions, polls, audio, attachments, grouped option cards, app cards and edits where supported |
| Option selection | Actual provider parent/part identities and added-reaction stream on the phone; removal is not inferred from synthetic fields |
| Migration cutover | Actual stopped old writers, complete private legacy inventory, backup verification and exact uncertain-operation reconciliation |
| Asset/Marketplace rights | Shipped asset rights and Marketplace packaging/publication remain deferred by scope; local byte inspection is not a rights grant |

The supported local outcomes distinguish queued, sending, accepted, unknown,
failed, skipped and cancelled. Accepted means the recorded provider evidence for
that operation; optional control invocation resolution has narrower meaning.
Device-observed delivery requires its own evidence. An unknown operation retains
its identity and is never automatically issued as a fresh send.

Use packet/VM_CHECK.md only for environment facts absent from source. The user
prohibited contacting or modifying the live installation during this repair, so
the coordinator did not request or run that external probe.
