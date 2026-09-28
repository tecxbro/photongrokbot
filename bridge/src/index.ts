import { loadConfig } from "./config.ts";
import { GpProofRuntime } from "./runtime.ts";

export async function main(): Promise<void> {
  const runtime = new GpProofRuntime(loadConfig());
  await runtime.start();
}

if (import.meta.main) {
  try { await main(); }
  catch {
    console.error("[photon] RUNTIME_FAILED");
    process.exitCode = 1;
  }
  // All durable workers have settled or recorded uncertainty before start returns.
  // Bound process termination even if an optional provider control leaves a socket.
  process.exit(process.exitCode ?? 0);
}
