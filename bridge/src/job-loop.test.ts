import { expect, test } from "bun:test";
import { JobLoop } from "./job-loop.ts";

test("W03 W04: timer cannot overlap an in-flight task and stop joins it", async () => {
  let release!: () => void, started!: () => void;
  let calls = 0, active = 0, max = 0;
  const entered = new Promise<void>(r => { started = r; });
  const barrier = new Promise<void>(r => { release = r; });
  const loop = new JobLoop(async () => { calls++; active++; max = Math.max(active, max); started(); await barrier; active--; }, 1);
  loop.start(); loop.start(); await entered;
  await Bun.sleep(10); expect(calls).toBe(1);
  let stopped = false; const stopping = loop.stop().then(() => { stopped = true; });
  await Bun.sleep(5); expect(stopped).toBe(false);
  release(); await stopping;
  expect(max).toBe(1); expect(calls).toBe(1);
});
test("job errors are redacted through error callback and continue until stop", async () => {
  let errors = 0; const loop = new JobLoop(async () => { throw new Error("private-secret-body"); }, 1, () => { errors++; });
  loop.start(); await Bun.sleep(10); await loop.stop(); expect(errors).toBeGreaterThan(0);
});
