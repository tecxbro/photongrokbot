import { Spectrum, type Message, type Space } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { resolveInstancePaths, type InstancePaths } from "../../shared/instance-paths.mjs";
import type { Config } from "./types.ts";
import type { Destination, MediaReference } from "./contracts.ts";
import type { ExtendedBridgeStore } from "./storage.contract.ts";
import type { ReadableAttachmentContent } from "./inbound-attachment.ts";
import { openStore } from "./storage.ts";
import { assertInstanceLock } from "./instance-lock.ts";
import { assertRuntimeReady } from "./setup-state.ts";
import { InboundController } from "./inbound-controller.ts";
import { createWakeDispatcher, type WakeFetch } from "./wake-dispatcher.ts";
import { createMediaWorker } from "./media-worker.ts";
import { createOutboundDispatcher } from "./outbound-dispatcher.ts";
import { drainCardsReady } from "./cards-ready.ts";
import { applyResolvedOptionToInbound, resolveReactionOption } from "./reaction-option.ts";
import { ActivityDriver } from "./activity.ts";
import { JobLoop } from "./job-loop.ts";

type SpectrumApp = Awaited<ReturnType<typeof Spectrum>>;
type RuntimeTestPorts = {
  paths: InstancePaths;
  store: ExtendedBridgeStore;
  connect: () => Promise<SpectrumApp>;
  assertLock: () => void;
  resolveSpace: (destination: Destination) => Promise<Space>;
  resolveReference?: (reference: MediaReference, signal: AbortSignal) => Promise<ReadableAttachmentContent | undefined>;
  fetch?: WakeFetch;
};
const destinationKey = ({ spaceId, lineId }: Destination) => JSON.stringify([spaceId, lineId]);
const log = (code: string) => console.log(`[photon] ${code}`);

/** One installation owner, one Spectrum connection, and one canonical store. */
export class GpProofRuntime {
  private readonly paths: InstancePaths;
  private store?: ExtendedBridgeStore;
  private app?: SpectrumApp;
  private controller?: InboundController;
  private media?: ReturnType<typeof createMediaWorker>;
  private outbound?: ReturnType<typeof createOutboundDispatcher>;
  private wakes?: ReturnType<typeof createWakeDispatcher>;
  private activity?: ActivityDriver;
  private readonly loops: JobLoop[] = [];
  private readonly spaces = new Map<string, Space>();
  private readonly receipts = new Set<Promise<void>>();
  private started = false;
  private stopped = false;
  private stopping?: Promise<void>;
  private signalStop!: () => void;
  private readonly stopRequested = new Promise<void>(resolve => { this.signalStop = resolve; });
  private readonly onSignal = () => { void this.stop().catch(() => log("SHUTDOWN_FAILED")); };

  constructor(private readonly config: Config, private readonly testPorts?: RuntimeTestPorts) {
    if (testPorts) {
      if (process.env.PHOTON_TEST_MODE !== "1") throw new Error("RUNTIME_TEST_INJECTION_FORBIDDEN");
      this.paths = resolveInstancePaths({ instanceDir: testPorts.paths.root, env: { PHOTON_TEST_MODE: "1" } });
    } else this.paths = resolveInstancePaths();
  }

  async start(): Promise<void> {
    if (this.started || this.stopped) throw new Error("RUNTIME_ALREADY_STARTED_OR_STOPPED");
    this.started = true;
    try {
      if (this.testPorts) this.testPorts.assertLock();
      else assertInstanceLock(this.paths);
      const store = this.testPorts?.store ?? openStore({ paths: this.paths, verifyIntegrity: true });
      this.store = store;
      const readiness = assertRuntimeReady(this.paths, store);
      store.recoverSending();
      store.recoverWork();
      if (readiness.mediaDegraded) log("MEDIA_DEGRADED_TEXT_READY");
      process.on("SIGINT", this.onSignal);
      process.on("SIGTERM", this.onSignal);
      await this.connect();
      if (this.stopped) return;
      this.controller = new InboundController({
        store,
        authorizedSenderId: this.config.authorizedSenderId,
        enrichInbound: (record, destination) => record.kind === "reaction"
          ? applyResolvedOptionToInbound(record, resolveReactionOption(store, destination, record.targetMessageId))
          : record,
      });
      this.media = createMediaWorker({
        store,
        attachmentOptions: { paths: this.paths },
        voiceOptions: { paths: this.paths },
        resolveReference: (reference, signal) => this.resolveMedia(reference, signal),
        onError: () => log("MEDIA_JOB_FAILED"),
      });
      this.outbound = createOutboundDispatcher({
        store, paths: this.paths,
        resolveSpace: destination => this.resolveSpace(destination),
        onError: () => log("OUTBOUND_JOB_FAILED"),
      });
      this.wakes = createWakeDispatcher({
        store, url: this.config.webhookUrl, key: this.config.webhookKey,
        ...(this.testPorts?.fetch ? { fetch: this.testPorts.fetch } : {}),
      });
      this.activity = new ActivityDriver({
        start: async destination => { await (await this.resolveSpace(destination)).startTyping(); },
        stop: async destination => { await (await this.resolveSpace(destination)).stopTyping(); },
      });
      // Recover pending acceptance even when the old process died before debounce.
      this.controller.flushAll();
      this.addLoop(async () => {
        this.controller!.flushDue();
        this.wakes!.notify();
        this.media!.notify();
        this.outbound!.notify();
      }, 100);
      this.addLoop(async signal => { await drainCardsReady({ store, paths: this.paths, signal }); }, 3_000);
      this.addLoop(async () => { await this.activity!.sync(store.activeConversationWork()); }, 1_000);
      log("RUNTIME_READY");
      await Promise.race([this.receive(), this.stopRequested]);
    } finally { await this.stop(); }
  }

