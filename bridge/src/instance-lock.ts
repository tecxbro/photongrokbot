import { fstatSync, lstatSync } from "node:fs";
import { join } from "node:path";
import type { InstancePaths } from "../../shared/instance-paths.mjs";

/** The supported launcher holds a kernel lock in this process across exec. */
export function assertInstanceLock(paths: InstancePaths): void {
  const raw = process.env.PHOTON_LOCK_FD;
  if (!raw || !/^\d+$/.test(raw)) throw new Error("INSTANCE_LOCK_REQUIRED");
  try {
    const held = fstatSync(Number(raw));
    const file = lstatSync(join(paths.root, "runtime.lock"));
    if (!held.isFile() || !file.isFile() || held.ino !== file.ino || held.dev !== file.dev) {
      throw new Error("mismatched lock");
    }
  } catch {
    throw new Error("INSTANCE_LOCK_REQUIRED");
  }
}
