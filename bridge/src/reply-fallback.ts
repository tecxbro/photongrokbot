import type { ProviderOutcome } from "./contracts.ts";
import { contentOutcome } from "./provider-outcome.ts";
export type ReplyTargetLike = { reply(text: string): Promise<unknown> };
export type ReplySpaceLike = { getMessage(messageId: string): Promise<ReplyTargetLike | undefined>; send(text: string): Promise<unknown> };
export type ReplyDeliveryResult = { outcome: ProviderOutcome; mode: "reply" | "fallback" | "lookup" };

/** No fallback follows a thrown/uncertain reply. The caller must establish the
 * target belongs to its stored conversation before invoking this function.
 */
export async function sendReplyWithFallback(space: ReplySpaceLike, targetMessageId: string, text: string, opts: { spectrumUndefinedIsSkipped?: boolean; signal?: AbortSignal } = {}): Promise<ReplyDeliveryResult> {
  let target: ReplyTargetLike | undefined;
  try { target = await space.getMessage(targetMessageId); } catch { return { outcome: { state: "retry_wait", code: "reply_lookup_not_dispatched", retryAfterMs: 1000 }, mode: "lookup" }; }
  if (opts.signal?.aborted) return { outcome: { state: "unknown", code: "reply_aborted" }, mode: "lookup" };
  if (target) {
    try {
      const result = await target.reply(text);
      if (result !== undefined) return { outcome: contentOutcome(result), mode: "reply" };
      if (!opts.spectrumUndefinedIsSkipped) return { outcome: { state: "unknown", code: "reply_undefined_unverified" }, mode: "reply" };
      // Verified locked SDK skip: provider did not apply a reply.
    } catch { return { outcome: { state: "unknown", code: "reply_send_uncertain" }, mode: "reply" }; }
  }
  if (opts.signal?.aborted) return { outcome: { state: "unknown", code: "reply_aborted" }, mode: "fallback" };
  try { return { outcome: contentOutcome(await space.send(text)), mode: "fallback" }; }
  catch { return { outcome: { state: "unknown", code: "reply_fallback_uncertain" }, mode: "fallback" }; }
}
