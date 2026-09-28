import { afterEach, expect, test } from 'bun:test';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { checkInstructions } from '../scripts/check-instructions.ts';
import { activeInstructionFiles, repositoryRoot } from '../scripts/instruction-catalog.ts';
import { refreshManifests } from '../scripts/refresh-manifests.ts';
import { resolveInstancePaths, atomicPrivateWrite } from '../../shared/instance-paths.mjs';
import { openStore } from './storage.ts';
const roots: string[] = [];
function temporary(label: string) { const root = mkdtempSync(join(realpathSync(tmpdir()), label)); roots.push(root); return root; }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true }); });
function fakeCLI() {
  const root = temporary('photon-instruction-instance-');
  const env = { ...process.env, PHOTON_TEST_MODE: '1', PHOTON_INSTANCE_DIR: root };
  function run(script: string, args: string[] = [], input?: unknown, expected = 0): any {
    const result = spawnSync(process.execPath, ['run', script, '--', ...args], { cwd: resolve(repositoryRoot, 'bridge'), env, input: input === undefined ? undefined : JSON.stringify(input), encoding: 'utf8', timeout: 10000, maxBuffer: 128 * 1024 });
    expect(result.status).toBe(expected);
    if (expected !== 0) { expect(result.stdout).toBe(''); return result.stderr; }
    return JSON.parse(result.stdout);
  }
  run('setup-state', ['init', '--authorized']); run('setup-state', ['initialize-storage']);
  const paths = resolveInstancePaths({ instanceDir: root, env, testMode: true });
  return { root, paths, run };
}
test('T01-T04 every existing operating target has valid links, commands and generated roles', () => { expect(checkInstructions()).toEqual([]); expect(new Set(activeInstructionFiles).size).toBeGreaterThan(65); });
test('T01-T04 checker detects drift and active obsolete vocabulary instead of appending a competing contract', () => {
  const root = temporary('photon-instruction-checker-');
  for (const path of [...activeInstructionFiles, 'bridge/package.json', 'live-mini/live-task-cards/package.json']) { const target = resolve(root, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, readFileSync(resolve(repositoryRoot, path))); }
  writeFileSync(resolve(root, 'README.md'), readFileSync(resolve(root, 'README.md'), 'utf8') + '\nMASTER_ORCHESTRATOR_BOT_ID\nbun run imaginary-command\n');
  writeFileSync(resolve(root, 'agents/creator/PROFILE_TEMPLATE.md'), 'Drifted role.');
  const errors = checkInstructions(root); expect(errors).toContain('README_MIRROR_DRIFT'); expect(errors).toContain('OLD_ROLE_VOCABULARY:README.md'); expect(errors).toContain('UNKNOWN_BUN_COMMAND:README.md:imaginary-command'); expect(errors).toContain('ROLE_TEMPLATE_DRIFT:agents/creator/PROFILE_TEMPLATE.md');
});
test('T05 documented setup CLI preserves actual verified identities and requires real Moonshine verification', () => {
  const f = fakeCLI(); const roles = ['front-door','orchestrator','creator','feature-add','image-cards','app-sheet'];
  expect(f.run('setup-state', ['registry'])).toEqual({ roles: {} });
  for (const resource of roles) {
    const intent = f.run('setup-state', ['intent','--json-stdin'], { resource });
    f.run('setup-state', ['receipt','--json-stdin'], { resource, operationId: intent.operationId, resourceId: `synthetic-${resource}`, verified: true });
    expect(f.run('setup-state', ['intent','--json-stdin'], { resource }).resourceId).toBe(`synthetic-${resource}`);
  }
  const registry = f.run('setup-state', ['registry']); expect(registry).toEqual({ roles: Object.fromEntries(roles.map(role => [role, `synthetic-${role}`])) }); expect(JSON.stringify(registry)).not.toContain('{{');
  expect(f.run('setup-state', ['status']).fullSetupComplete).toBe(false);
  expect(f.run('setup-state', ['verify-moonshine'], undefined, 1)).toContain('MOONSHINE_VERIFICATION_FAILED');
  expect(f.run('setup-state', ['receipt','--json-stdin'], {resource:'moonshine',operationId:'invented',resourceId:'invented',verified:true}, 1)).toContain('USE_VERIFY_MOONSHINE');
  f.run('prune-instance', ['--inspect']); f.run('export-instance');
});
test('T05 documented claim/read/JSON submission and five-card producer execute against the canonical store', () => {
  const f = fakeCLI(), store = openStore({ paths: f.paths });
  let batchId: string;
  try { store.accept({ eventKey:'instruction-fixture', destination:{spaceId:'synthetic-space',lineId:'shared'}, record:{id:'synthetic-message',spaceId:'synthetic-space',senderId:'synthetic-owner',text:'Give me five options',timestamp:new Date().toISOString(),receivedAt:new Date().toISOString()} }); batchId = store.formBatches()[0]!.batchId; } finally { store.close(); }
  const claim = f.run('batch',['claim','--batch-id',batchId!]).token;
  const batch = f.run('read-batch',[batchId!]); expect(batch.destination).toEqual({spaceId:'synthetic-space',lineId:'shared'});
  f.run('batch',['renew','--batch-id',batchId!,'--run-id',claim.runId,'--generation',String(claim.generation)]);
  const marker = JSON.parse(readFileSync(resolve(repositoryRoot,'docs/product-repair/examples/cards-ready.json'),'utf8'));
  Object.assign(marker.submission,{batchId,claim,actionKey:`cards:${batchId!}:v1`}); Object.assign(marker.submission.payload,{batchId,spaceId:batch.destination.spaceId});
  marker.submission.payload.attachmentPaths = Array.from({length:5},(_,index)=>{const path=join(f.paths.outboundAssetsDir,`option-${index}.jpg`); atomicPrivateWrite(path,new Uint8Array([255,216,255,217]));return path;});
  expect(f.run('enqueue',['--cards-ready','--json-stdin'],marker)).toEqual({state:'pending',expectedCount:5});
  expect(f.run('enqueue',['--cards-ready','--json-stdin'],marker)).toEqual({state:'pending',expectedCount:5});
  const submission = JSON.parse(readFileSync(resolve(repositoryRoot,'docs/product-repair/examples/final-submission.json'),'utf8'));
  Object.assign(submission,{batchId,claim}); submission.payload.spaceId = batch.destination.spaceId;
  const result = f.run('enqueue',['--json-stdin'],submission); expect(result.count).toBe(1);
  expect(f.run('enqueue',['--json-stdin'],submission)).toEqual(result);
  expect(f.run('outbound-status',['--id',result.items[0].id]).state).toBe('queued');
  submission.payload.spaceId='foreign-space'; expect(f.run('enqueue',['--json-stdin'],submission,1)).toContain('OUTBOUND_SUBMISSION_REJECTED');
  f.run('batch',['complete','--batch-id',batchId!,'--run-id',claim.runId,'--generation',String(claim.generation)]);
});
test('T01 deterministic source and host digests detect changed source and reject private files', () => {
  const root = temporary('photon-manifest-fixture-'); execFileSync('git',['init','-q',root]); mkdirSync(join(root,'live-mini/live-task-cards'),{recursive:true});
  writeFileSync(join(root,'README.md'),'Public fixture\n'); writeFileSync(join(root,'live-mini/live-task-cards/server.mjs'),'export {};\n');
  refreshManifests(false,root); expect(refreshManifests(true,root).checked).toBe(true);
  writeFileSync(join(root,'README.md'),'Changed public fixture\n'); expect(()=>refreshManifests(true,root)).toThrow('MANIFEST_DRIFT');
  refreshManifests(false,root); refreshManifests(true,root); writeFileSync(join(root,'.env'),'SYNTHETIC=redacted'); expect(()=>refreshManifests(false,root)).toThrow('MANIFEST_PRIVATE_PATH_REJECTED');
});
