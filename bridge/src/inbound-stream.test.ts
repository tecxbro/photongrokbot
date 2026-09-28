import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { InboundController } from "./inbound-controller.ts";
import { createMediaWorker } from "./media-worker.ts";
import { fixture } from "./tests/storage/fixture.ts";

for (const oversized of [false, true]) {
  test(`A04 real inbound acceptance preserves bound cancellable stream (${oversized ? "oversized" : "valid"})`, async () => {
    const f = fixture();
    let reads = 0, streams = 0, cancellations = 0, resolutions = 0;
    const source = {
      type: "attachment", id: "synthetic-attachment", name: "fixture.bin",
      mimeType: "application/octet-stream", expectedReceiver: true,
      async read() { reads++; throw new Error("buffered allocation must not run"); },
      stream() {
        expect(this.expectedReceiver).toBe(true);
        streams++;
        return new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(oversized ? 17 : 4).fill(65));
            if (!oversized) controller.close();
          },
          cancel() { cancellations++; },
        });
      },
    };
    const controller = new InboundController({ store: f.store, authorizedSenderId: "fixture-sender" });
    const worker = createMediaWorker({
      store: f.store, attachmentOptions: { paths: f.paths, maxBytes: 16 },
      resolveReference: async () => { resolutions++; return undefined; },
    });
    try {
      const result = controller.receive({ id: "space-1", phone: "line-1" }, {
        id: "synthetic-event", direction: "inbound", platform: "imessage",
        sender: { id: "fixture-sender" }, timestamp: new Date(),
        content: { type: "reply", target: { id: "original-target" }, content: source },
      });
      if (result.status !== "accepted" || !result.mediaReference || !result.readableContent) throw new Error("fixture acceptance failed");
      const batch = controller.flushAll()[0]!;
      worker.remember(result.mediaReference, result.readableContent);
      worker.notify();
      await worker.drain();
      const message = f.store.readBatch(batch.batchId).messages[0]!;
      expect(reads).toBe(0);
      expect(streams).toBe(1);
      expect(resolutions).toBe(0);
      expect(message.replyToMessageId).toBe("original-target");
      expect(message.mediaState).toBe(oversized ? "failed" : "ready");
      if (oversized) {
        expect(cancellations).toBe(1);
        expect(message.mediaError).toBe("attachment_too_large");
        expect(message.attachmentPath).toBeUndefined();
        expect(readdirSync(f.paths.inboundAttachmentsDir)).toEqual([]);
      } else {
        expect(readFileSync(message.attachmentPath!, "utf8")).toBe("AAAA");
      }
    } finally { await worker.stop(); f.cleanup(); }
  });
}
