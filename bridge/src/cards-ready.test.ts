import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  existsSync,
  utimesSync,
  copyFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  assetsAreComplete,
  findReadyImageStacks,
  finalEnqueueReadyStack,
  listBatchAssetPaths,
  MIN_STACK_CARDS,
} from "./cards-ready.ts";
import { updateOutbound } from "./storage.ts";

const ROOT = "/tmp/gpproof-cards-ready-test";
const HANDLED = join(ROOT, "orchestrator-handled");
const ASSETS = join(ROOT, "outbound-assets");
const READY = join(ROOT, "cards-ready");
const TINY = "/tmp/gpproof-1x1.png";

function reset(): void {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(HANDLED, { recursive: true });
  mkdirSync(ASSETS, { recursive: true });
  mkdirSync(READY, { recursive: true });
}

function touchAsset(batchId: string, nn: string, slug: string, ageMs: number): string {
  const name = `${batchId}-${nn}-${slug}.png`;
  const p = join(ASSETS, name);
  copyFileSync(TINY, p);
  const when = new Date(Date.now() - ageMs);
  utimesSync(p, when, when);
  return p;
}

describe("assetsAreComplete", () => {
  test("requires min cards, expected count, and stability", () => {
    const now = 1_000_000;
    expect(
      assetsAreComplete({
        paths: ["a", "b", "c"],
        newestMtimeMs: now - 60_000,
        nowMs: now,
      }),
    ).toBe(false);
    expect(
      assetsAreComplete({
        paths: ["a", "b", "c", "d"],
        newestMtimeMs: now - 1_000,
        nowMs: now,
        stableMs: 12_000,
      }),
    ).toBe(false);
    expect(
      assetsAreComplete({
        paths: ["a", "b", "c", "d"],
        expectedCount: 5,
        newestMtimeMs: now - 60_000,
        nowMs: now,
      }),
    ).toBe(false);
    expect(
      assetsAreComplete({
        paths: ["a", "b", "c", "d", "e"],
        expectedCount: 5,
        newestMtimeMs: now - 60_000,
        nowMs: now,
      }),
    ).toBe(true);
  });
});

describe("listBatchAssetPaths", () => {
  beforeEach(reset);
  afterEach(() => rmSync(ROOT, { recursive: true, force: true }));

  test("orders by NN and ignores underscore manifests", async () => {
    const batchId = "{{DEPLOY_ID_PREFIX}}-b-testbatch";
    touchAsset(batchId, "02", "b", 30_000);
    touchAsset(batchId, "01", "a", 30_000);
    touchAsset(batchId, "03", "c", 30_000);
    writeFileSync(join(ASSETS, `_${batchId}-meta.json`), "[]");
    const { paths } = await listBatchAssetPaths(batchId, ASSETS);
    expect(paths.length).toBe(3);
    expect(paths[0]!.endsWith("-01-a.png")).toBe(true);
    expect(paths[2]!.endsWith("-03-c.png")).toBe(true);
  });
});

describe("findReadyImageStacks + finalEnqueue", () => {
  beforeEach(reset);
  afterEach(() => rmSync(ROOT, { recursive: true, force: true }));

  test("marker with ≥4 existing paths is ready", async () => {
    const batchId = `{{DEPLOY_ID_PREFIX}}-b-marker-${Date.now()}`;
    const spaceId = `test-space-marker-${Date.now()}`;
    const paths = ["01", "02", "03", "04", "05"].map((nn) =>
      touchAsset(batchId, nn, `card${nn}`, 30_000),
    );
    writeFileSync(
      join(READY, `${batchId}.json`),
      JSON.stringify({
        batchId,
        spaceId,
        attachmentPaths: paths,
        expectedCount: 5,
        readyAt: new Date().toISOString(),
        source: "{{IMAGE_CARDS_BOT_ID}}",
      }),
    );
    const ready2 = await findReadyImageStacks({
      handledDir: HANDLED,
      assetsDir: ASSETS,
      cardsReadyDir: READY,
      nowMs: Date.now(),
      stableMs: 1,
    });
    expect(ready2.length).toBe(1);
    expect(ready2[0]!.attachmentPaths.length).toBe(5);
    expect(ready2[0]!.source).toBe("marker");

    const result = await finalEnqueueReadyStack(ready2[0]!);
    expect(result).not.toBeNull();
    expect(result!.outboundIds.length).toBeGreaterThanOrEqual(1);

    // Idempotent: second find should skip (outbound covers + marker consumed)
    const again = await findReadyImageStacks({
      handledDir: HANDLED,
      assetsDir: ASSETS,
      cardsReadyDir: READY,
      nowMs: Date.now(),
      stableMs: 1,
    });
    expect(again.find((s) => s.batchId === batchId)).toBeUndefined();

    for (const id of result!.outboundIds) {
      await updateOutbound(id, { status: "failed", lastError: "test-cleanup" });
    }
  });

  test("disk-scan waits for expectedCount and stability", async () => {
    const batchId = `{{DEPLOY_ID_PREFIX}}-b-disk-${Date.now()}`;
    const spaceId = `test-space-disk-${Date.now()}`;
    writeFileSync(
      join(HANDLED, `${batchId}.json`),
      JSON.stringify({
        batchId,
        spaceId,
        action: "forward-to-specialist",
        routedTo: "{{IMAGE_CARDS_BOT_ID}}",
        modality: "image-stack",
        expectedCardCount: 5,
      }),
    );
    for (const nn of ["01", "02", "03", "04"]) {
      touchAsset(batchId, nn, `c${nn}`, 60_000);
    }
    const incomplete = await findReadyImageStacks({
      handledDir: HANDLED,
      assetsDir: ASSETS,
      cardsReadyDir: READY,
      nowMs: Date.now(),
      stableMs: 12_000,
    });
    expect(incomplete.find((s) => s.batchId === batchId)).toBeUndefined();

    touchAsset(batchId, "05", "c05", 60_000);
    const complete = await findReadyImageStacks({
      handledDir: HANDLED,
      assetsDir: ASSETS,
      cardsReadyDir: READY,
      nowMs: Date.now(),
      stableMs: 12_000,
    });
    expect(complete.length).toBe(1);
    expect(complete[0]!.attachmentPaths.length).toBe(5);
    expect(complete[0]!.source).toBe("disk-scan");
  });

  test("fresh files within stable window are not ready", async () => {
    const batchId = `{{DEPLOY_ID_PREFIX}}-b-fresh-${Date.now()}`;
    const spaceId = `test-space-fresh-${Date.now()}`;
    writeFileSync(
      join(HANDLED, `${batchId}.json`),
      JSON.stringify({
        batchId,
        spaceId,
        action: "forward-to-specialist",
        specialistId: "{{IMAGE_CARDS_BOT_ID}}",
        modality: "image-stack",
        expectedCardCount: 4,
      }),
    );
    for (const nn of ["01", "02", "03", "04"]) {
      touchAsset(batchId, nn, `c${nn}`, 1_000); // 1s old
    }
    const ready = await findReadyImageStacks({
      handledDir: HANDLED,
      assetsDir: ASSETS,
      cardsReadyDir: READY,
      nowMs: Date.now(),
      stableMs: 12_000,
    });
    expect(ready.find((s) => s.batchId === batchId)).toBeUndefined();
  });

  test("MIN_STACK_CARDS is 4", () => {
    expect(MIN_STACK_CARDS).toBe(4);
  });
});
