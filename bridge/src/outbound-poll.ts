/** Validation boundary before poll outbound queue entry. */

export class OutboundPollError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboundPollError";
  }
}

export type PreparedPoll = {
  title: string;
  options: string[];
};

/**
 * Normalize and validate a poll title + choices.
 * Requires a non-empty title and at least two non-empty options after trim.
 * Does not invent or drop choices beyond empty-string filtering.
 */
export function prepareOutboundPoll(
  title: string,
  options: string[],
): PreparedPoll {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    throw new OutboundPollError(
      "refusing empty poll title: provide a clear question.",
    );
  }

  const cleaned = options
    .map((o) => o.trim())
    .filter((o) => o.length > 0);

  if (cleaned.length < 2) {
    throw new OutboundPollError(
      "refusing poll with fewer than two options: provide at least two choices.",
    );
  }

  return { title: trimmedTitle, options: cleaned };
}
