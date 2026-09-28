import { test, expect, afterAll } from "bun:test";
import { mkdtemp, realpath, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBoundedProcess } from "./subprocess.ts";
if (process.env.PHOTON_TEST_MODE !== "1") throw new Error("TEST_GUARD_REQUIRED");
const root = await mkdtemp(join(await realpath(tmpdir()), "photon-process-test-"));
afterAll(() => rm(root, { recursive: true, force: true }));

test("stdout and stderr are concurrently drained under pipe pressure", async () => {
  const result = await runBoundedProcess([process.execPath, "-e", 'for(let i=0;i<80;i++) { process.stderr.write("e".repeat(8192)); process.stdout.write("o".repeat(8192)); }'], { maxStderrBytes: 1024 * 1024, maxStdoutBytes: 1024 * 1024, timeoutMs: 3000 });
  expect(result.code).toBe(0);
  expect(result.stdout.length).toBe(80 * 8192);
  expect(result.stderr.length).toBe(80 * 8192);
});

test("oversized output kills child without retaining unlimited output", async () => {
  await expect(runBoundedProcess([process.execPath, "-e", 'setInterval(()=>process.stderr.write("x".repeat(65536)),1)'], { maxStderrBytes: 1024, timeoutMs: 3000 })).rejects.toThrow("process_output_limit");
});

test("hung process ignoring TERM is KILLed and reaped by deadline", async () => {
  const pidFile = join(root, "pid");
  const start = Date.now();
  await expect(runBoundedProcess([process.execPath, "-e", `await Bun.write(${JSON.stringify(pidFile)},String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`], { timeoutMs: 150, killGraceMs: 30 })).rejects.toThrow("process_timeout");
  expect(Date.now() - start).toBeLessThan(2000);
  const pid = Number(await readFile(pidFile, "utf8"));
  expect(() => process.kill(pid, 0)).toThrow();
});

test("caller abort kills and reaps process; child environment omits secrets", async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 40);
  await expect(runBoundedProcess([process.execPath, "-e", "setInterval(()=>{},1000)"], { signal: controller.signal })).rejects.toThrow("process_aborted");
  clearTimeout(timer);
  process.env.PHOTON_PROCESS_TEST_SECRET = "synthetic-secret";
  const result = await runBoundedProcess([process.execPath, "-e", "console.log(process.env.PHOTON_PROCESS_TEST_SECRET ?? 'absent')"]);
  delete process.env.PHOTON_PROCESS_TEST_SECRET;
  expect(result.stdout.trim()).toBe("absent");
});
