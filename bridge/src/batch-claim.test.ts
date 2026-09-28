import { expect, test } from "bun:test";
import { fixture, record } from "./tests/storage/fixture.ts";
import {
  tryClaimBatch,
  markBatchClaimCompleted,
  renewBatchClaim,
} from "./batch-claim.ts";
const create = () => {
  const f = fixture();
  f.store.accept({
    eventKey: "key",
    record: record(),
    destination: { spaceId: "space-1", lineId: "line-1" },
  });
  return { ...f, batchId: f.store.formBatches()[0]!.batchId };
};
test("claim facade requires run token, never resumes by bot identity", () => {
  const f = create();
  try {
    const a = tryClaimBatch(f.batchId, "same-bot", 60000, f.store);
    expect(a.status).toBe("acquired");
    expect(tryClaimBatch(f.batchId, "same-bot", 60000, f.store).status).toBe(
      "busy",
    );
    if (a.status !== "acquired") throw new Error("claim");
    renewBatchClaim(a.token, 60000, f.store);
    markBatchClaimCompleted(a.token, f.store);
    expect(tryClaimBatch(f.batchId, "same-bot", 60000, f.store).status).toBe(
      "completed",
    );
  } finally {
    f.cleanup();
  }
});
test("claim facade rejects path traversal", () => {
  const f = create();
  try {
    expect(() => tryClaimBatch("../secret", "bot", 60000, f.store)).toThrow(
      "INVALID_BATCH_ID",
    );
  } finally {
    f.cleanup();
  }
});
