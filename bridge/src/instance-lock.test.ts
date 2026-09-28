import { test, expect } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const wrapper = fileURLToPath(new URL("../tools/with-instance-lock.py", import.meta.url));
test("W04: separate owner cannot steal lifetime lock; SIGKILL releases it", async () => {
  const root = mkdtempSync(join(tmpdir(), "photon-lock-"));
  const path = join(root, "runtime.lock");
  const first = spawn("python3", [wrapper, path, process.execPath, "-e", 'console.log("READY");setInterval(()=>{},1000)'], {stdio:["ignore","pipe","pipe"]});
  const firstExit = new Promise(resolve => first.once("exit", resolve));
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("lock readiness timeout")), 3000);
      first.stdout.once("data", data => { clearTimeout(timer); data.toString().includes("READY") ? resolve() : reject(new Error("lock failed")); });
      first.once("error", reject);
    });
    const second = Bun.spawn(["python3", wrapper, path, process.execPath, "-e", 'console.log("UNEXPECTED")'], {stdout:"pipe",stderr:"pipe"});
    expect(await second.exited).toBe(73);
    expect(await new Response(second.stdout).text()).toBe("");
    first.kill("SIGKILL"); await firstExit;
    const third = Bun.spawn(["python3", wrapper, path, process.execPath, "-e", 'console.log("LOCKED")'], {stdout:"pipe",stderr:"pipe"});
    expect(await third.exited).toBe(0);
    expect((await new Response(third.stdout).text()).trim()).toBe("LOCKED");
  } finally { first.kill("SIGKILL"); await firstExit; rmSync(root, {recursive:true,force:true}); }
}, 10000);
