import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { resolveInstancePaths, assertPrivateFile } from "../../shared/instance-paths.mjs";

/** Bootstrap, migration and runtime share this supported kernel-lock launcher. */
export async function runLocked(command: string[]): Promise<number> {
  if (!command.length) throw new Error("LOCK_COMMAND_REQUIRED");
  const paths = resolveInstancePaths();
  assertPrivateFile(paths.configPath, paths.root);
  const child = spawn("python3", [fileURLToPath(new URL("../tools/with-instance-lock.py", import.meta.url)), join(paths.root, "runtime.lock"), ...command], { stdio: "inherit", env: process.env });
  const interrupt = () => child.kill("SIGINT");
  const terminate = () => child.kill("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  try {
    return await new Promise<number>((resolve, reject) => {
      child.once("error", () => reject(new Error("INSTANCE_LOCK_LAUNCH_FAILED")));
      child.once("exit", (code) => resolve(code ?? 1));
    });
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  }
}
if (import.meta.main) {
  try {
    const args = process.argv.slice(2).filter((value, i) => i !== 0 || value !== "--");
    process.exitCode = await runLocked(args.length ? args : [process.execPath, "run", fileURLToPath(new URL("./index.ts", import.meta.url))]);
  } catch {
    console.error("INSTANCE_LOCK_LAUNCH_FAILED"); process.exitCode = 1;
  }
}
