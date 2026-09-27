#!/usr/bin/env bun
/**
 * Local fixture: persist a fake attachment_group presentation and resolve
 * a Tapback targetMessageId like the live unread example (p:N/guid).
 *
 * Usage: bun run scripts/fixture-reaction-option.mjs
 */
import {
  applyResolvedOptionToInbound,
  formatChildId,
  persistAttachmentGroupMapping,
  resolveReactionOption,
} from "../src/reaction-option.ts";

const batchId = "{{DEPLOY_ID_PREFIX}}-b-fixture-reaction-option";
const parentId = "spc-msg-fixture-parent-guid";

const { parts } = await persistAttachmentGroupMapping({
  outboundId: "{{DEPLOY_ID_PREFIX}}-o-fixture",
  spaceId: "any;-;{{AUTHORIZED_SENDER_ID}}",
  parentMessageId: parentId,
  batchId,
  paths: [
    "/tmp/fixture-01.jpg",
    "/tmp/fixture-02.jpg",
    "/tmp/fixture-03.jpg",
    "/tmp/fixture-04.jpg",
  ],
  cards: [
    { title: "Option A", url: "https://example.com/a", optionId: "a" },
    { title: "Option B", url: "https://example.com/b", optionId: "b" },
    { title: "Option C", url: "https://example.com/c", optionId: "c" },
    { title: "Option D", url: "https://example.com/d", optionId: "d" },
  ],
});

const target = formatChildId(2, parentId);
const resolved = await resolveReactionOption(target);
const ambiguous = await resolveReactionOption(parentId);
const missing = await resolveReactionOption("p:0/spc-msg-missing");

const enriched = applyResolvedOptionToInbound(
  {
    id: `${parentId}:reaction:1:2`,
    spaceId: "any;-;{{AUTHORIZED_SENDER_ID}}",
    senderId: "{{AUTHORIZED_SENDER_ID}}",
    text: "reacted ❤️",
    timestamp: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    kind: "reaction",
    emoji: "❤️",
    targetMessageId: target,
  },
  resolved,
);

const pass =
  !resolved.ambiguous &&
  resolved.title === "Option C" &&
  ambiguous.ambiguous === true &&
  missing.ambiguous === true &&
  enriched.optionTitle === "Option C" &&
  parts[2].childId === target;

console.log(
  JSON.stringify(
    {
      pass,
      target,
      resolved,
      ambiguous: { ambiguous: ambiguous.ambiguous, optionNames: ambiguous.optionNames },
      missing: { ambiguous: missing.ambiguous, reason: missing.reason },
      enrichedFields: {
        optionTitle: enriched.optionTitle,
        optionId: enriched.optionId,
        reactedPartIndex: enriched.reactedPartIndex,
        optionAmbiguous: enriched.optionAmbiguous,
        text: enriched.text,
      },
    },
    null,
    2,
  ),
);

process.exit(pass ? 0 : 1);
