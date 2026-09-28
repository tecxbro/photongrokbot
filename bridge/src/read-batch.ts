import { getStore } from "./storage.ts";
import { validateId } from "./storage.contract.ts";
if (import.meta.main) {
  try {
    const args = process.argv.slice(2).filter((arg) => arg !== "--");
    if (args.length !== 1) throw new Error("ARGUMENT_INVALID");
    validateId(args[0], "batch_id");
    console.log(JSON.stringify(getStore().readBatch(args[0])));
  } catch {
    console.error("READ_BATCH_REJECTED");
    process.exitCode = 1;
  }
}
