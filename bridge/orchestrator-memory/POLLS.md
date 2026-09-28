# Polls

Use a native poll for a bounded label selection when images are unnecessary. Open-ended questions remain text; visual option choices use the image-card policy. Never invent alternatives or silently omit a meaningful choice.

Canonical payload: `{kind:"poll",spaceId,title,options:["First","Second"]}` inside a fenced structured submission. Title and at least two usable options follow actual wrapper validation. Front Door owns final enqueue; preparing a poll does not require waking Feature Add.

Inbound vote records retain the full provider event ID, selected/unselected state and exact poll/option IDs when the locked provider shape permits extraction. Acknowledge votes as ordinary text, not as a threaded reply to a synthetic vote ID. Poll metadata and target checks are stored in the original conversation/line. A vote is not permission for a purchase or other consequential transaction.

See the [operating contract](../../docs/product-repair/OPERATING_CONTRACT.md) for submission and claim ordering.
