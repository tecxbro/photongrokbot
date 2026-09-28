import { readFileSync } from 'node:fs';
import { assertPrivateFile, resolveInstancePaths } from '../../shared/instance-paths.mjs';
import type { Config } from './types.ts';

export const BRIDGE_FIELDS = ['SPECTRUM_PROJECT_ID', 'SPECTRUM_PROJECT_SECRET', 'AUTHORIZED_SENDER_ID', 'GROK_ORCHESTRATOR_WEBHOOK_URL', 'GROK_ORCHESTRATOR_WEBHOOK_KEY'] as const;

/** Deliberately no shell evaluation, interpolation, or process.env mutation. */
export function parseBridgeEnv(text: string): Record<string, string> {
  if (Buffer.byteLength(text) > 64 * 1024) throw new Error('CONFIG_TOO_LARGE');
  const values: Record<string, string> = Object.create(null);
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match || !BRIDGE_FIELDS.includes(match[1] as typeof BRIDGE_FIELDS[number])) throw new Error('CONFIG_UNKNOWN_OR_INVALID_FIELD');
    const [, key, encoded] = match;
    if (Object.hasOwn(values, key!)) throw new Error(`CONFIG_DUPLICATE_${key}`);
    let value = encoded!;
    if (/^["']/.test(value)) {
      if (value.length < 2 || value.at(-1) !== value[0]) throw new Error(`CONFIG_INVALID_${key}`);
      value = value.slice(1, -1);
    }
    if (!value || /[\x00-\x1f\x7f]/.test(value) || /\{\{.*\}\}/.test(value)) throw new Error(`CONFIG_INVALID_${key}`);
    values[key!] = value;
  }
  for (const key of BRIDGE_FIELDS) if (!values[key]?.trim()) throw new Error(`CONFIG_MISSING_${key}`);
  let url: URL;
  try { url = new URL(values.GROK_ORCHESTRATOR_WEBHOOK_URL!); } catch { throw new Error('CONFIG_INVALID_GROK_ORCHESTRATOR_WEBHOOK_URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('CONFIG_INVALID_GROK_ORCHESTRATOR_WEBHOOK_URL');
  if (!/^(\+[1-9][0-9]{6,14}|[^\s@]+@[^\s@]+\.[^\s@]+)$/.test(values.AUTHORIZED_SENDER_ID!)) throw new Error('CONFIG_INVALID_AUTHORIZED_SENDER_ID');
  return values;
}

export function loadConfig(options: { paths?: ReturnType<typeof resolveInstancePaths>; config?: Config } = {}): Config {
  if (options.config) return { ...options.config };
  const paths = options.paths ?? resolveInstancePaths();
  let text: string;
  try { text = readFileSync(assertPrivateFile(paths.bridgeEnv, paths.root), 'utf8'); }
  catch { throw new Error('CONFIG_PRIVATE_FILE_UNAVAILABLE'); }
  const values = parseBridgeEnv(text);
  return {
    projectId: values.SPECTRUM_PROJECT_ID!, projectSecret: values.SPECTRUM_PROJECT_SECRET!,
    authorizedSenderId: values.AUTHORIZED_SENDER_ID!, webhookUrl: values.GROK_ORCHESTRATOR_WEBHOOK_URL!,
    webhookKey: values.GROK_ORCHESTRATOR_WEBHOOK_KEY!,
  };
}
