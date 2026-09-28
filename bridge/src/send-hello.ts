import { enqueueMain } from "./enqueue.ts";
/** Compatibility helper uses the existing runtime outbox, never another Spectrum
 * connection or a default production destination. Fenced context is mandatory.
 */
if (import.meta.main) {
  try { await enqueueMain(); } catch { console.error("HELLO_REQUIRES_FENCED_SUBMISSION"); process.exitCode = 1; }
}