  private addLoop(task: (signal: AbortSignal) => Promise<void>, intervalMs: number): void {
    const loop = new JobLoop(task, intervalMs, () => log("BACKGROUND_JOB_FAILED"));
    this.loops.push(loop);
    loop.start();
  }

  private async connect(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expired = false;
    const connection = (this.testPorts ? this.testPorts.connect() : Spectrum({
      projectId: this.config.projectId,
      projectSecret: this.config.projectSecret,
      providers: [imessage.config()],
    })).then(async app => {
      this.app = app;
      // A late connection cannot remain a second listener after a stopped boot.
      if (this.stopped || expired) await this.stopConnection(app);
    });
    try {
      await Promise.race([
        connection,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => { expired = true; reject(new Error("SPECTRUM_CONNECT_TIMEOUT")); }, 30_000);
        }),
      ]);
    } finally { if (timer) clearTimeout(timer); }
  }

  private async receive(): Promise<void> {
    for await (const [space, message] of this.app!.messages) {
      if (this.stopped) break;
      try {
        const result = this.controller!.receive(space, message);
        if (result.status !== "accepted" || result.result.duplicate) continue;
        const destination = { spaceId: space.id, lineId: result.record.lineId! };
        this.cacheSpace(destination, space);
        if (result.mediaReference) {
          if (result.readableContent) this.media!.remember(result.mediaReference, result.readableContent);
          this.media!.notify();
        }
        this.outbound!.notify(); // includes the atomic first-use greeting
        this.readBestEffort(message);
      } catch {
        log("INBOUND_ACCEPT_FAILED");
        throw new Error("INBOUND_ACCEPT_FAILED");
      }
    }
  }

  private readBestEffort(message: Message): void {
    // Receipts neither delay durable acceptance nor consume unlimited hanging calls.
    if (this.receipts.size >= 32) return;
    const pending = Promise.resolve().then(() => message.read()).then(() => {}, () => {});
    this.receipts.add(pending);
    void pending.finally(() => this.receipts.delete(pending));
  }

  private async resolveSpace(destination: Destination): Promise<Space> {
    const key = destinationKey(destination);
    const cached = this.spaces.get(key);
    if (cached) return cached;
    if (!this.app) throw new Error("SPECTRUM_NOT_STARTED");
    const space = this.testPorts
      ? await this.testPorts.resolveSpace(destination)
      : await imessage(this.app).space.get(destination.spaceId, { phone: destination.lineId });
    if (space.id !== destination.spaceId || (space as Space & { phone?: string }).phone !== destination.lineId) {
      throw new Error("RESOLVED_DESTINATION_MISMATCH");
    }
    this.cacheSpace(destination, space);
    return space;
  }

  private cacheSpace(destination: Destination, space: Space): void {
    const key = destinationKey(destination);
    if (!this.spaces.has(key) && this.spaces.size >= 128) this.spaces.delete(this.spaces.keys().next().value!);
    this.spaces.set(key, space);
  }

  private async resolveMedia(reference: MediaReference, signal: AbortSignal): Promise<ReadableAttachmentContent | undefined> {
    if (signal.aborted || !reference.attachmentId || !this.app) return undefined;
    if (this.testPorts?.resolveReference) return this.testPorts.resolveReference(reference, signal);
    const content = await imessage(this.app).getAttachment(reference.attachmentId, reference.lineId);
    if (!content || signal.aborted) return undefined;
    return content as ReadableAttachmentContent;
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopped = true;
    this.signalStop();
    this.stopping = this.shutdown();
    return this.stopping;
  }

  private async shutdown(): Promise<void> {
    process.off("SIGINT", this.onSignal);
    process.off("SIGTERM", this.onSignal);
    try { this.controller?.stop(); } catch { log("FINAL_BATCH_FLUSH_FAILED"); }
    await Promise.allSettled(this.loops.map(loop => loop.stop()));
    await Promise.allSettled([this.media?.stop(), this.outbound?.stop(), this.wakes?.stop()]);
    await this.activity?.stop();
    if (this.app) await this.stopConnection(this.app);
    this.spaces.clear();
    if (!this.testPorts) this.store?.close();
    log("RUNTIME_STOPPED");
  }

  private async stopConnection(app: SpectrumApp): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        app.stop(),
        new Promise<void>(resolve => { timer = setTimeout(resolve, 10_000); }),
      ]);
    } catch { log("SPECTRUM_STOP_FAILED"); }
    finally { if (timer) clearTimeout(timer); }
  }
}
