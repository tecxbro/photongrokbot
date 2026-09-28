import { test, expect } from "bun:test";
import { deliveryFixture } from "./delivery-fixture.ts";
import { submitOutbound } from "./submit.ts";
import { ensureOutboundJpeg } from "./outbound-jpeg.ts";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
test("four, five and seven attachments retain one grouped queued operation", async()=>{
  for(const count of [4,5,7]) { const f=deliveryFixture();try{const paths=Array.from({length:count},()=>f.asset());const results=await submitOutbound(f.submission({kind:"attachment_group",spaceId:f.destination.spaceId,attachmentPaths:paths}),f);expect(results).toHaveLength(1);const item=f.store.listOutbound()[0]!;expect(item.kind).toBe("attachment_group");if(item.kind==="attachment_group")expect(item.attachmentPaths).toEqual(paths);}finally{f.cleanup();} }
});
test("group rejects fewer than two paths without queue mutation",async()=>{const f=deliveryFixture();try{await expect(submitOutbound(f.submission({kind:"attachment_group",spaceId:f.destination.spaceId,attachmentPaths:[f.asset()]}),f)).rejects.toThrow("AT_LEAST_2");expect(f.store.listOutbound()).toHaveLength(0);}finally{f.cleanup();}});
test("synthetic staged PNG becomes JPEG; returned JPEG passes through",async()=>{const f=deliveryFixture();try{const path=join(f.paths.outboundAssetsDir,"pixel.png");writeFileSync(path,Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=","base64"),{mode:0o600});const jpg=await ensureOutboundJpeg(path,{paths:f.paths});expect(jpg.endsWith(".jpg")).toBe(true);expect(await ensureOutboundJpeg(jpg,{paths:f.paths})).toBe(jpg);}finally{f.cleanup();}});
