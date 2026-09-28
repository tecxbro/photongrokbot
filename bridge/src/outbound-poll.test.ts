import { OutboundPollError, prepareOutboundPoll } from "./outbound-poll.ts";

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
    assert(err instanceof OutboundPollError, "expected OutboundPollError");
    assert(
      String(err.message).includes(includes),
      `message missing ${includes}: ${err}`,
    );
  }
}

assertEqual(
  prepareOutboundPoll("  Lunch?  ", [" Pizza ", "Sushi", "  "]),
  { title: "Lunch?", options: ["Pizza", "Sushi"] },
  "trim and drop empty",
);

expectReject(() => prepareOutboundPoll("   ", ["A", "B"]), "empty poll title");
expectReject(() => prepareOutboundPoll("Q?", ["only"]), "fewer than two");
expectReject(() => prepareOutboundPoll("Q?", ["", "  "]), "fewer than two");

console.log("ALL_OUTBOUND_POLL_TESTS_PASSED");
