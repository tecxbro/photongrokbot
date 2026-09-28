import type { ProviderOutcome, ProviderReference } from "./contracts.ts";
export function providerReference(value: unknown): ProviderReference | undefined {
    if (!value || typeof value !== "object")
        return;
    const row = value as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id)
        return;
    const reference: ProviderReference = { messageId: row.id };
    const raw = row.miniAppCardSession;
    if (raw && typeof raw === "object") {
        const session = raw as Record<string, unknown>;
        if (["chatGuid", "messageGuid", "sessionId", "targetMessageGuid"].every((k) => typeof session[k] === "string" && session[k]))
            reference.miniAppCardSession = session as NonNullable<ProviderReference["miniAppCardSession"]>;
    }
    return reference;
}
/** Locked Spectrum non-control sends throw if an applied send lacks an ID;
 * undefined is the core's documented UnsupportedError warn-and-skip result.
 */
export function contentOutcome(value: unknown): ProviderOutcome {
    if (value === undefined)
        return { state: "skipped", code: "spectrum_unsupported_skip" };
    const reference = providerReference(value);
    return reference ? { state: "accepted", reference, evidence: "spectrum_message_reference" } : { state: "unknown", code: "provider_reference_missing" };
}
export function retryDelay(attempt: number, random = Math.random): number { return Math.min(60000, 1000 * 2 ** Math.max(0, attempt - 1)) + Math.floor(random() * 500); }
/** Only read/preflight operations qualify here. No thrown send is classified by
 * guessed HTTP codes or message substrings as safe to resend.
 */
export function preDispatchFailure(attempt: number, maxAttempts = 5, random = Math.random): ProviderOutcome {
    return attempt >= maxAttempts ? { state: "failed", code: "preflight_retry_exhausted" } : { state: "retry_wait", code: "preflight_not_dispatched", retryAfterMs: retryDelay(attempt, random) };
}
