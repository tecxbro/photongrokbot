import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import {
  createLiveCardMilestones,
  runBridgeControl,
  withContextLock,
} from "./live-card-milestones.mjs";
import { resolveInstancePaths } from "../../shared/instance-paths.mjs";
import { CardService } from "../live-task-cards/src/service.mjs";
import { FileStore } from "../live-task-cards/src/store.mjs";
import { createHandler } from "../live-task-cards/src/http.mjs";
import { payload, finished } from "../live-task-cards/tests/helpers.mjs";

const exec = promisify(execFile);
const bridgeRoot = fileURLToPath(new URL("../../bridge/", import.meta.url));
const bun = process.env.PHOTON_BUN_BIN || "bun";
const helperUrl = new URL("./live-card-milestones.mjs", import.meta.url).href;
async function bunCode(code, root) {
  const result = await exec(bun, ["--eval", code], {
    cwd: bridgeRoot,
    env: {
      ...process.env,
      PHOTON_TEST_MODE: "1",
      ...(root ? { PHOTON_INSTANCE_DIR: root } : {}),
    },
    maxBuffer: 100000,
  });
  return JSON.parse(result.stdout);
}
async function setup(t) {
  const initial = await bunCode(
    `import {fixture,batch} from './src/tests/storage/fixture.ts';const f=fixture(); const b=batch(f.store); const task={taskId:'task-1',batchId:b.batch.batchId,destination:b.destination,owner:'worker',finalOwner:'orchestrator',state:'accepted',receipt:'native-receipt'};f.store.bindTask(b.claim,{...task,state:'intent',receipt:undefined});f.store.bindTask(b.claim,task);f.store.setMetadata('live-mini-host','configured',{origin:'https://cards.example.test'});console.log(JSON.stringify({root:f.root,claim:b.claim,task}));f.store.close();`,
  );
  const { root, task, claim } = initial;
  const oldRoot = process.env.PHOTON_INSTANCE_DIR,
    oldGuard = process.env.PHOTON_TEST_MODE;
  process.env.PHOTON_INSTANCE_DIR = root;
  process.env.PHOTON_TEST_MODE = "1";
  t.after(() => {
    if (oldRoot === undefined) delete process.env.PHOTON_INSTANCE_DIR;
    else process.env.PHOTON_INSTANCE_DIR = oldRoot;
    if (oldGuard === undefined) delete process.env.PHOTON_TEST_MODE;
    else process.env.PHOTON_TEST_MODE = oldGuard;
  });
  const paths = resolveInstancePaths({
    instanceDir: root,
    testMode: true,
    env: { PHOTON_TEST_MODE: "1" },
  });
  const config = {
    baseUrl: "https://cards.example.test",
    viewSecret: "v".repeat(40),
    publisherToken: "p".repeat(40),
    archiveDays: 30,
    maxArchived: 100,
    demos: false,
    store: "file",
  };
  const store = new FileStore(join(root, "host.json"));
  const service = new CardService(store, config);
  const server = createServer(createHandler(service, config));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    rmSync(root, { recursive: true, force: true });
  });
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const traffic = [],
    commands = [];
  let lose,
    mutate,
    delivery = "accepted";
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    traffic.push({
      path: parsed.pathname,
      body: init.body && JSON.parse(init.body),
      method: init.method,
    });
    const response = await fetch(
      `${endpoint}${parsed.pathname}${parsed.search}`,
      init,
    );
    if (lose && parsed.pathname.endsWith(lose)) {
      lose = undefined;
      throw new Error("fixture lost host response");
    }
    if (mutate && init.method === "PUT") {
      const value = await response.json();
      value.viewUrl = mutate(value.viewUrl);
      mutate = undefined;
      return Response.json(value, { status: response.status });
    }
    return response;
  };
  async function settle() {
    return bunCode(
      `import {getStore} from './src/storage.ts'; const s=getStore(); let c; while(c=s.claimOutbound()){const isApp=c.item.kind==='app';if(isApp)s.setMetadata('test','sends',(s.getMetadata('test','sends')??0)+1);s.settleOutbound(c.item.id,c.attemptId,isApp&&${JSON.stringify(delivery)}==='unknown'?{state:'unknown',code:'fixture-ambiguous'}:{state:'accepted',reference:{messageId:'message-'+c.item.id},evidence:'fixture provider reference'});} console.log(JSON.stringify(s.getMetadata('test','sends')??0));s.close();`,
      root,
    );
  }
  let loseEnqueue = false;
  const control = async (command, body) => {
    commands.push({ command, body });
    const value = await runBridgeControl({
      command,
      body,
      bridgeRoot,
      bun,
      env: { ...process.env, PHOTON_TEST_MODE: "1", PHOTON_INSTANCE_DIR: root },
    });
    if (command === "enqueue") {
      await settle();
      if (loseEnqueue) {
        loseEnqueue = false;
        throw new Error("fixture lost enqueue response");
      }
    }
    return value;
  };
  const options = {
    paths,
    baseUrl: config.baseUrl,
    publisherToken: config.publisherToken,
    taskContext: { taskId: task.taskId, batchId: task.batchId, claim },
    fetchImpl,
    control,
    sendTimeoutMs: 10,
    pollMs: 1,
  };
  const make = (extra) => createLiveCardMilestones({ ...options, ...extra });
  const create = await payload();
  create.taskId = task.taskId;
  create.conversationRef = task.destination.spaceId;
  return {
    root,
    paths,
    task,
    claim,
    store,
    service,
    endpoint,
    config,
    traffic,
    commands,
    options,
    create,
    make,
    settle,
    lose: (suffix) => {
      lose = suffix;
    },
    mutate: (fn) => {
      mutate = fn;
    },
    unknown: () => {
      delivery = "unknown";
    },
    loseEnqueue: () => {
      loseEnqueue = true;
    },
  };
}
const key = "native/task:original";
async function started(f) {
  const helper = f.make();
  const card = await helper.createCard(f.create, key);
  return { helper, ...card };
}

