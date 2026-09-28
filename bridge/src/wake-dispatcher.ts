import type { BridgeStore, WakeJob } from './contracts.ts';

type WakeStore = Pick<BridgeStore, 'claimWake' | 'settleWake'>;
export type WakeDispatcherOptions = {
  store: WakeStore; url: string; key: string; fetch?: typeof fetch; clock?: () => number;
  timeoutMs?: number; maxAttempts?: number; acknowledgementGraceMs?: number;
  baseBackoffMs?: number; maxBackoffMs?: number; random?: () => number;
  onStatus?: (status: { code: string; attempts: number }) => void;
};

/** HTTP acknowledgement records receipt only; store claims fence actual work. */
export class WakeDispatcher {
  private readonly fetcher: typeof fetch;
  private readonly timeout: number;
  private readonly maxAttempts: number;
  private readonly grace: number;
  private readonly base: number;
  private readonly maximum: number;
  private stopped = false;
  private active?: Promise<void>;
  private controller?: AbortController;
  constructor(private readonly options: WakeDispatcherOptions) {
    let url: URL;
    try { url = new URL(options.url); } catch { throw new Error('WAKE_CONFIGURATION_INVALID'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || !options.key || /[\r\n]/.test(options.key)) throw new Error('WAKE_CONFIGURATION_INVALID');
    this.fetcher = options.fetch ?? fetch;
    this.timeout = options.timeoutMs ?? 10000; this.maxAttempts = options.maxAttempts ?? 5; this.grace = options.acknowledgementGraceMs ?? 60000;
    this.base = options.baseBackoffMs ?? 1000; this.maximum = options.maxBackoffMs ?? 300000;
    if (![this.timeout, this.maxAttempts, this.grace, this.base, this.maximum].every(Number.isFinite) || this.timeout < 1 || this.timeout > 25000 || !Number.isInteger(this.maxAttempts) || this.maxAttempts < 1 || this.maxAttempts > 20 || this.grace < 1000 || this.base < 1 || this.maximum < this.base || this.maximum > 3600000) throw new Error('WAKE_POLICY_INVALID');
  }
  notify(): void {
    void this.drain().catch(() => { this.report('WAKE_DISPATCH_FAILED', 0); });
  }
  drain(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.active) return this.active;
    // Async boundary installs the single-flight promise before a fetch may run.
    const run = Promise.resolve().then(() => this.run());
    this.active = run.finally(() => { this.active = undefined; });
    return this.active;
  }
  async stop(): Promise<void> {
    this.stopped = true; this.controller?.abort(); await this.active;
  }
  private report(code: string, attempts: number) {
    // Observer failures cannot alter durable HTTP outcome or retry the provider.
    try { this.options.onStatus?.({ code, attempts }); } catch { /* fixed output only */ }
  }
  private retry(job: WakeJob, code: string) {
    if (job.attempts >= this.maxAttempts) { this.options.store.settleWake(job, { state: 'failed', code: 'WAKE_ATTEMPTS_EXHAUSTED' }); this.report('WAKE_ATTEMPTS_EXHAUSTED', job.attempts); return; }
    const random = Math.max(0, Math.min(1, (this.options.random ?? Math.random)()));
    const backoff = Math.min(this.maximum, this.base * 2 ** Math.min(job.attempts - 1, 20));
    const delay = Math.min(this.maximum, Math.round(backoff * (1 + random * 0.2)));
    this.options.store.settleWake(job, { state: 'retry_wait', code, retryAfterMs: delay }); this.report(code, job.attempts);
  }
  private async run() {
    // Bound work per tick so the coordinator's lifecycle loop owns scheduling.
    for (let count = 0; count < 32 && !this.stopped; count++) {
      const job = this.options.store.claimWake((this.options.clock ?? Date.now)()); if (!job) return;
      if (job.attempts > this.maxAttempts) { this.options.store.settleWake(job, { state: 'failed', code: 'WAKE_ATTEMPTS_EXHAUSTED' }); continue; }
      const controller = new AbortController(); this.controller = controller;
      let timeout: ReturnType<typeof setTimeout> | undefined, code = 'WAKE_REQUEST_FAILED', response: Response | undefined;
      try {
        const abort = new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () => reject(new Error('WAKE_ABORTED')), { once: true });
          timeout = setTimeout(() => { code = 'WAKE_TIMEOUT'; controller.abort(); }, this.timeout);
        });
        response = await Promise.race([this.fetcher(this.options.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.options.key}` }, body: JSON.stringify({ batchId: job.batchId }), redirect: 'error', signal: controller.signal }), abort]);
      } catch { /* No raw error, URL, headers or remote body enters diagnostics. */ }
      finally { if (timeout) clearTimeout(timeout); this.controller = undefined; }
      if (!response) { this.retry(job, this.stopped ? 'WAKE_SHUTDOWN' : code); continue; }
      // We need status only; cancel any streaming body without reading private content.
      void response.body?.cancel().catch(() => {});
      if (response.status >= 200 && response.status < 300) {
        this.options.store.settleWake(job, { state: 'acknowledged', retryAfterMs: this.grace }); this.report('WAKE_ACKNOWLEDGED', job.attempts);
      } else if ([408, 425, 429].includes(response.status) || response.status >= 500) this.retry(job, 'WAKE_TRANSIENT_HTTP');
      else { this.options.store.settleWake(job, { state: 'failed', code: 'WAKE_PERMANENT_HTTP' }); this.report('WAKE_PERMANENT_HTTP', job.attempts); }
    }
  }
}
export function createWakeDispatcher(options: WakeDispatcherOptions): WakeDispatcher { return new WakeDispatcher(options); }
