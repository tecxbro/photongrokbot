/** Validation boundary before app / app_update outbound queue entry. */

export class OutboundAppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboundAppError";
  }
}

export type PreparedApp = {
  url: string;
  live: boolean;
};

/**
 * Normalize and validate an app card URL.
 * Requires an absolute http(s) URL after trim. `live` defaults to false.
 */
export function prepareOutboundApp(
  url: string,
  live: boolean = false,
): PreparedApp {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new OutboundAppError(
      "refusing empty app url: provide an absolute http(s) URL.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new OutboundAppError(
      "refusing invalid app url: must be an absolute http(s) URL.",
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new OutboundAppError(
      "refusing app url: only http and https schemes are allowed.",
    );
  }

  return { url: trimmed, live: Boolean(live) };
}
