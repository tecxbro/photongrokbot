import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { DATA_DIR } from "./types.ts";
import {
  tryClaimBatch,
  markBatchClaimCompleted,
  readBatchClaim,
} from "./batch-claim.ts";

const CLAIMS = join(DATA_DIR, "batch-claims");

beforeEach(async () => {
  await rm(CLAIMS, { recursive: true, force: true });
  await mkdir(CLAIMS, { recursive: true });
});

afterEach(async () => {
  await rm(CLAIMS, { recursive: true, force: true });
});

describe("tryClaimBatch", () => {
  test("first claim wins", async () => {
    const a = await tryClaimBatch("b-1", "front-door");
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.resumed).toBe(false);
  });

  test("second owner blocked while lease live", async () => {
    await tryClaimBatch("b-2", "front-door", 60_000);
    const b = await tryClaimBatch("b-2", "old-orch", 60_000);
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.reason).toBe("owned_by_other");
  });

  test("same owner can resume", async () => {
    await tryClaimBatch("b-3", "front-door", 60_000);
    const again = await tryClaimBatch("b-3", "front-door", 60_000);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.resumed).toBe(true);
  });

  test("completed claim rejects new work", async () => {
    await tryClaimBatch("b-4", "front-door", 60_000);
    await markBatchClaimCompleted("b-4", "front-door", "handled");
    const again = await tryClaimBatch("b-4", "front-door", 60_000);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe("already_completed");
  });

  test("expired lease allows reclaim by another owner", async () => {
    await tryClaimBatch("b-5", "old-orch", 1);
    await Bun.sleep(5);
    const reclaim = await tryClaimBatch("b-5", "front-door", 60_000);
    expect(reclaim.ok).toBe(true);
    if (reclaim.ok) {
      expect(reclaim.claim.owner).toBe("front-door");
      expect(reclaim.resumed).toBe(false);
    }
  });

  test("concurrent exclusive creates: only one ok", async () => {
    const results = await Promise.allSettled([
      tryClaimBatch("b-race", "a", 60_000),
      tryClaimBatch("b-race", "b", 60_000),
      tryClaimBatch("b-race", "c", 60_000),
    ]);
    const vals = results.map((r) => {
      if (r.status === "rejected") throw r.reason;
      return r.value;
    });
    const wins = vals.filter((r) => r.ok);
    expect(wins.length).toBe(1);
    const claim = await readBatchClaim("b-race");
    expect(claim?.state).toBe("claimed");
    expect(["a", "b", "c"]).toContain(claim?.owner);
  });
});
