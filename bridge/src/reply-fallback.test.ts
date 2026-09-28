import { test, expect } from "bun:test";
import { sendReplyWithFallback } from "./reply-fallback.ts";
test("direct reply retains provider reference and does not fallback", async () => {
  let sends=0; const result=await sendReplyWithFallback({getMessage:async()=>({reply:async()=>({id:"reply"})}),send:async()=>{sends++;return{id:"fallback"};}},"known","hi");
  expect(result.mode).toBe("reply");expect(result.outcome).toEqual({state:"accepted",reference:{messageId:"reply"},evidence:"spectrum_message_reference"});expect(sends).toBe(0);
});
test("definitive missing target and verified unsupported reply permit one fallback", async () => {
  for(const missing of [true,false]) { let sends=0; const result=await sendReplyWithFallback({getMessage:async()=>missing?undefined:{reply:async()=>undefined},send:async()=>{sends++;return{id:"fallback"};}},"known","hi",{spectrumUndefinedIsSkipped:true});expect(result.mode).toBe("fallback");expect(result.outcome.state).toBe("accepted");expect(sends).toBe(1); }
});
test("reply acceptance followed by throw cannot cause second plain send", async () => {
  let sends=0;const result=await sendReplyWithFallback({getMessage:async()=>({reply:async()=>{throw new Error("accepted then disconnected");}}),send:async()=>{sends++;return{id:"duplicate"};}},"known","hi",{spectrumUndefinedIsSkipped:true});expect(result.outcome.state).toBe("unknown");expect(sends).toBe(0);
});
test("unverified undefined remains unknown; fallback undefined skipped, fallback throw unknown", async () => {
  let sends=0;const uncertain=await sendReplyWithFallback({getMessage:async()=>({reply:async()=>undefined}),send:async()=>{sends++;return{};}},"known","hi");expect(uncertain.outcome.state).toBe("unknown");expect(sends).toBe(0);
  const skipped=await sendReplyWithFallback({getMessage:async()=>undefined,send:async()=>undefined},"known","hi");expect(skipped.outcome.state).toBe("skipped");
  const failed=await sendReplyWithFallback({getMessage:async()=>undefined,send:async()=>{throw new Error("uncertain");}},"known","hi");expect(failed.outcome.state).toBe("unknown");
});
