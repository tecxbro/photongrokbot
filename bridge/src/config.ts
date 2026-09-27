import { chmodSync, existsSync, readFileSync } from "node:fs";
import type { Config } from "./types.ts";
import { ENV_PATH } from "./types.ts";

function stripQuotes(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function loadEnvFile(path = ENV_PATH): void {
  if (!existsSync(path)) return;
  chmodSync(path, 0o600);
  const text = readFileSync(path, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = stripQuotes(line.slice(eq + 1).trim());
    // .env is source of truth on this VM; stale shell exports must not win.
    process.env[key] = value;
  }
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
}


export function loadConfig(): Config {
  loadEnvFile();
  return {
    projectId: required("SPECTRUM_PROJECT_ID"),
    projectSecret: required("SPECTRUM_PROJECT_SECRET"),
    authorizedSenderId: required("AUTHORIZED_SENDER_ID"),
    webhookUrl: required("GROK_ORCHESTRATOR_WEBHOOK_URL"),
    webhookKey: required("GROK_ORCHESTRATOR_WEBHOOK_KEY"),
  };
}
