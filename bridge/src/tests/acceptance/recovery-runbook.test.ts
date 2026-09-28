import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fixture, batch } from '../storage/fixture.ts';
import { atomicPrivateWrite } from '../../../../shared/instance-paths.mjs';

if (process.env.PHOTON_TEST_MODE !== '1' || !process.env.PHOTON_INSTANCE_DIR) throw new Error('SYNTHETIC_RUNBOOK_TEST_REQUIRED');
const bridge = resolve(import.meta.dir, '../../..'), repository = resolve(bridge, '..');

test('T01 protected maintenance examples invoke source entrypoints without losing the lock descriptor', () => {
  for (const file of ['MIGRATION.md', 'PRIVACY.md', 'DEPLOYMENT_ROLLBACK.md']) {
    const commands = readFileSync(join(repository, 'docs/product-repair', file), 'utf8').split('\n').filter(line => line.startsWith('python3 tools/with-instance-lock.py'));
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      const entry = command.match(/ bun run (src\/[a-z-]+\.ts)(?: |$)/)?.[1];
      expect(entry).toBeDefined(); expect(existsSync(join(bridge, entry!))).toBe(true);
    }
  }
});

test('T01/P08 runbook CLI reconciles original unknown operations and exports an independently readable snapshot', () => {
  const f = fixture();
  function run(entry: string, args: string[] = [], input?: unknown, locked = false, expected = 0): any {
    const command = [process.execPath, 'run', entry, ...args];
    const executable = locked ? 'python3' : process.execPath;
    const actual = locked ? ['tools/with-instance-lock.py', join(f.root, 'runtime.lock'), ...command] : command.slice(1);
    const result = spawnSync(executable, actual, { cwd: bridge, env: { ...process.env, PHOTON_TEST_MODE: '1', PHOTON_INSTANCE_DIR: f.root }, input: input === undefined ? undefined : JSON.stringify(input), encoding: 'utf8', timeout: 10000, maxBuffer: 128 * 1024 });
    expect(result.status).toBe(expected);
    expect(result.stdout + result.stderr).not.toContain('synthetic-secret-never-export');
    return result.status === 0 ? JSON.parse(result.stdout) : null;
  }
  try {
    atomicPrivateWrite(join(f.paths.secretsDir, 'bridge.env'), 'TEST_SECRET=synthetic-secret-never-export\n');
    const ids: string[] = [];
    for (const [index, spaceId] of ['accepted-chat', 'cancelled-chat'].entries()) {
      const ctx = batch(f.store, spaceId);
      const item = f.store.enqueue({ spaceId, text: 'Synthetic recovery fixture' }, { ...ctx, purpose: 'final', actionKey: `recovery-${index}` })[0]!;
      const claimed = f.store.claimOutbound()!;
      expect(claimed.item.id).toBe(item.id);
      f.store.settleOutbound(item.id, claimed.attemptId, { state: 'unknown', code: 'SYNTHETIC_RESPONSE_LOST' }); ids.push(item.id);
    }
    const accepted = { id: ids[0], state: 'accepted', evidence: 'Synthetic exact provider receipt checked', reference: { messageId: 'synthetic-provider-reference' } };
    run('src/outbound-status.ts', ['--resolve-json-stdin'], accepted, false, 1);
    run('src/outbound-status.ts', ['--resolve-json-stdin'], { ...accepted, reference: undefined }, true, 1);
    expect(run('src/outbound-status.ts', ['--resolve-json-stdin'], accepted, true).state).toBe('accepted');
    expect(run('src/outbound-status.ts', ['--resolve-json-stdin'], { id: ids[1], state: 'cancelled', evidence: 'Synthetic explicit abandonment of original operation' }, true).state).toBe('cancelled');
    for (const id of ids) expect(run('outbound-status', ['--', '--id', id]).attempts).toBe(1);
    expect(f.store.claimOutbound()).toBeUndefined();
    const preview = run('export-instance');
    expect(preview).toMatchObject({ includesCredentials: false, applied: false });
    run('src/export-instance.ts', ['--apply', '--plan-id', preview.planId], undefined, false, 1);
    const exported = run('src/export-instance.ts', ['--apply', '--plan-id', preview.planId], undefined, true);
    expect(exported).toMatchObject({ applied: true, includesCredentials: false });
    const backup = join(f.paths.backupsDir, `export-${exported.exportId}`);
    expect(existsSync(join(backup, 'bridge.sqlite'))).toBe(true);
    expect(existsSync(join(backup, 'secrets'))).toBe(false);
    const db = new Database(join(backup, 'bridge.sqlite'), { readonly: true });
    try {
      expect(db.query('PRAGMA quick_check').get()).toEqual({ quick_check: 'ok' });
      expect(db.query('SELECT state FROM outbound ORDER BY seq').all()).toEqual([{ state: 'accepted' }, { state: 'cancelled' }]);
    } finally { db.close(); }
    const prune = run('prune-instance');
    expect(prune).toMatchObject({ applied: false, events: 0, outbound: 0 });
    const pruneArgs = ['--apply', '--plan-id', prune.planId, '--now', String(prune.now)];
    run('src/prune-instance.ts', pruneArgs, undefined, false, 1);
    expect(run('src/prune-instance.ts', pruneArgs, undefined, true)).toMatchObject({ applied: true, events: 0, outbound: 0 });
    expect(f.store.listOutbound().map(item => item.id)).toEqual(ids);
  } finally { f.cleanup(); }
});
