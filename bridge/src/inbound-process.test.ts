import { afterEach, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './tests/storage/fixture.ts';
import { InboundController } from './inbound-controller.ts';
const cleanup: (() => void)[] = [];
afterEach(() => { for (const fn of cleanup.splice(0)) fn(); });
function setup() { const f = fixture(); cleanup.push(f.cleanup); return f; }
const owner = '+15555550199', space = { id: 'space-1', phone: 'shared' };
const incoming = { id: 'durable-message', direction: 'inbound', platform: 'imessage', sender: { id: owner }, timestamp: new Date(1700000000000), content: { type: 'text', text: 'synthetic substantive request' }, space };
const modules = { paths: new URL('../../shared/instance-paths.mjs', import.meta.url).pathname, storage: new URL('./storage.ts', import.meta.url).pathname, receiver: new URL('./inbound-controller.ts', import.meta.url).pathname, wake: new URL('./wake-dispatcher.ts', import.meta.url).pathname };
function child(root: string, script: string) { return Bun.spawn([process.execPath, '--eval', script], { env: { ...process.env, PHOTON_TEST_MODE: '1', PHOTON_INSTANCE_DIR: root }, stdout: 'pipe', stderr: 'pipe' }); }
async function output(process: ReturnType<typeof child>) { const [exit, out, err] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]); return { exit, out, err }; }
for (const phase of ['before_commit', 'after_commit']) {
  test(`D02 receiver SIGKILL ${phase} preserves exactly one accepted input and onboarding action on replay`, async () => {
    const { paths, store } = setup();
    const script = `import{resolveInstancePaths}from ${JSON.stringify(modules.paths)};import{openStore}from ${JSON.stringify(modules.storage)};import{InboundController}from ${JSON.stringify(modules.receiver)};const store=openStore({paths:resolveInstancePaths(),testMode:true,fault:transition=>{if(transition===${JSON.stringify(`accept:${phase}`)})process.kill(process.pid,'SIGKILL')}});const receiver=new InboundController({store,authorizedSenderId:${JSON.stringify(owner)}});const message=${JSON.stringify(incoming)};message.timestamp=new Date(message.timestamp);receiver.receive(${JSON.stringify(space)},message);`;
    const killed = await output(child(paths.root, script)); expect(killed.err).toBe(''); expect(killed.exit).not.toBe(0); expect(store.recentInbound()).toHaveLength(phase === 'after_commit' ? 1 : 0);
    const receiver = new InboundController({ store, authorizedSenderId: owner }), result = receiver.receive(space, incoming);
    expect(result.status === 'accepted' && result.result.duplicate).toBe(phase === 'after_commit'); expect(store.recentInbound()).toHaveLength(1); expect(store.listOutbound()).toHaveLength(1); expect(receiver.flushAll()).toHaveLength(1);
  });
  test(`D03 controller SIGKILL ${phase} batch formation preserves one input membership and wake`, async () => {
    const { paths, store } = setup(); new InboundController({ store, authorizedSenderId: owner }).receive(space, incoming);
    const script = `import{resolveInstancePaths}from ${JSON.stringify(modules.paths)};import{openStore}from ${JSON.stringify(modules.storage)};import{InboundController}from ${JSON.stringify(modules.receiver)};const store=openStore({paths:resolveInstancePaths(),testMode:true,fault:transition=>{if(transition===${JSON.stringify(`form_batches:${phase}`)})process.kill(process.pid,'SIGKILL')}});new InboundController({store,authorizedSenderId:${JSON.stringify(owner)}}).flushAll();`;
    const killed = await output(child(paths.root, script)); expect(killed.err).toBe(''); expect(killed.exit).not.toBe(0); new InboundController({ store, authorizedSenderId: owner }).flushAll();
    expect(store.db.query('SELECT count(*) n FROM batches').get()).toEqual({ n: 1 }); expect(store.db.query('SELECT count(*) n FROM batch_events').get()).toEqual({ n: 1 }); expect(store.claimWake()).toBeDefined();
  });
}
async function waitFor(paths: string[]) { const started = Date.now(); while (!paths.every(existsSync)) { if (Date.now() - started > 5000) throw new Error('TEST_BARRIER_TIMEOUT'); await Bun.sleep(3); } }
test('W03 separate wake processes behind deterministic barrier make one request for the same job', async () => {
  const { paths, store } = setup(); new InboundController({ store, authorizedSenderId: owner }).receive(space, incoming); store.formBatches();
  const go = join(paths.root, 'wake-go'), release = join(paths.root, 'wake-release'), calls = join(paths.root, 'wake-calls');
  const ready = [0, 1, 2].map(index => join(paths.root, `wake-ready-${index}`));
  const processes = ready.map(signal => child(paths.root, `import{existsSync,writeFileSync,appendFileSync}from'node:fs';import{resolveInstancePaths}from ${JSON.stringify(modules.paths)};import{openStore}from ${JSON.stringify(modules.storage)};import{createWakeDispatcher}from ${JSON.stringify(modules.wake)};const store=openStore({paths:resolveInstancePaths()});writeFileSync(${JSON.stringify(signal)},'ready',{mode:384});while(!existsSync(${JSON.stringify(go)}))await Bun.sleep(2);const dispatcher=createWakeDispatcher({store,url:'https://example.invalid/wake',key:'synthetic-key',fetch:async()=>{appendFileSync(${JSON.stringify(calls)},'request\\n',{mode:384});while(!existsSync(${JSON.stringify(release)}))await Bun.sleep(2);return new Response(null,{status:202})}});await dispatcher.drain();store.close();`));
  await waitFor(ready); writeFileSync(go, 'go', { mode: 0o600 }); await waitFor([calls]); expect(readFileSync(calls, 'utf8').trim().split('\n')).toHaveLength(1); writeFileSync(release, 'release', { mode: 0o600 });
  for (const result of await Promise.all(processes.map(output))) { expect(result.exit).toBe(0); expect(result.err).toBe(''); }
  expect(readFileSync(calls, 'utf8').trim().split('\n')).toHaveLength(1);
});
