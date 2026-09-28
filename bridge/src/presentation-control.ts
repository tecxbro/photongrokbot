/** Private bounded control plane for the Node milestone helper. Never dispatches. */
import type {
  BridgeStore,
  PresentationContext,
  ClaimToken,
} from "./contracts.ts";
import { getStore } from "./storage.ts";
import { boundedStdin } from "./batch-control.ts";
import { validateClaim, validateId } from "./storage.contract.ts";
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("OBJECT_REQUIRED");
  return value as Record<string, unknown>;
}
function keys(row: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(row).some((key) => !allowed.includes(key)))
    throw new Error("UNKNOWN_FIELD");
}
function string(value: unknown, max: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    value.includes("\0")
  )
    throw new Error("STRING_INVALID");
  return value;
}

function claimToken(value: unknown): ClaimToken {
  const claim = object(value);
  keys(claim, ["batchId", "runId", "generation"]);
  const token = claim as ClaimToken;
  validateClaim(token);
  return token;
}
export async function presentationControl(
  argv: string[],
  store: BridgeStore = getStore(),
  stdin = boundedStdin,
): Promise<unknown> {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  if (args.length !== 2 || args[1] !== "--json-stdin")
    throw new Error("ARGUMENT_INVALID");
  const body = object(JSON.parse(await stdin()));
  if (args[0] === "register") {
    keys(body, ["claim", "context"]);
    const token = claimToken(body.claim);
    const context = object(body.context);
    store.registerPresentation(token, context as PresentationContext);
    return { ok: true };
  }
  if (!["task-context", "operation-status"].includes(args[0]!))
    throw new Error("COMMAND_INVALID");
  keys(
    body,
    args[0] === "task-context"
      ? ["taskId", "batchId", "claim"]
      : ["taskId", "batchId", "actionKey"],
  );
  validateId(body.taskId, "task_id");
  validateId(body.batchId, "batch_id");
  const task = store.getTask(body.taskId);
  const destination = store.readBatch(body.batchId).destination;
  if (
    !task ||
    !["accepted", "completed"].includes(task.state) ||
    !destination ||
    task.batchId !== body.batchId ||
    task.destination.spaceId !== destination.spaceId ||
    task.destination.lineId !== destination.lineId
  )
    throw new Error("TASK_CONTEXT_MISMATCH");
  if (args[0] === "operation-status") {
    const actionKey = string(body.actionKey, 512);
    return {
      items: store.operationStatus(destination, "presentation", actionKey),
    };
  }
  if (body.claim !== undefined) {
    const token = claimToken(body.claim);
    if (token.batchId !== body.batchId)
      throw new Error("TASK_CONTEXT_MISMATCH");
    store.assertClaim(token);
  }
  const configured = store.getMetadata<{ origin: string }>(
    "live-mini-host",
    "configured",
  );
  if (!configured?.origin) throw new Error("LIVE_HOST_NOT_CONFIGURED");
  return {
    taskId: task.taskId,
    batchId: task.batchId,
    destination,
    origin: configured.origin,
  };
}
if (import.meta.main) {
  try {
    console.log(
      JSON.stringify(await presentationControl(process.argv.slice(2))),
    );
  } catch {
    console.error("PRESENTATION_CONTROL_REJECTED");
    process.exitCode = 1;
  }
}
