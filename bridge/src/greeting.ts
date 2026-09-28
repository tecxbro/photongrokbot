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

export type GreetingKind = "greeting" | "thanks" | "ack";

export function classifyCasualText(text: string): GreetingKind | null {
  const n = normalizeGreetingText(text);
  if (!n || n.length > 48) return null;
  // how's → hows already via punctuation strip; keep apostrophe words
  const compact = n.replace(/'/g, "");
  if (GREETING_EXACT.has(n) || GREETING_EXACT.has(compact)) return "greeting";
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
 * True only for bare greetings without replies or any non-text content.
 * This is a first-onboarding classifier, never proof that a later chat is idle.
 */
export function isGreetingOnlyBatch(messages: InboundRecord[]): boolean {
  let sawCasual = false;
  for (const m of messages) {
    const kind = m.kind ?? "text";
    if (kind !== "text" || m.replyToMessageId) return false;
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
