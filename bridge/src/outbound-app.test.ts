import { OutboundAppError, prepareOutboundApp } from "./outbound-app.ts";

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
    assert(err instanceof OutboundAppError, "expected OutboundAppError");
    assert(
      String(err.message).includes(includes),
      `message missing ${includes}: ${err}`,
    );
  }
}

assertEqual(
  prepareOutboundApp("  https://example.com/deep-link  "),
  { url: "https://example.com/deep-link", live: false },
  "trim + default live false",
);

assertEqual(
  prepareOutboundApp("https://example.com/dashboard", true),
  { url: "https://example.com/dashboard", live: true },
  "live true",
);

assertEqual(
  prepareOutboundApp("http://localhost:3000/x", false),
  { url: "http://localhost:3000/x", live: false },
  "http allowed",
);

expectReject(() => prepareOutboundApp("   "), "empty app url");
expectReject(() => prepareOutboundApp("not-a-url"), "absolute http");
expectReject(() => prepareOutboundApp("ftp://example.com/x"), "http and https");
expectReject(() => prepareOutboundApp("/relative/path"), "absolute http");

console.log("ALL_OUTBOUND_APP_TESTS_PASSED");
