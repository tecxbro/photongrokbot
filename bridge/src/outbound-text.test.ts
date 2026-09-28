import {
  OutboundTextError,
  prepareOutboundText,
  splitIntendedBubbles,
} from "./outbound-text.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function assertEqual(a: unknown, b: unknown, msg: string): void {
  const as = JSON.stringify(a);
  const bs = JSON.stringify(b);
  if (as !== bs) throw new Error(`${msg}\n got: ${as}\nwant: ${bs}`);
}

function expectReject(fn: () => void, includes: string): void {
  try {
    fn();
    throw new Error(`expected reject containing ${includes}`);
  } catch (err) {
    assert(err instanceof OutboundTextError, "expected OutboundTextError");
    assert(String(err.message).includes(includes), `message missing ${includes}: ${err}`);
  }
}

// short reply → one bubble
assertEqual(splitIntendedBubbles("hey, got it"), ["hey, got it"], "short");

// two paragraphs → two ordered bubbles
assertEqual(
  splitIntendedBubbles("first thought\n\nsecond thought"),
  ["first thought", "second thought"],
  "two paragraphs",
);

// empty surrounding whitespace
assertEqual(splitIntendedBubbles("\n\n  hello  \n\n"), ["hello"], "trim empty");

// long sentence not sliced
const long =
  "this is a deliberately long sentence that exceeds one hundred fifty characters on purpose so we can prove the formatter does not cut it into pieces at a character boundary ever.";
assertEqual(splitIntendedBubbles(long), [long], "long sentence");

// long URL intact
const url =
  "see https://example.com/very/long/path/with?query=1&more=2&still=going#section-name for details";
assertEqual(splitIntendedBubbles(url), [url], "url");

// casing preserved
const cased = "OK use /workspace/Foo/Bar.ts and run `bun run Start` for ACRONYM_X";
assertEqual(splitIntendedBubbles(cased), [cased], "casing");

// fenced code with blank lines
const fenced = "here is the script:\n\n```bash\necho one\n\necho two\n```\n\nok";
assertEqual(
  splitIntendedBubbles(fenced),
  ["here is the script:", "```bash\necho one\n\necho two\n```", "ok"],
  "fenced",
);

// detailed answer not truncated by prepare
const detailed = "a".repeat(400);
const prepDetailed = prepareOutboundText(detailed);
assert(prepDetailed.kind === "text", "detailed kind");
assertEqual(prepDetailed.bubbles, [detailed], "detailed intact");

// standalone markers rejected
for (const m of ["SPECTRUM_RECEIVED", "SPECTRUM_ROUTED", "SPECTRUM_DONE", "  SPECTRUM_DONE  "]) {
  expectReject(() => prepareOutboundText(m), "refusing standalone proof marker");
}

// mixed: valid + forbidden → whole submission rejected (simulate check before enqueue)
expectReject(
  () => prepareOutboundText("all good\n\nSPECTRUM_DONE"),
  "refusing standalone proof marker",
);

// mention in explanation allowed
const mention =
  "do not send SPECTRUM_RECEIVED as a phone message; that was an old proof marker.";
const prepMention = prepareOutboundText(mention);
assert(prepMention.kind === "text", "mention kind");
assertEqual(prepMention.bubbles, [mention], "mention ok");

// code block containing marker preserved
const codeMarker =
  "filter list:\n\n```\nSPECTRUM_RECEIVED\nSPECTRUM_ROUTED\n```";
const prepCode = prepareOutboundText(codeMarker);
assert(prepCode.kind === "text", "code kind");
assertEqual(
  prepCode.bubbles,
  ["filter list:", "```\nSPECTRUM_RECEIVED\nSPECTRUM_ROUTED\n```"],
  "code marker ok",
);

// attachment unchanged shape
const prepAtt = prepareOutboundText("", "/tmp/tee.png");
assert(prepAtt.kind === "attachment", "att kind");
assertEqual(prepAtt.attachmentPath, "/tmp/tee.png", "att path");
assertEqual(prepAtt.text, "[attachment] /tmp/tee.png", "att text");

const prepAttText = prepareOutboundText("here is the tee", "/tmp/tee.png");
assert(prepAttText.kind === "attachment", "att+text kind");
assertEqual(prepAttText.text, "here is the tee", "att+text body");
assertEqual(prepAttText.attachmentPath, "/tmp/tee.png", "att+text path");

// attachment with proof marker text rejected
expectReject(
  () => prepareOutboundText("SPECTRUM_ROUTED", "/tmp/x.png"),
  "refusing standalone proof marker",
);

// mock enqueue: build items without touching live queue
function mockEnqueue(spaceId: string, text: string, attachmentPath?: string) {
  const prepared = prepareOutboundText(text, attachmentPath);
  if (prepared.kind === "attachment") {
    return [{ spaceId, text: prepared.text, attachmentPath: prepared.attachmentPath }];
  }
  return prepared.bubbles.map((bubble) => ({ spaceId, text: bubble }));
}

assertEqual(
  mockEnqueue("spc", "one\n\ntwo"),
  [
    { spaceId: "spc", text: "one" },
    { spaceId: "spc", text: "two" },
  ],
  "mock multi",
);

let mixedCreated = 0;
try {
  mockEnqueue("spc", "ok\n\nSPECTRUM_RECEIVED");
  mixedCreated = 1;
} catch (err) {
  assert(err instanceof OutboundTextError, "mixed err");
}
assertEqual(mixedCreated, 0, "mixed created none");

console.log("ALL_OUTBOUND_TEXT_TESTS_PASSED");
