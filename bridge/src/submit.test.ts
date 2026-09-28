import { test, expect } from "bun:test";
import { writeFileSync, symlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { deliveryFixture } from "./delivery-fixture.ts";
import { submitOutbound, parseSubmission } from "./submit.ts";
import { parseLegacyArgs } from "./enqueue.ts";
import { stageOutboundFile } from "./authorization.ts";

test("X01/X02 stored destination, claim generation and target gate submission",async()=>{const f=deliveryFixture();try{
  const valid=f.submission({spaceId:f.destination.spaceId,text:"ok"});
  await expect(submitOutbound({...valid,payload:{...valid.payload,spaceId:"another-space"}},f)).rejects.toThrow("DESTINATION_MISMATCH");
  await expect(submitOutbound({...valid,claim:{...valid.claim,generation:999}},f)).rejects.toThrow();
  for(const kind of ["reply","react","app_update"] as const){const payload=kind==="reply"?{kind,spaceId:f.destination.spaceId,targetMessageId:"elsewhere",text:"hi"}:kind==="react"?{kind,spaceId:f.destination.spaceId,targetMessageId:"elsewhere",emoji:"❤️"}:{kind,spaceId:f.destination.spaceId,targetMessageId:"elsewhere",url:"https://example.test/app"};await expect(submitOutbound(f.submission(payload),f)).rejects.toThrow("TARGET_CONTEXT_MISMATCH");}
  expect(f.store.listOutbound()).toHaveLength(0);
}finally{f.cleanup();}});

test("X03 every original staged path validated before any conversion",async()=>{const f=deliveryFixture();try{let conversions=0;const secret=join(f.paths.secretsDir,"bridge.env");writeFileSync(secret,"SYNTHETIC_SECRET",{mode:0o600});const link=join(f.paths.outboundAssetsDir,"linked.png");symlinkSync(secret,link);const dir=join(f.paths.outboundAssetsDir,"directory.png");mkdirSync(dir,{mode:0o700});const valid=f.asset();for(const path of [secret,link,dir,join(f.paths.outboundAssetsDir,"..","secrets","x")]){await expect(submitOutbound(f.submission({kind:"attachment_group",spaceId:f.destination.spaceId,attachmentPaths:[valid,path]}),{...f,normalize:async(input)=>{conversions++;return input;}})).rejects.toThrow();}expect(conversions).toBe(0);expect(f.store.listOutbound()).toHaveLength(0);}finally{f.cleanup();}});

test("X04/X05 strict JSON and legacy context preserve shell text as data",async()=>{const f=deliveryFixture();try{const s=f.submission({spaceId:f.destination.spaceId,text:'$(touch no) `echo hi` "quoted"'});for(const extra of [{authorized:true},{role:"Front Door"},{lineId:"another"}])expect(()=>parseSubmission({...s,...extra})).toThrow("UNKNOWN_FIELD");expect(()=>parseSubmission({...s,payload:{...s.payload,effect:"disco"}})).toThrow();expect(()=>parseLegacyArgs(["--space-id","space","--text","hi"])).toThrow("FENCED_CONTEXT_REQUIRED");const flags=["--space-id",f.destination.spaceId,"--batch-id",s.batchId,"--run-id",s.claim.runId,"--generation",String(s.claim.generation),"--action-key","key","--purpose","final"];
for(const args of [["--voice","file","--text","x","--effect","confetti"],["--text","hi","--unknown","x"],["--text"],["--text","a","--text","b"]])expect(()=>parseLegacyArgs([...flags,...args])).toThrow();
const parsed=parseLegacyArgs([...flags,"--text",s.payload.kind===undefined?s.payload.text:"unexpected"]);const result=await submitOutbound(parsed,f);expect(result).toHaveLength(1);expect((f.store.listOutbound()[0] as {text:string}).text).toBe(s.payload.kind===undefined?s.payload.text:"unexpected");}finally{f.cleanup();}});

test("same action/payload reuses ids; changed payload conflicts",async()=>{const f=deliveryFixture();try{const s=f.submission({spaceId:f.destination.spaceId,text:"one"},"stable");const first=await submitOutbound(s,f);expect(await submitOutbound(s,f)).toEqual(first);await expect(submitOutbound({...s,payload:{spaceId:f.destination.spaceId,text:"two"}},f)).rejects.toThrow("ACTION_PAYLOAD_CONFLICT");expect(f.store.listOutbound()).toHaveLength(1);}finally{f.cleanup();}});

test("operator staging rejects private secrets and creates no send authority",async()=>{const f=deliveryFixture();try{const p=join(f.paths.secretsDir,"private");writeFileSync(p,"secret",{mode:0o600});await expect(stageOutboundFile(p,f.paths)).rejects.toThrow("STAGE_PRIVATE_INSTANCE_REJECTED");expect(f.store.listOutbound()).toHaveLength(0);}finally{f.cleanup();}});
