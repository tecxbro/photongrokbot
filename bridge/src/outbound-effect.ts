/** Validation + allowlist for iMessage message/screen effects (Spectrum). */

export class OutboundEffectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboundEffectError";
  }
}

/** Short names accepted by CLI / enqueue (`--effect <name>`). */
export const MESSAGE_EFFECT_NAMES = [
  // Bubble (expressive send)
  "slam",
  "loud",
  "gentle",
  "invisible",
  // Screen
  "confetti",
  "fireworks",
  "balloons",
  "heart",
  "lasers",
  "celebration",
  "sparkles",
  "spotlight",
  "echo",
] as const;

export type MessageEffectName = (typeof MESSAGE_EFFECT_NAMES)[number];

const ALLOWED = new Set<string>(MESSAGE_EFFECT_NAMES);

export function isMessageEffectName(name: string): name is MessageEffectName {
  return ALLOWED.has(name);
}

/**
 * Normalize + validate an effect short name.
 * Rejects unknown names with a clear allowlist error.
 */
export function prepareOutboundEffect(raw: string): MessageEffectName {
  const name = raw.trim().toLowerCase();
  if (!name) {
    throw new OutboundEffectError(
      "refusing empty --effect: provide a short name (e.g. confetti, slam).",
    );
  }
  if (!isMessageEffectName(name)) {
    throw new OutboundEffectError(
      `unknown effect ${JSON.stringify(raw.trim())}: ` +
        `allowed: ${MESSAGE_EFFECT_NAMES.join(", ")}`,
    );
  }
  return name;
}
