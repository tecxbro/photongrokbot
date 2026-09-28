import { bridgeControlError } from "./control-errors.ts";
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
function revision(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    throw new Error("INPUT_REVISION_INVALID");
  return value as number;
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
    keys(body, ["claim", "context", "inputRevision", "taskInputRevision"]);
    const token = claimToken(body.claim);
    const context = object(body.context);
    validateId(context.taskId, "task_id");
    const workRevision = store.assertWork(token, revision(body.inputRevision));
    const input = store.getTaskInput(context.taskId, token.batchId, workRevision);
    if (body.taskInputRevision !== undefined && revision(body.taskInputRevision) !== input.inputRevision)
      throw new Error("SUPERSEDED_TASK_INPUT");
    if (!["accepted", "completed"].includes(input.state)) throw new Error("TASK_NOT_ACCEPTED");
    store.registerPresentation(token, context as PresentationContext);
    return { ok: true };
  }
  if (!["task-context", "operation-status"].includes(args[0]!))
    throw new Error("COMMAND_INVALID");
  keys(
    body,
    args[0] === "task-context"
      ? ["taskId", "batchId", "claim", "inputRevision", "taskInputRevision"]
      : ["taskId", "batchId", "actionKey", "cardId", "inputRevision", "taskInputRevision"],
  );
  validateId(body.taskId, "task_id");
  validateId(body.batchId, "batch_id");
  const task = store.getTask(body.taskId);
  const batch = store.readBatch(body.batchId);
  const destination = batch.destination;
  if (
    !task ||
    !destination ||
    task.destination.spaceId !== destination.spaceId ||
    task.destination.lineId !== destination.lineId
  )
    throw new Error("TASK_CONTEXT_MISMATCH");
  let inputRevision = revision(body.inputRevision) ?? batch.inputRevision;
  if (body.claim !== undefined) {
    const token = claimToken(body.claim);
    if (token.batchId !== body.batchId)
      throw new Error("TASK_CONTEXT_MISMATCH");
    inputRevision = store.assertWork(token, inputRevision);
  }
  const input = store.getTaskInput(body.taskId, body.batchId, inputRevision, body.claim !== undefined);
  if (body.taskInputRevision !== undefined && revision(body.taskInputRevision) !== input.inputRevision)
    throw new Error("SUPERSEDED_TASK_INPUT");
  if (body.claim !== undefined && !["accepted", "completed"].includes(input.state))
    throw new Error("TASK_NOT_ACCEPTED");
  if (args[0] === "operation-status") {
    const actionKey = string(body.actionKey, 512);
    validateId(body.cardId, "card_id");
    const context = store.getMetadata<PresentationContext>("task-card-context", body.cardId);
    if (!context || context.taskId !== task.taskId || context.batchId !== task.batchId ||
        context.destination.spaceId !== destination.spaceId || context.destination.lineId !== destination.lineId)
      throw new Error("TASK_CARD_CONTEXT_MISMATCH");
    return {
      items: store.operationStatus(destination, "presentation", actionKey, {
        batchId: body.batchId,
        inputRevision: inputRevision ?? input.workRevision,
        taskId: task.taskId,
        taskInputRevision: input.inputRevision,
        cardId: body.cardId,
      }),
    };
  }
  const configured = store.getMetadata<{ origin: string }>(
    "live-mini-host",
    "configured",
  );
  if (!configured?.origin) throw new Error("LIVE_HOST_NOT_CONFIGURED");
  return {
    taskId: task.taskId,
    batchId: body.batchId,
    originalBatchId: task.batchId,
    inputRevision: inputRevision ?? input.workRevision,
    taskInputRevision: input.inputRevision,
    destination,
    origin: configured.origin,
  };
}
if (import.meta.main) {
  try {
    console.log(
      JSON.stringify(await presentationControl(process.argv.slice(2))),
    );
  } catch (error) {
    console.error(JSON.stringify(bridgeControlError(error)));
    process.exitCode = 1;
  }
}
