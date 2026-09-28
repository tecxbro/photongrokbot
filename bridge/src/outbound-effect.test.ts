import { OutboundEffectError, prepareOutboundEffect, MESSAGE_EFFECT_NAMES } from "./outbound-effect.ts";
import { enqueueOutbound, updateOutbound } from "./storage.ts";
import { ensureDataDir } from "./storage.ts";

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
    assert(err instanceof OutboundEffectError, "expected OutboundEffectError");
    assert(
      String(err.message).includes(includes),
      `message missing ${includes}: ${err}`,
    );
  }
}

// --- allowlist ---
assertEqual(prepareOutboundEffect("  Confetti  "), "confetti", "trim+lower");
assertEqual(prepareOutboundEffect("slam"), "slam", "bubble slam");
assertEqual(prepareOutboundEffect("gentle"), "gentle", "bubble gentle");
assertEqual(prepareOutboundEffect("loud"), "loud", "bubble loud");
assertEqual(prepareOutboundEffect("invisible"), "invisible", "bubble invisible");
assertEqual(prepareOutboundEffect("fireworks"), "fireworks", "screen fireworks");
assertEqual(prepareOutboundEffect("balloons"), "balloons", "screen balloons");
assertEqual(prepareOutboundEffect("heart"), "heart", "screen heart");
assertEqual(prepareOutboundEffect("lasers"), "lasers", "screen lasers");
assertEqual(prepareOutboundEffect("celebration"), "celebration", "screen celebration");
assertEqual(prepareOutboundEffect("sparkles"), "sparkles", "screen sparkles");
assertEqual(prepareOutboundEffect("spotlight"), "spotlight", "screen spotlight");
assertEqual(prepareOutboundEffect("echo"), "echo", "screen echo");

expectReject(() => prepareOutboundEffect(""), "empty");
expectReject(() => prepareOutboundEffect("   "), "empty");
expectReject(() => prepareOutboundEffect("disco"), "unknown effect");
expectReject(() => prepareOutboundEffect("boom"), "allowed:");

assert(
  MESSAGE_EFFECT_NAMES.length === 13,
  `expected 13 effect names, got ${MESSAGE_EFFECT_NAMES.length}`,
);

// --- enqueue shape ---
await ensureDataDir();
const spaceId = `test-effect-${Date.now()}`;
const items = await enqueueOutbound({
  kind: "text",
  spaceId,
  text: "effects are live",
  effect: "confetti",
});
assert(items.length === 1, `expected 1 item, got ${items.length}`);
assert(items[0]!.kind === "text" || items[0]!.kind === undefined, "kind text");
assertEqual(
  (items[0] as { effect?: string }).effect,
  "confetti",
  "queued item carries effect",
);
assertEqual(items[0]!.text, "effects are live", "text preserved");
await updateOutbound(items[0]!.id, { status: "failed", lastError: "test-cleanup" });

// multi-bubble: effect only on first
const multi = await enqueueOutbound({
  kind: "text",
  spaceId: `${spaceId}-multi`,
  text: "first bubble\n\nsecond bubble",
  effect: "slam",
});
assert(multi.length === 2, `expected 2 bubbles, got ${multi.length}`);
assertEqual((multi[0] as { effect?: string }).effect, "slam", "first has effect");
assertEqual((multi[1] as { effect?: string }).effect, undefined, "second has no effect");
for (const m of multi) {
  await updateOutbound(m.id, { status: "failed", lastError: "test-cleanup" });
}

// unknown effect rejected at enqueue
let rejected = false;
try {
  await enqueueOutbound({
    kind: "text",
    spaceId: `${spaceId}-bad`,
    text: "nope",
    effect: "not-a-real-effect",
  });
} catch (err) {
  rejected = err instanceof OutboundEffectError;
  assert(
    String(err).includes("unknown effect"),
    `unexpected error: ${err}`,
  );
}
assert(rejected, "enqueue should reject unknown effect");

console.log("ALL_OUTBOUND_EFFECT_TESTS_PASSED");
