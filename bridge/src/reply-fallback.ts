export type ReplyTargetLike = {
  reply(text: string): Promise<unknown | undefined>;
};

export type ReplySpaceLike = {
  getMessage(messageId: string): Promise<ReplyTargetLike | undefined>;
  send(text: string): Promise<unknown | undefined>;
};

export type ReplyDeliveryResult =
  | { status: "sent"; mode: "reply" | "fallback"; replyError?: string }
  | { status: "failed"; reason: string };

/** Try a threaded reply, then one plain space.send fallback for unreplyable targets. */
export async function sendReplyWithFallback(
  space: ReplySpaceLike,
  targetMessageId: string,
  text: string,
): Promise<ReplyDeliveryResult> {
  let replyError: string;
  try {
    const target = await space.getMessage(targetMessageId);
    if (!target) {
      replyError = `target message not found: ${targetMessageId}`;
    } else {
      const sent = await target.reply(text);
      if (sent !== undefined) return { status: "sent", mode: "reply" };
      replyError = "reply returned undefined";
    }
  } catch (err) {
    replyError = `reply failed: ${String(err)}`;
  }

  try {
    const sent = await space.send(text);
    if (sent !== undefined) {
      return { status: "sent", mode: "fallback", replyError };
    }
    return {
      status: "failed",
      reason: `${replyError}; fallback space.send returned undefined`,
    };
  } catch (err) {
    return {
      status: "failed",
      reason: `${replyError}; fallback space.send failed: ${String(err)}`,
    };
  }
}
