/** One in-flight task per loop; cancellation stops scheduling, never overlaps ticks. */
export class JobLoop {
  private readonly abort = new AbortController();
  private running?: Promise<void>;
  constructor(private readonly task: (signal: AbortSignal) => Promise<void>, private readonly intervalMs: number, private readonly onError: () => void = () => {}) {
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) throw new Error("JOB_INTERVAL_INVALID");
  }
  start(): void { if (!this.running) this.running = this.run(); }
  private async run(): Promise<void> {
    while (!this.abort.signal.aborted) {
      try { await this.task(this.abort.signal); } catch { this.onError(); }
      if (this.abort.signal.aborted) break;
      await new Promise<void>(resolve => {
        const finish = () => { clearTimeout(timer); this.abort.signal.removeEventListener("abort", finish); resolve(); };
        const timer = setTimeout(finish, this.intervalMs);
        this.abort.signal.addEventListener("abort", finish, { once: true });
      });
    }
  }
  async stop(): Promise<void> { this.abort.abort(); await this.running; }
}
