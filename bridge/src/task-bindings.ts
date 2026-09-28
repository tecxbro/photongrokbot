import type { BridgeStore, ClaimToken, TaskBinding } from "./contracts.ts";
import { validateClaim } from "./storage.contract.ts";
export function recordDelegation(
  store: BridgeStore,
  input: { claim: ClaimToken; task: TaskBinding },
  stage: "intent" | "receipt",
): TaskBinding {
  if (
    !input ||
    Object.keys(input).some((key) => !["claim", "task"].includes(key))
  )
    throw new Error("DELEGATION_INPUT_INVALID");
  validateClaim(input.claim);
  if (
    !input.task ||
    (stage === "intent"
      ? input.task.state !== "intent"
      : !["accepted", "unknown", "completed"].includes(input.task.state))
  )
    throw new Error("DELEGATION_STAGE_INVALID");
  store.bindTask(input.claim, input.task);
  return store.getTask(input.task.taskId)!;
}
