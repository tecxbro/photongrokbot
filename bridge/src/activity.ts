import type { Destination } from "./contracts.ts";

export type TypingPort = {
  start(destination: Destination): Promise<void>;
  stop(destination: Destination): Promise<void>;
};

/** Optional typing follows verified active work, with a finite local lifetime. */
export class ActivityDriver {
  private readonly active = new Map<string, {
    destination: Destination;
    since: number;
    refreshed: number;
    expired: boolean;
    cleanupNeeded: boolean;
  }>();

  constructor(
    private readonly port: TypingPort,
    private readonly now = Date.now,
    private readonly lifetimeMs = 120_000,
    private readonly refreshMs = 20_000,
  ) {}

  async sync(destinations: Destination[]): Promise<void> {
    const current = new Map(destinations.map(destination => [JSON.stringify(destination), destination]));
    for (const [key, entry] of this.active) {
      if (!current.has(key)) {
        this.active.delete(key);
        if (entry.cleanupNeeded) await this.bestEffort(() => this.port.stop(entry.destination));
      }
    }
    for (const [key, destination] of current) {
      const time = this.now();
      let entry = this.active.get(key);
      if (!entry) {
        entry = { destination, since: time, refreshed: time - this.refreshMs, expired: false, cleanupNeeded: false };
        this.active.set(key, entry);
      }
      if (time - entry.since >= this.lifetimeMs) {
        entry.expired = true;
        if (entry.cleanupNeeded) {
          entry.cleanupNeeded = false;
          await this.bestEffort(() => this.port.stop(destination));
        }
      } else if (!entry.expired && time - entry.refreshed >= this.refreshMs) {
        entry.refreshed = time;
        // A rejected/timed-out start may already have reached the provider.
        // Disable refresh retries separately from the eventual cleanup attempt.
        entry.cleanupNeeded = true;
        // A failed/uncertain optional control must not start an overlapping retry.
        if (!await this.bestEffort(() => this.port.start(destination))) entry.expired = true;
      }
    }
  }

  async stop(): Promise<void> { await this.sync([]); }

  private async bestEffort(action: () => Promise<void>): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        action(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("CONTROL_TIMEOUT")), 5_000);
        }),
      ]);
      return true;
    } catch { return false; }
    finally { if (timer) clearTimeout(timer); }
  }
}
