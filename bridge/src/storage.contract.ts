import type {
  BridgeStore,
  ClaimToken,
  Destination,
  OutboundStatus,
  ProviderReference,
  TaskBinding,
} from "./contracts.ts";
import type { InboundRecord, OutboundItem } from "./types.ts";
import type { DatabasePaths } from "./db.ts";
export type StoreOptions = {
  paths?: DatabasePaths;
  create?: boolean;
  readOnly?: boolean;
  /** Full database traversal for runtime startup/explicit diagnostics, not each CLI. */
  verifyIntegrity?: boolean;
  testMode?: boolean;
  /** Injected only in tests; never environment-triggered. */ fault?: (
    transition: string,
  ) => void;
};
export type ClaimSnapshot = {
  state: string;
  runId: string | null;
  generation: number;
  leaseUntil: number | null;
  inputRevision: number;
  claimedRevision: number | null;
  acknowledgedRevision: number;
};
export type PrivacySummary = {
  events: number;
  outbound: number;
  unresolved: number;
  prunableEvents: number;
  prunableOutbound: number;
};
export interface ExtendedBridgeStore extends BridgeStore {
  backupTo(path: string): void;
  tasksForBatch(batchId: string): TaskBinding[];
  reconcileOutbound(
    id: string,
    input: {
      state: "accepted" | "cancelled";
      evidence: string;
      reference?: ProviderReference;
    },
  ): OutboundStatus;
  reconcileTask(
    taskId: string,
    input: { state: "accepted" | "completed"; receipt: string },
  ): TaskBinding;
  acknowledgePrunedArtifacts(paths: string[]): void;
  activeConversationWork(): Destination[];
  batchDestination(batchId: string): Destination;
  claimSnapshot(batchId: string): ClaimSnapshot;
  recentInbound(limit?: number, destination?: Destination): InboundRecord[];
  listOutbound(limit?: number): OutboundItem[];
  privacySnapshot(nowMs?: number): PrivacySummary;
  pruneResolvedBefore(options: {
    resolvedBefore: number;
    intermediateBefore: number;
    intermediatePaths?: Array<{ path: string; createdAt: number }>;
    apply?: boolean;
  }): { events: number; outbound: number; artifactPaths: string[] };
  /** Strictly local recorded task evidence. Never invokes a native tool. */
  dispatchContinuations(): number;
  recoverWork(): { media: number; wakes: number; tasks: number };
}
export function validateId(
  value: unknown,
  name = "id",
): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_{}-][A-Za-z0-9_{}.-]{0,199}$/.test(value) ||
    value.includes("..")
  )
    throw new Error(`INVALID_${name.toUpperCase()}`);
}
export function validateDestination(value: Destination): void {
  if (
    !value ||
    typeof value.spaceId !== "string" ||
    !value.spaceId.trim() ||
    value.spaceId.length > 1000 ||
    typeof value.lineId !== "string" ||
    !value.lineId.trim() ||
    value.lineId.length > 1000
  )
    throw new Error("DESTINATION_INVALID");
}
export function validateClaim(value: ClaimToken): void {
  if (!value) throw new Error("CLAIM_REQUIRED");
  validateId(value.batchId, "batch_id");
  validateId(value.runId, "run_id");
  if (!Number.isSafeInteger(value.generation) || value.generation < 1)
    throw new Error("CLAIM_GENERATION_INVALID");
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  if (
    value === undefined ||
    typeof value === "function" ||
    (typeof value === "number" && !Number.isFinite(value))
  )
    throw new Error("JSON_VALUE_INVALID");
  return JSON.stringify(value);
}
export function parseRecord(raw: string): InboundRecord {
  const value = JSON.parse(raw);
  validateRecord(value);
  return value;
}
export function validateRecord(value: unknown): asserts value is InboundRecord {
  const v = value as InboundRecord;
  if (
    !v ||
    typeof v !== "object" ||
    typeof v.id !== "string" ||
    !v.id ||
    typeof v.spaceId !== "string" ||
    !v.spaceId ||
    typeof v.senderId !== "string" ||
    typeof v.text !== "string" ||
    typeof v.timestamp !== "string" ||
    typeof v.receivedAt !== "string" ||
    !Number.isFinite(Date.parse(v.receivedAt))
  )
    throw new Error("INBOUND_RECORD_INVALID");
  if (
    v.kind &&
    !["text", "reaction", "poll_vote", "attachment", "voice"].includes(v.kind)
  )
    throw new Error("INBOUND_KIND_INVALID");
}
