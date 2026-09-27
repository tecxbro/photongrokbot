import type { InboundRecord } from "./types.ts";

/** Fast debounce when the pending batch is greeting-only. */
export const GREETING_DEBOUNCE_MS = 250;

const GREETING_REPLIES = [
  "Hey! What’s up?",
  "Hi — how’s it going?",
  "Hey hey. What’s going on?",
  "Yo — I’m here.",
  "Hey! What can I help with?",
] as const;

const THANKS_REPLIES = [
  "Anytime.",
  "You got it.",
  "Np!",
] as const;

const ACK_REPLIES = [
  "Cool.",
  "Sounds good.",
  "Got it.",
] as const;

/** Normalize for matching: lowercase, strip punctuation, collapse spaces. */
export function normalizeGreetingText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const GREETING_EXACT = new Set([
  "hi",
  "hii",
  "hiii",
  "hello",
  "helloo",
  "hey",
  "heya",
  "heyy",
  "yo",
  "sup",
  "wassup",
  "whats up",
  "what s up",
  "whatsup",
  "what up",
  "howdy",
  "good morning",
  "good afternoon",
  "good evening",
  "good night",
  "morning",
  "evening",
  "how are you",
  "how are ya",
  "hows it going",
  "how is it going",
  "how's it going",
  "how you doing",
  "how re you",
  "hey there",
  "hi there",
  "hello there",
]);

const THANKS_EXACT = new Set([
  "thanks",
  "thank you",
  "thank u",
  "thx",
  "ty",
  "tyty",
  "thanks!",
]);

const ACK_EXACT = new Set([
  "ok",
  "okay",
  "k",
  "kk",
  "cool",
  "nice",
  "np",
  "yep",
  "yeah",
  "yea",
  "bet",
]);

export type GreetingKind = "greeting" | "thanks" | "ack";

export function classifyCasualText(text: string): GreetingKind | null {
  const n = normalizeGreetingText(text);
  if (!n || n.length > 48) return null;
  // how's → hows already via punctuation strip; keep apostrophe words
  const compact = n.replace(/'/g, "");
  if (GREETING_EXACT.has(n) || GREETING_EXACT.has(compact)) return "greeting";
  if (THANKS_EXACT.has(n) || THANKS_EXACT.has(compact)) return "thanks";
  if (ACK_EXACT.has(n) || ACK_EXACT.has(compact)) return "ack";
  return null;
}

export function pickCannedReply(kind: GreetingKind, salt = Date.now()): string {
  const pool =
    kind === "thanks"
      ? THANKS_REPLIES
      : kind === "ack"
        ? ACK_REPLIES
        : GREETING_REPLIES;
  return pool[salt % pool.length]!;
}

/**
 * True when every text message is a casual greeting/ack and there is at least
 * one such text. Reactions alone do not trigger a fast-path reply.
 */
export function isGreetingOnlyBatch(messages: InboundRecord[]): boolean {
  let sawCasual = false;
  for (const m of messages) {
    const kind = m.kind ?? "text";
    if (kind === "reaction") continue;
    if (kind !== "text") return false;
    const casual = classifyCasualText(m.text);
    if (!casual) return false;
    sawCasual = true;
  }
  return sawCasual;
}

/** Dominant casual kind in the batch (prefer greeting > thanks > ack). */
export function batchCasualKind(messages: InboundRecord[]): GreetingKind {
  let best: GreetingKind = "ack";
  for (const m of messages) {
    if ((m.kind ?? "text") !== "text") continue;
    const c = classifyCasualText(m.text);
    if (!c) continue;
    if (c === "greeting") return "greeting";
    if (c === "thanks") best = "thanks";
    else if (best !== "thanks") best = "ack";
  }
  return best;
}
