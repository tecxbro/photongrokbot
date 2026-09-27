/** Shared formatting + validation boundary before outbound queue entry. */

export const STANDALONE_PROOF_MARKERS = [
  "SPECTRUM_RECEIVED",
  "SPECTRUM_ROUTED",
  "SPECTRUM_DONE",
] as const;

export class OutboundTextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboundTextError";
  }
}

/**
 * Split composed text into intended iMessage bubbles.
 * Blank-line-separated prose blocks become separate bubbles.
 * Fenced code blocks (``` ... ```) stay one unit, including internal blank lines.
 * Does not truncate, lowercase, or reflow to a character limit.
 */
export function splitIntendedBubbles(text: string): string[] {
  const source = text.replace(/\r\n/g, "\n");
  const bubbles: string[] = [];
  let buf: string[] = [];
  let inFence = false;

  const flush = () => {
    const block = buf.join("\n").trim();
    buf = [];
    if (block.length > 0) bubbles.push(block);
  };

  for (const line of source.split("\n")) {
    const fence = line.trimStart().startsWith("```");
    if (fence) {
      inFence = !inFence;
      buf.push(line);
      continue;
    }
    if (!inFence && line.trim() === "") {
      flush();
      continue;
    }
    buf.push(line);
  }
  flush();
  return bubbles;
}

export function isStandaloneProofMarker(bubble: string): boolean {
  const trimmed = bubble.trim();
  return (STANDALONE_PROOF_MARKERS as readonly string[]).includes(trimmed);
}

/**
 * Validate intended bubbles. Rejects the whole submission if any bubble is
 * exactly a standalone proof marker (after trim). Mentions inside longer text
 * or code are allowed.
 */
export function assertNoStandaloneProofMarkers(bubbles: string[]): void {
  for (const bubble of bubbles) {
    if (isStandaloneProofMarker(bubble)) {
      throw new OutboundTextError(
        `refusing standalone proof marker ${JSON.stringify(bubble.trim())}: ` +
          "do not enqueue SPECTRUM_RECEIVED / SPECTRUM_ROUTED / SPECTRUM_DONE. " +
          "send a useful conversational reply instead, or omit the update. " +
          "no outbound entries were created.",
      );
    }
  }
}

export type PreparedOutbound =
  | { kind: "text"; bubbles: string[] }
  | { kind: "attachment"; text: string; attachmentPath: string };

/**
 * One formatting boundary before queue write.
 * Attachments stay a single entry (delivery unchanged).
 * Plain text is split into intended bubbles once here (not again at send).
 */
export function prepareOutboundText(
  text: string,
  attachmentPath?: string,
): PreparedOutbound {
  if (attachmentPath) {
    const body = text.trim().length > 0 ? text : `[attachment] ${attachmentPath}`;
    // Attachment submissions are a single payload; still block a lone proof marker as text.
    if (isStandaloneProofMarker(body)) {
      throw new OutboundTextError(
        `refusing standalone proof marker ${JSON.stringify(body.trim())}: ` +
          "do not enqueue SPECTRUM_RECEIVED / SPECTRUM_ROUTED / SPECTRUM_DONE. " +
          "no outbound entries were created.",
      );
    }
    return { kind: "attachment", text: body, attachmentPath };
  }

  const bubbles = splitIntendedBubbles(text);
  if (bubbles.length === 0) {
    throw new OutboundTextError(
      "refusing empty outbound text: nothing to enqueue.",
    );
  }
  assertNoStandaloneProofMarkers(bubbles);
  return { kind: "text", bubbles };
}
