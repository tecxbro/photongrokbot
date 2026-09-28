import { getStore } from "./storage.ts";
import { validateId } from "./storage.contract.ts";
if (import.meta.main) {
  try {
    const raw = process.argv.slice(2);
    const args = raw[0] === "--" ? raw.slice(1) : raw;
    if (args.length !== 1 && !(args.length === 3 && args[1] === "--input-revision")) throw new Error("ARGUMENT_INVALID");
    validateId(args[0], "batch_id");
    console.log(JSON.stringify(getStore().readBatch(args[0], args[2] === undefined ? undefined : Number(args[2]))));
  } catch {
    console.error("READ_BATCH_REJECTED");
    process.exitCode = 1;
  }
}
