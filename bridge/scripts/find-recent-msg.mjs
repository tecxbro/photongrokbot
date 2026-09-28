#!/usr/bin/env bun
// Local bounded read. This diagnostic never connects Spectrum or requests history.
import { getStore } from "../src/storage.ts";
try {
  const args = process.argv.slice(2);
  let limit = 20,
    content = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--content") content = true;
    else if (args[i] === "--limit") limit = Number(args[++i]);
    else throw new Error("ARGUMENT_INVALID");
  }
  const rows = getStore().recentInbound(limit);
  console.log(
    JSON.stringify(
      content
        ? rows
        : rows.map(({ id, kind, timestamp }) => ({
            id,
            kind: kind ?? "text",
            timestamp,
          })),
    ),
  );
} catch {
  console.error("RECENT_MESSAGES_REJECTED");
  process.exitCode = 1;
}
