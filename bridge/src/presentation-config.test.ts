import { expect, test } from "bun:test";
import { fixture } from "./tests/storage/fixture.ts";
import { SetupSession } from "./setup-state.ts";

test("H04 authorized Live Mini environment registers origin before any task-card send", () => {
  const f = fixture();
  try {
    const session = new SetupSession(f.paths, f.store);
    expect(() => session.writeLiveEnvironment("PUBLIC_BASE_URL=https://cards.example.test\nPUBLISHER_TOKEN=synthetic-publisher\n")).toThrow("LIVE_MINI_AUTHORIZATION_REQUIRED");
    session.authorizeLiveMini(true);
    session.writeLiveEnvironment("PUBLIC_BASE_URL=https://cards.example.test\nPUBLISHER_TOKEN=synthetic-publisher\n");
    expect(f.store.getMetadata("live-mini-host", "configured")).toEqual({ origin: "https://cards.example.test" });
    expect(() => session.writeLiveEnvironment("PUBLIC_BASE_URL=https://different.example.test\nPUBLISHER_TOKEN=synthetic-publisher\n")).toThrow("LIVE_ENV_CONFLICT_REDEPLOY_REVIEW_REQUIRED");
    expect(f.store.getMetadata("live-mini-host", "configured")).toEqual({ origin: "https://cards.example.test" });
  } finally { f.cleanup(); }
});
