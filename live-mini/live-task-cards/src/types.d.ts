/** Integration-facing data contract. The HTTP boundary also performs runtime validation. */
export type Template = 'dots' | 'segments' | 'stages' | 'matrix';
export type Status = 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
export interface Content {
  template: Template;
  theme?: 'dark' | 'light';
  eyebrow?: string;
  title: string;
  subtitle?: string;
  status: Status;
  header?: 'none' | 'study' | 'hands';
  stages: Array<{ id: string; label: string; state: 'pending' | 'active' | 'done' | 'blocked' }>;
  detail: { title: string; subtitle?: string };
  workflow?: { weights: Array<{ stageId: string; weight: number; paceSeconds?: number }> } | null;
  progress?: { completed: number; total: number; unit: string } | null;
  activityPlan?: Array<{ stageId: string; icon: 'planning' | 'verifying' | 'researching' | 'analyzing' | 'report' | 'working'; label: string }> | null;
  /** Legacy saved cards only. New matrix cards use activityPlan. */
  activityHistory?: Array<{ icon: 'planning' | 'verifying' | 'researching' | 'analyzing' | 'report' | 'working'; label: string }> | null;
}
export interface CreateRequest { requestId: string; taskId: string; conversationRef: string; ownerRef?: string; content: Content; }
export interface UpdateRequest { requestId: string; expectedRevision: number; content: Content; }
export interface CardRecord {
  ownerRef: string | null; loaderAssetId: string | null;
  id: string; slot: string; taskId: string; conversationRef: string; revision: number;
  workflowTiming?: { stageId: string | null; elapsedMs: number; resumedAt: string | null } | null;
  createdAt: string; updatedAt: string; archivedAt: string | null; content: Content; viewUrl: string;
  delivery: { messageRef: string | null; presentedRevision: number; lastAttempt: object | null };
  activeAttempt: { id: string; revision: number; kind: 'send' | 'update'; state: 'in_flight' | 'unknown' } | null; // update is retained legacy state only
}
export interface OriginalTargetStore<Message, Space> {
  get(id: string): Promise<{ message: Message; space: Space } | null>;
  set(id: string, value: { message: Message; space: Space }): Promise<void>;
}

/** Prepared by the bundled skill; original images and executable code are not uploaded. */
export type LoaderAsset = {
  name: string; columns: number; rows: number;
} & ({ kind: 'static'; cells: string } | { kind: 'animation'; duration: number; frames: Array<[number, string]> });
export interface LoaderPreference { revision: number; loader: (LoaderAsset & { id: string }) | null; }
export interface LoaderChangeRequest {
  ownerRef: string; requestId: string; expectedRevision: number;
  action: 'replace' | 'reset'; asset?: LoaderAsset;
}
/** Supplied by trusted executor code, never by photo contents or model-selected recipient data. */
export interface LoaderRuntimeHooks<Space, Context> {
  resolveOwner(space: Space, context: Context): Promise<string> | string;
  authorizeLoaderChange(space: Space, context: Context): Promise<{ action: 'replace' | 'reset'; requestId: string } | null> | { action: 'replace' | 'reset'; requestId: string } | null;
}
