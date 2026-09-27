import { loadConfig } from "./config.ts";
import { GpProofRuntime } from "./runtime.ts";

async function main(): Promise<void> {
  const config = loadConfig();
  const runtime = new GpProofRuntime(config);
  await runtime.start();
}

main().catch((err) => {
  console.error("[{{DEPLOY_ID_PREFIX}}] fatal", err);
  process.exit(1);
});
