/**
 * First successful iMessage setup → mandatory Confetti once.
 * Marker lives under data/ so we never re-celebrate after the first send.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { DATA_DIR } from "./types.ts";

const MARKER_PATH = join(DATA_DIR, "onboarding-celebrated.json");

export type OnboardingCelebrated = {
  setupConfettiSent: boolean;
  sentAt?: string;
};

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(tmp, path);
}

async function readMarker(): Promise<OnboardingCelebrated> {
  if (!existsSync(MARKER_PATH)) {
    return { setupConfettiSent: false };
  }
  try {
    return JSON.parse(await readFile(MARKER_PATH, "utf8")) as OnboardingCelebrated;
  } catch {
    return { setupConfettiSent: false };
  }
}

/** True when the mandatory first-setup Confetti has already been sent. */
export async function hasSetupConfettiBeenSent(): Promise<boolean> {
  const file = await readMarker();
  return file.setupConfettiSent === true;
}

/** Persist that first-setup Confetti was sent (idempotent). */
export async function markSetupConfettiSent(
  sentAt: string = new Date().toISOString(),
): Promise<void> {
  const existing = await readMarker();
  if (existing.setupConfettiSent) return;
  await atomicWriteJson(MARKER_PATH, {
    setupConfettiSent: true,
    sentAt,
  } satisfies OnboardingCelebrated);
}

export { MARKER_PATH as SETUP_CONFETTI_MARKER_PATH };
