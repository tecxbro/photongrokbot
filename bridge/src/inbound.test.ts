import { shapeInboundContent, toInboundRecord } from "./inbound.ts";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

function assertEqual(a: unknown, b: unknown, msg: string): void {
  const as = JSON.stringify(a);
  const bs = JSON.stringify(b);
  if (as !== bs) throw new Error(`${msg}\n got: ${as}\nwant: ${bs}`);
}

// plain text
assertEqual(
  shapeInboundContent({ type: "text", text: "hello" }),
  { kind: "text", text: "hello" },
  "text",
);

// markdown treated as text
assertEqual(
  shapeInboundContent({ type: "markdown", markdown: "# hi" }),
  { kind: "text", text: "# hi" },
  "markdown",
);

// nested reply unwraps
assertEqual(
  shapeInboundContent({
    type: "reply",
    content: { type: "text", text: "nested" },
  }),
  { kind: "text", text: "nested" },
  "reply unwrap",
);

// reaction with target
assertEqual(
  shapeInboundContent({
    type: "reaction",
    emoji: "❤️",
    target: { id: "msg-abc" },
  }),
  {
    kind: "reaction",
    text: "reacted ❤️",
    emoji: "❤️",
    targetMessageId: "msg-abc",
  },
  "reaction",
);

// reaction missing emoji falls back
assertEqual(
  shapeInboundContent({ type: "reaction", target: { id: "x" } }),
  { kind: "reaction", text: "reacted ?", emoji: "?", targetMessageId: "x" },
  "reaction missing emoji",
);

// unsupported
assertEqual(shapeInboundContent({ type: "typing" }), null, "typing ignore");
assertEqual(shapeInboundContent(undefined), null, "undefined");
// inbound read receipt (recipient read our outbound) — not a user message
assertEqual(
  shapeInboundContent({ type: "read", target: { id: "o1" } }),
  null,
  "read ignore",
);

// toInboundRecord preserves fields
const record = toInboundRecord(
  {
    kind: "reaction",
    text: "reacted 👍",
    emoji: "👍",
    targetMessageId: "t1",
  },
  {
    id: "m1",
    spaceId: "s1",
    senderId: "+1000",
    timestamp: "2026-09-18T00:00:00.000Z",
    receivedAt: "2026-09-18T00:00:01.000Z",
  },
);
assertEqual(
  record,
  {
    id: "m1",
    spaceId: "s1",
    senderId: "+1000",
    text: "reacted 👍",
    timestamp: "2026-09-18T00:00:00.000Z",
    receivedAt: "2026-09-18T00:00:01.000Z",
    kind: "reaction",
    emoji: "👍",
    targetMessageId: "t1",
  },
  "toInboundRecord",
);


// poll vote selected
assertEqual(
  shapeInboundContent({
    type: "poll_option",
    title: "Pizza",
    selected: true,
    option: { title: "Pizza" },
    poll: { type: "poll", title: "Lunch?", options: [{ title: "Pizza" }, { title: "Sushi" }] },
  }),
  {
    kind: "poll_vote",
    text: 'voted Pizza on "Lunch?"',
    pollOption: "Pizza",
    pollSelected: true,
    pollTitle: "Lunch?",
  },
  "poll vote",
);

// poll unvote
assertEqual(
  shapeInboundContent({
    type: "poll_option",
    title: "Sushi",
    selected: false,
    option: { title: "Sushi" },
    poll: { type: "poll", title: "Lunch?" },
  }),
  {
    kind: "poll_vote",
    text: 'unvoted Sushi on "Lunch?"',
    pollOption: "Sushi",
    pollSelected: false,
    pollTitle: "Lunch?",
  },
  "poll unvote",
);

// outbound poll echo ignored
assertEqual(
  shapeInboundContent({
    type: "poll",
    title: "Lunch?",
    options: [{ title: "Pizza" }, { title: "Sushi" }],
  }),
  null,
  "poll create echo ignore",
);


// attachment shape
assertEqual(
  shapeInboundContent({
    type: "attachment",
    id: "p:0/GUID",
    name: "shot.jpg",
    mimeType: "image/jpeg",
    size: 99,
  }),
  {
    kind: "attachment",
    text: "[attachment] shot.jpg (image/jpeg, 99 bytes)",
    attachmentName: "shot.jpg",
    attachmentMimeType: "image/jpeg",
    attachmentId: "p:0/GUID",
    attachmentBytes: 99,
    hasReadableBytes: false,
  },
  "attachment shape",
);

// voice treated as attachment
const voice = shapeInboundContent({
  type: "voice",
  name: "note.m4a",
  mimeType: "audio/mp4",
  read: async () => Buffer.from("x"),
});
assert(voice && voice.kind === "voice", "voice kind");
assert(voice && voice.hasReadableBytes === true, "voice readable");
assertEqual(voice && voice.attachmentMimeType, "audio/mp4", "voice mime");
assert(voice && voice.text.startsWith("[voice]"), "voice label");

assert(record.kind === "reaction", "kind check");

// transcript on voice record
const voiceRecord = toInboundRecord(
  {
    kind: "voice",
    text: "[voice] note.caf\nhi",
    attachmentName: "note.caf",
    attachmentMimeType: "audio/x-caf",
  },
  {
    id: "v1",
    spaceId: "s1",
    senderId: "+1000",
    timestamp: "2026-09-21T00:00:00.000Z",
    receivedAt: "2026-09-21T00:00:01.000Z",
  },
  { attachmentPath: "/tmp/note.caf", attachmentBytes: 10, transcript: "hi" },
);
assertEqual(voiceRecord.transcript, "hi", "transcript field");
assertEqual(voiceRecord.kind, "voice", "voice kind on record");

console.log("ALL_INBOUND_TESTS_PASSED");

