export type BridgeControlError = { code: string; recovery: string[] };
export function bridgeControlError(error: unknown): { ok: false; error: BridgeControlError };
export function parseBridgeControlError(raw: string): BridgeControlError | undefined;
