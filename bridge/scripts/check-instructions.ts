import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { activeInstructionFiles, commonRoleRules, generatedRoleFiles, repositoryRoot } from './instruction-catalog.ts';

export function checkInstructions(root = repositoryRoot): string[] {
  const errors: string[] = [];
  const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
  if (read('README.md') !== read('00-README.md')) errors.push('README_MIRROR_DRIFT');
  for (const [path, expected] of Object.entries(generatedRoleFiles())) if (read(path) !== expected) errors.push(`ROLE_TEMPLATE_DRIFT:${path}`);
  const bridgeScripts = JSON.parse(read('bridge/package.json')).scripts;
  const hostScripts = JSON.parse(read('live-mini/live-task-cards/package.json')).scripts;
  const prohibited: [string, RegExp][] = [
    ['OLD_ROLE_VOCABULARY', /MASTER_ORCHESTRATOR_(?:BOT_ID|AGENT_UUID)/],
    ['PERSONAL_ROSTER', /SPECIALIST_(?:HOUSING|HOTELS|CMOS|LOGO|PARTY|CHATTY)|\b(?:CMOS|Chatty)\b/],
    ['FILE_QUEUE', /(?:bun|node)\s+[^\n`]*data\/(?:unread|outbound-queue)|writeFileSync\([^\n]*(?:unread|outbound-queue)/],
    ['MANUAL_CELEBRATION', /markSetupConfettiSent\s*\(|touch\s+[^\n]*confetti/],
    ['UNCLAIMED_SEND', /--authorized\b[^\n]*--space-id|--space-id\b[^\n]*--authorized/],
    ['CHECKOUT_SECRET_WRITE', /(?:cp|cat|printf|echo)\s+[^\n]*(?:>\s*|\s)(?:bridge\/)?\.env(?:\s|$)/],
    ['SPLIT_CARD_LIMIT', /(?:only|exactly)\s+(?:4 or 8|four or eight)|batches of four/i],
    ['DIRECT_TASK_CARD', /await\s+(?:space|spectrum)\.(?:send|edit)\s*\(/],
  ];
  for (const path of new Set(activeInstructionFiles)) {
    if (!existsSync(resolve(root, path))) { errors.push(`MISSING_INSTRUCTION:${path}`); continue; }
    const source = read(path);
    for (const [code, pattern] of prohibited) if (pattern.test(source)) errors.push(`${code}:${path}`);
    for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1]!.replace(/^<|>$/g, '').split('#')[0]!.split(' ')[0]!;
      if (!target || /^(?:https?:|mailto:|#)/.test(target) || target.includes('{{')) continue;
      if (!existsSync(resolve(root, dirname(path), decodeURIComponent(target)))) errors.push(`BROKEN_LINK:${path}:${target}`);
    }
    for (const match of source.matchAll(/\bbun run\s+([A-Za-z0-9_./:-]+)/g)) {
      const command = match[1]!;
      if (command.includes('/')) {
        if (!existsSync(resolve(root, 'bridge', command)) && !existsSync(resolve(root, command))) errors.push(`UNKNOWN_BUN_ENTRY:${path}:${command}`);
      } else if (!Object.hasOwn(bridgeScripts, command)) errors.push(`UNKNOWN_BUN_COMMAND:${path}:${command}`);
    }
    for (const match of source.matchAll(/\bnpm run\s+([A-Za-z0-9_:-]+)/g)) if (!Object.hasOwn(hostScripts, match[1]!)) errors.push(`UNKNOWN_HOST_COMMAND:${path}:${match[1]}`);
  }
  const contract = read('docs/product-repair/OPERATING_CONTRACT.md');
  for (const phrase of ['six core roles', 'Moonshine', 'Front Door is the sole final-response owner', 'Unknown native handoffs stay held', 'one logical attachment_group', 'Any added emoji', 'physical-device']) if (!contract.includes(phrase)) errors.push(`CONTRACT_REQUIREMENT:${phrase}`);
  const order = ['Validate the batch reference', 'Acquire a current processing claim', 'Read the bound batch', 'Resolve the existing task', 'Choose reaction', 'Answer directly or record durable delegation intent', 'Submit an idempotent final result'];
  let last = -1; for (const phrase of order) { const index = contract.indexOf(phrase); if (index <= last) errors.push(`WAKE_ORDER:${phrase}`); last = index; }
  if (!commonRoleRules.startsWith('Front Door is the sole final-response owner.')) errors.push('ROLE_FINAL_OWNER_DRIFT');
  const routine = JSON.parse(read('routines/photon-imessage-wake.REDACTED.json'));
  if (!JSON.stringify(routine).includes('descriptive-template-not-native-tool-payload')) errors.push('ROUTINE_SCHEMA_FABRICATION');
  return errors;
}
if (import.meta.main) {
  const errors = checkInstructions();
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log('INSTRUCTIONS_OK');
}
