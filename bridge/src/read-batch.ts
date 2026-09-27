import { readUnreadBatch } from "./storage.ts";

const batchId = process.argv.slice(2).find((arg) => arg !== "--");
if (!batchId) {
  console.error("usage: bun run read-batch -- <batchId>");
  process.exit(1);
}

const batch = await readUnreadBatch(batchId);
process.stdout.write(`${JSON.stringify(batch, null, 2)}\n`);
