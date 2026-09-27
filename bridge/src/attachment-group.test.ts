import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { enqueueOutbound, updateOutbound } from "./storage.ts";
import { ensureOutboundJpeg } from "./outbound-jpeg.ts";

const DIR = "/tmp/gpproof-attachment-group-test";
const TINY_PNG = "/tmp/gpproof-1x1.png";

function copyPng(name: string): string {
  const p = join(DIR, name);
  writeFileSync(p, readFileSync(TINY_PNG));
  return p;
}

describe("attachment_group enqueue", () => {
  test("two or more paths become one queued attachment_group item as JPEG", async () => {
    rmSync(DIR, { recursive: true, force: true });
    mkdirSync(DIR, { recursive: true });
    const paths = [copyPng("a.png"), copyPng("b.png"), copyPng("c.png"), copyPng("d.png")];
    const spaceId = `test-ag-${Date.now()}`;
    const items = await enqueueOutbound({
      kind: "attachment_group",
      spaceId,
      attachmentPaths: paths,
    });
    expect(items.length).toBe(1);
    expect(items[0]!.kind).toBe("attachment_group");
    if (items[0]!.kind === "attachment_group") {
      expect(items[0]!.attachmentPaths.length).toBe(4);
      for (const p of items[0]!.attachmentPaths) {
        expect(extname(p).toLowerCase()).toBe(".jpg");
        expect(existsSync(p)).toBe(true);
      }
    }
    await updateOutbound(items[0]!.id, { status: "failed", lastError: "test-cleanup" });
  });

  test("rejects fewer than two paths", async () => {
    rmSync(DIR, { recursive: true, force: true });
    mkdirSync(DIR, { recursive: true });
    const p = copyPng("only.png");
    await expect(
      enqueueOutbound({
        kind: "attachment_group",
        spaceId: "test-ag-short",
        attachmentPaths: [p],
      }),
    ).rejects.toThrow(/at least 2/);
  });
});

describe("ensureOutboundJpeg", () => {
  test("png becomes jpg; jpg passes through", async () => {
    rmSync(DIR, { recursive: true, force: true });
    mkdirSync(DIR, { recursive: true });
    const png = copyPng("card.png");
    const jpgOut = await ensureOutboundJpeg(png);
    expect(extname(jpgOut).toLowerCase()).toBe(".jpg");
    expect(existsSync(jpgOut)).toBe(true);
    // already jpeg: unchanged path
    const same = await ensureOutboundJpeg(jpgOut);
    expect(same).toBe(jpgOut);
  });
});
