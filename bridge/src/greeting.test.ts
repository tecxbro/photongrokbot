import { describe, expect, test } from "bun:test";
import {
  batchCasualKind,
  classifyCasualText,
  isGreetingOnlyBatch,
  normalizeGreetingText,
  pickCannedReply,
} from "./greeting.ts";
import type { InboundRecord } from "./types.ts";

function msg(text: string, kind: "text" | "reaction" = "text"): InboundRecord {
  return {
    id: "m1",
    spaceId: "s1",
    senderId: "u1",
    text,
    timestamp: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    kind,
  };
}

describe("normalizeGreetingText", () => {
  test("strips punctuation and case", () => {
    expect(normalizeGreetingText("  Hey!!! ")).toBe("hey");
    expect(normalizeGreetingText("What's up?")).toBe("what's up");
  });
});

describe("classifyCasualText", () => {
  test("greetings", () => {
    for (const t of ["hi", "Hi!", "hello", "HEY", "yo", "what's up", "whats up", "sup"]) {
      expect(classifyCasualText(t)).toBe("greeting");
    }
  });
  test("thanks and acks", () => {
    expect(classifyCasualText("thanks")).toBe("thanks");
    expect(classifyCasualText("ok")).toBe("ack");
  });
  test("rejects tasks", () => {
    expect(classifyCasualText("hi can you find housing")).toBeNull();
    expect(classifyCasualText("generate a photon logo")).toBeNull();
  });
});

describe("isGreetingOnlyBatch", () => {
  test("pure hi", () => {
    expect(isGreetingOnlyBatch([msg("hi")])).toBe(true);
  });
  test("hi plus reaction ok", () => {
    expect(isGreetingOnlyBatch([msg("hey"), msg("reacted ❤️", "reaction")])).toBe(
      true,
    );
  });
  test("task rejects", () => {
    expect(isGreetingOnlyBatch([msg("hi"), msg("find me a house")])).toBe(false);
  });
  test("reaction only does not fast-path", () => {
    expect(isGreetingOnlyBatch([msg("reacted ❤️", "reaction")])).toBe(false);
  });
});

describe("pickCannedReply", () => {
  test("stable for salt", () => {
    expect(pickCannedReply("greeting", 0)).toBe(pickCannedReply("greeting", 0));
    expect(pickCannedReply("greeting", 0).length).toBeGreaterThan(0);
  });
  test("batchCasualKind prefers greeting", () => {
    expect(batchCasualKind([msg("ok"), msg("hi")])).toBe("greeting");
  });
});
