import { getStore } from "./storage.ts";
import { validateId } from "./storage.contract.ts";
if (import.meta.main) {
  try {
    const raw = process.argv.slice(2);
    const args = raw[0] === "--" ? raw.slice(1) : raw;
    if (args.length !== 1) throw new Error("ARGUMENT_INVALID");
    validateId(args[0], "batch_id");
    console.log(JSON.stringify(getStore().readBatch(args[0])));
  } catch {
    console.error("READ_BATCH_REJECTED");
    process.exitCode = 1;
  }
}
