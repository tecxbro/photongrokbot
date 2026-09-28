import { bridgeControlError } from "./control-errors.ts";
import { getStore } from "./storage.ts";
import { boundedStdin } from "./batch-control.ts";
import { assertInstanceLock } from "./instance-lock.ts";
import { resolveInstancePaths } from "../../shared/instance-paths.mjs";
import { validateId } from "./storage.contract.ts";
if (import.meta.main) {
  try {
    const raw = process.argv.slice(2);
    const args = raw[0] === "--" ? raw.slice(1) : raw;
    if (args.length === 1 && args[0] === "--resolve-json-stdin") {
      assertInstanceLock(resolveInstancePaths());
      const input = JSON.parse(await boundedStdin());
      if (
        !input ||
        Object.keys(input).some(
          (key) => !["id", "state", "evidence", "reference"].includes(key),
        )
      )
        throw new Error("RECONCILIATION_INPUT_INVALID");
      console.log(
        JSON.stringify(
          getStore().reconcileOutbound(input.id, {
            state: input.state,
            evidence: input.evidence,
            reference: input.reference,
          }),
        ),
      );
    } else {
      if (args.length !== 2 || args[0] !== "--id")
        throw new Error("ARGUMENT_INVALID");
      validateId(args[1]);
      const status = getStore().outboundStatus(args[1]);
      if (!status) throw new Error("OUTBOUND_NOT_FOUND");
      console.log(JSON.stringify(status));
    }
  } catch (error) {
    console.error(JSON.stringify(bridgeControlError(error)));
    process.exitCode = 1;
  }
}
