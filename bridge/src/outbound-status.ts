import { getStore } from "./storage.ts";
import { validateId } from "./storage.contract.ts";
if (import.meta.main) {
  try {
    const args = process.argv.slice(2).filter((arg) => arg !== "--");
    if (args.length !== 2 || args[0] !== "--id")
      throw new Error("ARGUMENT_INVALID");
    validateId(args[1]);
    const status = getStore().outboundStatus(args[1]);
    if (!status) throw new Error("OUTBOUND_NOT_FOUND");
    console.log(JSON.stringify(status));
  } catch {
    console.error("OUTBOUND_STATUS_REJECTED");
    process.exitCode = 1;
  }
}
