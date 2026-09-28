import { getStore } from "./storage.ts";
import { recordDelegation } from "./task-bindings.ts";
import { validateClaim, validateId } from "./storage.contract.ts";
import type { BridgeStore } from "./contracts.ts";
export async function boundedStdin(
  stream: ReadableStream<Uint8Array> = Bun.stdin.stream(),
): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 65536) {
        await reader.cancel();
        throw new Error("INPUT_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}
export async function control(
  args: string[],
  store: BridgeStore = getStore(),
  stdin = boundedStdin,
): Promise<unknown> {
  args = args[0] === "--" ? args.slice(1) : [...args];
  const command = args.shift();
  if (command === "delegation-intent" || command === "delegation-receipt") {
    if (args.length !== 1 || args[0] !== "--json-stdin")
      throw new Error("JSON_STDIN_REQUIRED");
    const body = await stdin();
    if (body.length > 65536) throw new Error("INPUT_TOO_LARGE");
    return recordDelegation(
      store,
      JSON.parse(body),
      command === "delegation-intent" ? "intent" : "receipt",
    );
  }
  if (!["claim", "renew", "complete"].includes(command ?? ""))
    throw new Error("COMMAND_INVALID");
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]!;
    if (
      !["--batch-id", "--run-id", "--generation"].includes(key) ||
      key in flags ||
      !args[i + 1]
    )
      throw new Error("ARGUMENT_INVALID");
    flags[key] = args[i + 1]!;
  }
  const batchId = flags["--batch-id"];
  validateId(batchId, "batch_id");
  if (command === "claim") {
    if (Object.keys(flags).length !== 1) throw new Error("ARGUMENT_INVALID");
    return store.claimBatch(batchId);
  }
  const token = {
    batchId,
    runId: flags["--run-id"]!,
    generation: Number(flags["--generation"]),
  };
  validateClaim(token);
  if (command === "renew") store.renewClaim(token);
  else store.completeClaim(token);
  return { ok: true, batchId };
}
if (import.meta.main) {
  try {
    console.log(JSON.stringify(await control(process.argv.slice(2))));
  } catch {
    console.error("BATCH_CONTROL_REJECTED");
    process.exitCode = 1;
  }
}
