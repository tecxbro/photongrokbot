import { afterEach, expect, test } from "bun:test";
import type { Message, Space, Spectrum } from "spectrum-ts";
import { GpProofRuntime } from "./runtime.ts";
import { CORE_ROLES, type SetupState } from "./setup-state.ts";
import { fixture, batch } from "./tests/storage/fixture.ts";
import type { Config } from "./types.ts";

if (process.env.PHOTON_TEST_MODE !== "1") throw new Error("TEST_GUARD_REQUIRED");
const fixtures: ReturnType<typeof fixture>[] = [];
const runtimes: GpProofRuntime[] = [];
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(runtime => runtime.stop()));
  fixtures.splice(0).forEach(f => f.cleanup());
});
const config: Config = {
  projectId: "synthetic-project", projectSecret: "synthetic-secret",
  authorizedSenderId: "owner@example.test", webhookUrl: "https://wake.example.test", webhookKey: "synthetic-key",
};

class Events {
  private pending: Array<[Space, Message]> = [];
  private wake?: () => void;
  private done = false;
  push(space: Space, message: Message): void { this.pending.push([space, message]); this.wake?.(); }
  stop(): void { this.done = true; this.wake?.(); }
  async *[Symbol.asyncIterator](): AsyncGenerator<[Space, Message]> {
    while (!this.done) {
      if (this.pending.length) yield this.pending.shift()!;
      else await new Promise<void>(resolve => { this.wake = resolve; });
    }
  }
}
async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("TEST_CONDITION_TIMEOUT");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
function setup(ready = true) {
  const f = fixture(); fixtures.push(f);
  if (ready) {
    const resources: SetupState["resources"] = {};
    for (const key of ["spectrum-project", ...CORE_ROLES, "owner-binding", "wake-routine", "bridge-config", "moonshine"] as const) {
      resources[key] = { operationId: `synthetic-${key}`, resourceId: `test-${key}`, status: "verified" };
    }
    f.store.setMetadata("setup", "checkpoint", { version: 1, authorizedAt: 1, fullEverReady: true, resources });
  }
  const events = new Events();
  let connected = 0, stopped = 0, lockChecks = 0, sent = 0, readAfterCommit = false;
  const space = {
    id: "test-space", phone: "test-line", type: "dm", platform: "imessage",
    send: async () => ({ id: `provider-${++sent}` }),
    getMessage: async () => undefined,
    startTyping: async () => {}, stopTyping: async () => {},
  } as unknown as Space;
  const app = { messages: events, stop: async () => { stopped++; events.stop(); } } as unknown as Awaited<ReturnType<typeof Spectrum>>;
  const runtime = new GpProofRuntime(config, {
    paths: f.paths, store: f.store,
    assertLock: () => { lockChecks++; },
    connect: async () => { connected++; return app; },
    resolveSpace: async destination => {
      expect(destination).toEqual({ spaceId: "test-space", lineId: "test-line" });
      return space;
    },
    fetch: async () => new Response(null, { status: 200 }),
  });
  runtimes.push(runtime);
  const message = (id: string, content: unknown, sender = config.authorizedSenderId) => ({
    id, platform: "imessage", direction: "inbound", sender: { id: sender }, space,
    timestamp: new Date(), content,
    read: async () => { readAfterCommit = f.store.recentInbound().some(row => row.id === id); },
  }) as unknown as Message;
  return { ...f, runtime, events, space, message,
    counts: () => ({ connected, stopped, lockChecks, sent, readAfterCommit }) };
}

test("S05 W04 runtime opens one connection only after lock and full setup", async () => {
  const missing = setup(false);
  await expect(missing.runtime.start()).rejects.toThrow("SETUP_CORE_AND_MOONSHINE_REQUIRED");
  expect(missing.counts().connected).toBe(0);
  const f = setup();
  const running = f.runtime.start();
  await until(() => f.counts().connected === 1);
  await f.runtime.stop(); await running;
  expect(f.counts()).toMatchObject({ connected: 1, stopped: 1, lockChecks: 1 });
});

test("U01 U04 one greeting with confetti is committed before receipt; unauthorized ignored", async () => {
  const f = setup();
  const running = f.runtime.start();
  await until(() => f.counts().connected === 1);
  f.events.push(f.space, f.message("unauthorized", { type: "text", text: "hello" }, "someone@example.test"));
  f.events.push(f.space, f.message("first-hi", { type: "text", text: "hi" }));
  f.events.push(f.space, f.message("first-hi", { type: "text", text: "hi" }));
  await until(() => f.store.listOutbound().some(item => item.status === "accepted"));
  await f.runtime.stop(); await running;
  expect(f.counts().sent).toBe(1);
  expect(f.counts().readAfterCommit).toBe(true);
  expect(f.store.recentInbound().map(row => row.id)).toEqual(["first-hi"]);
  const item = f.store.listOutbound()[0]!;
  expect(item.kind ?? "text").toBe("text");
  expect("effect" in item && item.effect).toBe("confetti");
  expect("text" in item && item.text).toContain("Grokbot");
  expect(f.store.formBatches()).toHaveLength(0);
});

test("A01 W04 stalled first voice does not block later text; stop preserves correlated work", async () => {
  const f = setup();
  const running = f.runtime.start();
  await until(() => f.counts().connected === 1);
  f.events.push(f.space, f.message("voice-one", {
    type: "voice", id: "attachment-one", name: "voice.caf", mimeType: "audio/x-caf",
    read: async () => new Promise<Buffer>(() => {}),
  }));
  f.events.push(f.space, f.message("later-text", { type: "text", text: "use that voice as context" }));
  await until(() => f.store.recentInbound().length === 2);
  await f.runtime.stop(); await running;
  const rows = f.store.recentInbound();
  expect(rows.some(row => row.id === "later-text" && row.text === "use that voice as context")).toBe(true);
  expect(rows.find(row => row.id === "voice-one")?.mediaState).toBe("failed");
  expect(f.store.formBatches()).toHaveLength(0); // shutdown already formed durable batch
  expect(f.counts().connected).toBe(1);
});

test("O04 runtime restart quarantines an old sending attempt before dispatch", async () => {
  const f = setup();
  const b = batch(f.store, "test-space");
  const items = f.store.enqueue({ spaceId: "test-space", text: "uncertain old send" }, {
    actionKey: "old-send", destination: b.destination, purpose: "final", claim: b.claim,
  });
  f.store.claimOutbound();
  const running = f.runtime.start();
  await until(() => f.counts().connected === 1);
  await f.runtime.stop(); await running;
  expect(f.store.outboundStatus(items[0]!.id)?.state).toBe("unknown");
  expect(f.counts().sent).toBe(0);
});
