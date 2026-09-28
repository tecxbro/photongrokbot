/** Explicit offline entry point for the existing database's forward migrations. */
import { resolveInstancePaths } from "../../shared/instance-paths.mjs";
import { assertInstanceLock } from "./instance-lock.ts";
import { openStore } from "./storage.ts";
import { bridgeControlError } from "./control-errors.ts";

export function upgradeStore(args = process.argv.slice(2)) {
  if (args.length) throw new Error("ARGUMENT_INVALID");
  const paths = resolveInstancePaths();
  assertInstanceLock(paths);
  const store = openStore({ paths, verifyIntegrity: true });
  try {
    const schema = store.db.query("PRAGMA user_version").get() as {user_version: number};
    return {ok: true, schemaVersion: schema.user_version};
  } finally { store.close(); }
}
if (import.meta.main) {
  try { console.log(JSON.stringify(upgradeStore())); }
  catch (error) { console.error(JSON.stringify(bridgeControlError(error))); process.exitCode = 1; }
}