test("H01/H02 explicit stale revisions and changed content never rebase or mint a fresh request", async (t) => {
  const f = await setup(t),
    { helper, record } = await started(f);
  for (let revision = 1; revision <= 4; revision++)
    await helper.updateMilestone(
      record.id,
      {
        requestId: `update-${revision}`,
        expectedRevision: revision,
        content: f.create.content,
      },
      key,
    );
  const body = {
    requestId: "newer",
    expectedRevision: 5,
    content: { ...f.create.content, title: "Newer confirmed work" },
  };
  await helper.updateMilestone(record.id, body, key);
  await assert.rejects(
    helper.updateMilestone(
      record.id,
      {
        ...body,
        content: { ...body.content, title: "Different reused request" },
      },
      key,
    ),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  await assert.rejects(
    helper.updateMilestone(
      record.id,
      { requestId: "stale", expectedRevision: 4, content: f.create.content },
      key,
    ),
    { code: "REVISION_CONFLICT" },
  );
  assert.equal(
    (await f.service.get(record.id)).content.title,
    "Newer confirmed work",
  );
  assert.equal(
    f.traffic.filter((call) => call.body?.requestId === "stale").length,
    1,
  );
  assert.equal(
    f.traffic.some((call) => call.body?.requestId?.includes("reconcile")),
    false,
  );
  await helper.updateMilestone(
    record.id,
    {
      requestId: "reviewed-current-content",
      expectedRevision: 6,
      content: { ...body.content, title: "Explicitly reviewed snapshot" },
    },
    key,
  );
  assert.equal(
    (await f.service.get(record.id)).content.title,
    "Explicitly reviewed snapshot",
  );
  await assert.rejects(
    helper.updateMilestone(
      record.id,
      { requestId: "missing-revision", content: f.create.content },
      key,
    ),
  );
});
for (const change of ["token", "path"])
  test(`H03 ${change} changes preserve previous context byte-for-byte without secret errors`, async (t) => {
    const f = await setup(t),
      { helper, record } = await started(f);
    const file = readdirSync(f.paths.liveMiniContextDir).find((name) =>
      /^[a-f0-9]{64}\.json$/.test(name),
    );
    const before = readFileSync(join(f.paths.liveMiniContextDir, file), "utf8");
    f.mutate((url) =>
      change === "token"
        ? `${url}changed-secret`
        : url.replace("/live-1/", "/live-2/"),
    );
    await assert.rejects(
      helper.updateMilestone(
        record.id,
        { requestId: "change", expectedRevision: 1, content: f.create.content },
        key,
      ),
      (error) =>
        error.code === "URL_CHANGED" &&
        !error.message.includes("https") &&
        !error.message.includes("changed-secret"),
    );
    assert.equal(
      readFileSync(join(f.paths.liveMiniContextDir, file), "utf8"),
      before,
    );
  });
test("H04 missing context, wrong full URL and original space reject before enqueue", async (t) => {
  const f = await setup(t),
    { helper, record } = await started(f);
  for (const args of [
    [f.task.destination.spaceId, record.viewUrl],
    ["other-space", record.viewUrl, key],
    [f.task.destination.spaceId, `${record.viewUrl}other`, key],
    [f.task.destination.spaceId, record.viewUrl, "absent"],
  ])
    await assert.rejects(helper.sendOnce(...args));
  assert.equal(f.commands.filter((c) => c.command === "enqueue").length, 0);
  assert.throws(() => f.make({ liveCards: {} }), {
    code: "CANONICAL_BRIDGE_REQUIRED",
  });
  assert.throws(() => f.make({ taskContext: undefined }), {
    code: "CONTEXT_REQUIRED",
  });
});
for (const boundary of ["create", "claim", "enqueue", "settle"])
  test(`H05 lost ${boundary} acknowledgement recovers same card, claim and physical send`, async (t) => {
    const f = await setup(t);
    let helper = f.make(),
      record;
    if (boundary === "create") {
      f.lose("/api/cards");
      await assert.rejects(helper.createCard(f.create, key), {
        code: "HOST_UNAVAILABLE",
      });
      const intent = await helper.loadContext(key);
      assert.equal(intent.creation.requestId, f.create.requestId);
      assert.equal(intent.phase, "create_intent");
    }
    ({ record } = await helper.createCard(f.create, key));
    if (boundary === "claim") f.lose("/presentation/begin");
    if (boundary === "settle") f.lose("/presentation/settle");
    if (boundary === "enqueue") f.loseEnqueue();
    if (boundary !== "create")
      await assert.rejects(
        helper.sendOnce(f.task.destination.spaceId, record.viewUrl, key),
      );
    helper = f.make();
    const result = await helper.sendOnce(
      f.task.destination.spaceId,
      record.viewUrl,
      key,
    );
    const repeated = await helper.sendOnce(
      f.task.destination.spaceId,
      record.viewUrl,
      key,
    );
    assert.equal(repeated.outboundId, result.outboundId);
    assert.equal(await f.settle(), 1);
    assert.equal(Object.keys((await f.store.read()).cards).length, 1);
    const submissions = f.commands.filter((c) => c.command === "enqueue");
    assert.equal(submissions.length, 1);
    assert.equal(
      submissions[0].body.presentation.claimId,
      result.context.attemptId,
    );
  });
test("H06 unknown retains occupancy and never creates another outbox action", async (t) => {
  const f = await setup(t),
    { helper, record } = await started(f);
  f.unknown();
  await assert.rejects(
    helper.sendOnce(f.task.destination.spaceId, record.viewUrl, key),
    { code: "PRESENTATION_UNKNOWN" },
  );
  await assert.rejects(
    f.make().sendOnce(f.task.destination.spaceId, record.viewUrl, key),
    { code: "PRESENTATION_UNKNOWN" },
  );
  assert.equal((await f.service.get(record.id)).activeAttempt.state, "unknown");
  assert.equal((await f.service.slots())[0].occupied, true);
  await assert.rejects(helper.completeAndRelease(record.id, key), {
    code: "INITIAL_SEND_NOT_RECONCILED",
  });
  assert.equal(f.commands.filter((c) => c.command === "enqueue").length, 1);
  assert.equal(await f.settle(), 1);
});
test("H07 progress stays at same URL and terminal release needs no edit or resend", async (t) => {
  const f = await setup(t),
    { helper, record } = await started(f);
  await helper.sendOnce(f.task.destination.spaceId, record.viewUrl, key);
  const updated = await helper.updateMilestone(
    record.id,
    {
      requestId: "done",
      expectedRevision: 1,
      content: finished(f.create.content),
    },
    key,
  );
  assert.equal(updated.record.viewUrl, record.viewUrl);
  const released = await helper.completeAndRelease(record.id, key);
  assert.ok(released.record.archivedAt);
  assert.equal((await f.service.slots())[0].occupied, false);
  assert.equal(await f.settle(), 1);
  assert.equal(f.commands.filter((c) => c.command === "enqueue").length, 1);
});
test("H08 bounded Node child controls ignore raw legacy queue and redact rejected output", async (t) => {
  const f = await setup(t);
  writeFileSync(
    join(f.paths.dataDir, "outbound-queue.json"),
    "not json and must never be read",
  );
  const { helper, record } = await started(f);
  await helper.sendOnce(f.task.destination.spaceId, record.viewUrl, key);
  await assert.rejects(
    runBridgeControl({
      command: "register",
      body: { private: "x".repeat(65536) },
      bridgeRoot,
      bun,
    }),
    { code: "BRIDGE_INPUT_TOO_LARGE" },
  );
  const script = join(f.root, "noisy-child");
  writeFileSync(script, "#!/bin/sh\nhead -c 100000 /dev/zero\n", {
    mode: 0o700,
  });
  await assert.rejects(
    runBridgeControl({
      command: "register",
      body: {},
      bridgeRoot,
      bun: script,
    }),
    { code: "BRIDGE_RESPONSE_TOO_LARGE" },
  );
  assert.equal(await f.settle(), 1);
});
test("hashed identity avoids lossy task-key collision; initialized context and secrets stay private", async (t) => {
  const f = await setup(t),
    helper = f.make();
  await helper.createCard(f.create, "a/b");
  await helper.createCard(f.create, "a_b");
  const names = readdirSync(f.paths.liveMiniContextDir).filter((name) =>
    /^[a-f0-9]{64}\.json$/.test(name),
  );
  assert.equal(names.length, 2);
  assert.notEqual(names[0], names[1]);
  assert.throws(() => f.make({ stateDir: "/tmp/legacy" }), {
    code: "CANONICAL_PATHS_REQUIRED",
  });
  assert.throws(
    () => f.make({ paths: { root: `${f.root}-other` } }),
    /INSTANCE_ROOT_CONFLICT/,
  );
});
test("two real Node owners serialize and SIGKILL releases the per-task lock without stealing", async (t) => {
  const f = await setup(t),
    path = join(f.paths.liveMiniContextDir, "race.lock");
  const script = `import {withContextLock} from ${JSON.stringify(helperUrl)};await withContextLock(process.argv[1],async()=>{console.log('READY');await new Promise(()=>{});});`;
  const first = spawn(
    process.execPath,
    ["--input-type=module", "--eval", script, path],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  t.after(() => first.kill("SIGKILL"));
  await new Promise((done, reject) => {
    first.stdout.once("data", done);
    first.once("error", reject);
  });
  await assert.rejects(
    exec(process.execPath, [
      "--input-type=module",
      "--eval",
      `import {withContextLock} from ${JSON.stringify(helperUrl)};await withContextLock(process.argv[1],async()=>{});`,
      path,
    ]),
  );
  const closed = new Promise((done) => first.once("close", done));
  first.kill("SIGKILL");
  await closed;
  // EOF propagates to the lock holder; bounded retry only waits for actual kernel release.
  let acquired = false;
  for (let attempt = 0; attempt < 10 && !acquired; attempt++) {
    try {
      await withContextLock(path, async () => {
        acquired = true;
      });
    } catch (error) {
      if (error.code !== "CONTEXT_BUSY") throw error;
      await new Promise((done) => setTimeout(done, 10));
    }
  }
  assert.equal(acquired, true);
});

test("expired workers cannot author host content but may reconcile a previously accepted send", async (t) => {
  const f = await setup(t),
    { helper, record } = await started(f);
  f.lose("/presentation/settle");
  await assert.rejects(
    helper.sendOnce(f.task.destination.spaceId, record.viewUrl, key),
  );
  await bunCode(
    `import {getStore} from './src/storage.ts';const s=getStore();s.db.query("UPDATE batches SET lease_until=0").run();console.log('{}');s.close();`,
    f.root,
  );
  await helper.sendOnce(f.task.destination.spaceId, record.viewUrl, key);
  const before = f.traffic.filter((call) => call.method === "PUT").length;
  await assert.rejects(
    helper.updateMilestone(
      record.id,
      {
        requestId: "abandoned-worker",
        expectedRevision: 1,
        content: finished(f.create.content),
      },
      key,
    ),
  );
  assert.equal(
    f.traffic.filter((call) => call.method === "PUT").length,
    before,
  );
  assert.equal(await f.settle(), 1);
});
for (const boundary of ["create", "claim", "enqueue", "settle"])
  test(`H05 real Node SIGKILL after ${boundary} commit recovers original identities`, async (t) => {
    const f = await setup(t);
    const childOptions = {
      root: f.root,
      endpoint: f.endpoint,
      baseUrl: f.config.baseUrl,
      publisherToken: f.config.publisherToken,
      taskContext: f.options.taskContext,
      payload: f.create,
      key,
      boundary,
      bun,
      bridgeRoot,
    };
    const code = `
    import {createLiveCardMilestones,runBridgeControl} from ${JSON.stringify(helperUrl)};
    import {resolveInstancePaths} from ${JSON.stringify(new URL("../../shared/instance-paths.mjs", import.meta.url).href)};
    import {execFile} from 'node:child_process';import {promisify} from 'node:util';const exec=promisify(execFile);
    const opts=JSON.parse(process.argv[1]);const paths=resolveInstancePaths({instanceDir:opts.root,testMode:true,env:{PHOTON_TEST_MODE:'1'}});
    const barrier=async()=>{console.log('COMMITTED');await new Promise(()=>{});};
    const fetchImpl=async(url,init)=>{const p=new URL(url);const response=await fetch(opts.endpoint+p.pathname+p.search,init);const suffix={create:'/api/cards',claim:'/presentation/begin',settle:'/presentation/settle'}[opts.boundary];if(suffix&&p.pathname.endsWith(suffix)&&init.method==='POST')await barrier();return response;};
    const control=async(command,body)=>{const value=await runBridgeControl({command,body,bridgeRoot:opts.bridgeRoot,bun:opts.bun,env:{...process.env,PHOTON_TEST_MODE:'1',PHOTON_INSTANCE_DIR:opts.root}});if(command==='enqueue'){
      if(opts.boundary==='enqueue')await barrier();
      await exec(opts.bun,['--eval',${JSON.stringify(`import {getStore} from './src/storage.ts';const s=getStore();let c;while(c=s.claimOutbound()){if(c.item.kind==='app')s.setMetadata('test','sends',(s.getMetadata('test','sends')??0)+1);s.settleOutbound(c.item.id,c.attemptId,{state:'accepted',reference:{messageId:'message-'+c.item.id},evidence:'fixture exact provider reference'});}s.close();`)}],{cwd:opts.bridgeRoot,env:{...process.env,PHOTON_TEST_MODE:'1',PHOTON_INSTANCE_DIR:opts.root}});
    }return value;};
    const helper=createLiveCardMilestones({paths,baseUrl:opts.baseUrl,publisherToken:opts.publisherToken,taskContext:opts.taskContext,fetchImpl,control,pollMs:1});
    const created=await helper.createCard(opts.payload,opts.key);await helper.sendOnce(opts.payload.conversationRef,created.record.viewUrl,opts.key);
  `;
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", code, JSON.stringify(childOptions)],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    t.after(() => child.kill("SIGKILL"));
    await new Promise((done, reject) => {
      child.stdout.once("data", (chunk) =>
        chunk.toString().includes("COMMITTED")
          ? done()
          : reject(new Error("unexpected child output")),
      );
      child.once("error", reject);
      child.once("exit", (code) =>
        reject(new Error(`child exited before barrier ${code}`)),
      );
    });
    const names = readdirSync(f.paths.liveMiniContextDir).filter((name) =>
      /^[a-f0-9]{64}\.json$/.test(name),
    );
    const original = JSON.parse(
      readFileSync(join(f.paths.liveMiniContextDir, names[0]), "utf8"),
    );
    await assert.rejects(f.make().createCard(f.create, key), {
      code: "CONTEXT_BUSY",
    });
    const closed = new Promise((done) => child.once("close", done));
    child.kill("SIGKILL");
    await closed;
    await f.settle();
    const helper = f.make();
    let created;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        created = await helper.createCard(f.create, key);
        break;
      } catch (error) {
        if (error.code !== "CONTEXT_BUSY") throw error;
        await new Promise((done) => setTimeout(done, 10));
      }
    }
    assert.ok(created);
    const result = await helper.sendOnce(
      f.task.destination.spaceId,
      created.record.viewUrl,
      key,
    );
    assert.equal(
      result.context.creation.requestId,
      original.creation.requestId,
    );
    assert.equal(result.context.actionKey, original.actionKey);
    if (original.attemptId)
      assert.equal(result.context.attemptId, original.attemptId);
    assert.equal(await f.settle(), 1);
    assert.equal(Object.keys((await f.store.read()).cards).length, 1);
  });

test("lock holder death fences the live helper before any subsequent local write", async (t) => {
  const f = await setup(t),
    path = join(f.paths.liveMiniContextDir, "death.lock");
  await assert.rejects(
    withContextLock(path, async (check, pid) => {
      process.kill(pid, "SIGKILL");
      await new Promise((done) => setTimeout(done, 30));
      check();
      assert.fail("a dead lock holder must not authorize writes");
    }),
    { code: "CONTEXT_LOCK_LOST" },
  );
});
