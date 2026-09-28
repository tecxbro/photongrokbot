import { expect, test } from "bun:test";
import { bridgeControlError } from "../control-errors.ts";
import { parseBridgeControlError } from "../../../shared/bridge-control-errors.mjs";

test("safe control errors distinguish authority, identity, input and uncertain delivery", () => {
  for (const [code, action] of [
    ["STALE_CLAIM", "claim"],
    ["ACTION_PAYLOAD_CONFLICT", "operation-status"],
    ["OPERATION_SOURCE_CONFLICT", "operation-status"],
    ["UNKNOWN_FIELD", "correct-input"],
    ["PRESENTATION_UNKNOWN", "reconcile-outbound"],
  ] as const) {
    const value = bridgeControlError(new Error(code));
    expect(value.ok).toBe(false);
    expect(value.error.code).toBe(code);
    expect(value.error.recovery).toContain(action);
    expect(parseBridgeControlError(JSON.stringify(value))).toEqual(value.error);
  }
});

test("control errors never reflect unknown exception text or child recovery instructions", () => {
  const secret = "private-provider-url?k=seeded-secret";
  expect(JSON.stringify(bridgeControlError(new Error(secret)))).not.toContain(secret);
  expect(bridgeControlError(new SyntaxError(secret)).error.code).toBe("INVALID_INPUT");
  expect(parseBridgeControlError(JSON.stringify({ ok: false, error: { code: secret } }))).toBeUndefined();
  expect(parseBridgeControlError(JSON.stringify({ ok: false, error: {
    code: "STALE_CLAIM", message: secret, recovery: [secret],
  } }))).toEqual({ code: "STALE_CLAIM", recovery: ["read-batch", "claim"] });
});
