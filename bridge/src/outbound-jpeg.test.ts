import { test, expect, afterAll } from "bun:test";
import { mkdtemp, realpath, writeFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveInstancePaths, ensureInstancePaths } from "../../shared/instance-paths.mjs";
import { ensureOutboundJpeg, normalizeEnqueueAttachments } from "./outbound-jpeg.ts";
if (process.env.PHOTON_TEST_MODE !== "1") throw new Error("TEST_GUARD_REQUIRED");
const root = await mkdtemp(join(await realpath(tmpdir()), "photon-outbound-jpeg-test-"));
const paths = resolveInstancePaths({ instanceDir: root, env: { PHOTON_TEST_MODE: "1" } }); ensureInstancePaths(paths);
afterAll(() => rm(root, { recursive: true, force: true }));
async function mock(name: string, content: string) { const path = join(paths.toolsDir, name); await writeFile(path, `#!${process.execPath}\n${content}`, { mode: 0o700 }); return path; }

test("outbound normalization permits only staged private files and outputs private JPEGs", async () => {
  const input = join(paths.outboundAssetsDir, "input.png"); await writeFile(input, "synthetic png", { mode: 0o600 });
  const ffmpegBin = await mock("ffmpeg", "await Bun.write(process.argv.at(-1),Buffer.from([255,216,1,2,255,217]));");
  const result = await normalizeEnqueueAttachments({ kind: "attachment_group", attachmentPaths: [input, input] }, { paths, ffmpegBin });
  expect(result.attachmentPaths![0]).toBe(result.attachmentPaths![1]);
  expect(result.attachmentPaths!.every((p) => p.startsWith(join(paths.outboundAssetsDir, "converted")))).toBe(true);
  const outside = join(root, "outside.jpg"); await writeFile(outside, "jpg", { mode: 0o600 });
  await expect(ensureOutboundJpeg(outside, { paths })).rejects.toThrow("PRIVATE_FILE_OUTSIDE_INSTANCE");
  const alias = join(paths.outboundAssetsDir, "alias.jpg"); await symlink(outside, alias);
  await expect(ensureOutboundJpeg(alias, { paths })).rejects.toThrow("INSTANCE_SYMLINK_REJECTED");
});

test("hung or corrupt outbound decoder leaves no final output", async () => {
  const input = join(paths.outboundAssetsDir, "bad.png"); await writeFile(input, "bad png", { mode: 0o600 });
  const dir = join(paths.outboundAssetsDir, "converted"); const before = await readdir(dir);
  const hung = await mock("hung", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000);");
  await expect(ensureOutboundJpeg(input, { paths, ffmpegBin: hung, timeoutMs: 50, killGraceMs: 10 })).rejects.toThrow("process_timeout");
  const corrupt = await mock("corrupt", "await Bun.write(process.argv.at(-1),'not-a-jpeg');");
  await expect(ensureOutboundJpeg(input, { paths, ffmpegBin: corrupt })).rejects.toThrow("outbound_jpeg_invalid");
  expect(await readdir(dir)).toEqual(before);
});
