import { app, attachment, edit, group, poll, voice, type ContentInput, type Message } from "spectrum-ts";
import { effect, imessage } from "spectrum-ts/providers/imessage";
import { assertPrivateFile, resolveInstancePaths } from "../../shared/instance-paths.mjs";
import type { BridgeStore, Destination, OutboundClaim, ProviderOutcome, ProviderReference } from "./contracts.ts";
import { contentOutcome, preDispatchFailure } from "./provider-outcome.ts";
import { sendReplyWithFallback } from "./reply-fallback.ts";
import { buildAttachmentGroupParts } from "./reaction-option.ts";
import { prepareOutboundEffect } from "./outbound-effect.ts";

export type DispatchMessage = { id: string; reply(text: string): Promise<unknown>; react(emoji: string): Promise<unknown>; miniAppCardSession?: ProviderReference["miniAppCardSession"] };
export type DispatchSpace = { id: string; phone?: string; send(content: ContentInput): Promise<unknown>; getMessage(id: string): Promise<DispatchMessage | undefined>; startTyping?(): Promise<unknown>; stopTyping?(): Promise<unknown> };
export type DispatcherOptions = { store: BridgeStore; resolveSpace(destination: Destination): Promise<DispatchSpace>; paths?: ReturnType<typeof resolveInstancePaths>; concurrency?: number; timeoutMs?: number; maxAttempts?: number; random?: () => number; onError?: (code: string) => void };
export function createOutboundDispatcher(opts: DispatcherOptions) {
  const concurrency = opts.concurrency ?? 2, timeoutMs = opts.timeoutMs ?? 30_000, maxAttempts = opts.maxAttempts ?? 5;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4 || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) throw new Error("DISPATCH_LIMIT_INVALID");
  const active = new Set<Promise<void>>(), unresolved = new Set<Promise<unknown>>(), controllers = new Set<AbortController>();
  let scheduled = false, stopped = false;
  async function deliver(claim: OutboundClaim, signal: AbortSignal): Promise<ProviderOutcome> {
    const { item, destination } = claim;
    let space: DispatchSpace;
    try { space = await opts.resolveSpace(destination); }
    catch { return preDispatchFailure(item.attempts, maxAttempts, opts.random); }
    if (signal.aborted) return { state: "unknown", code: "dispatch_aborted" };
    if (space.id !== destination.spaceId || space.phone !== destination.lineId || item.spaceId !== destination.spaceId) return { state: "failed", code: "resolved_destination_mismatch" };
    const paths = opts.paths ?? resolveInstancePaths();
    try {
      const files = item.kind === "attachment_group" ? item.attachmentPaths : item.kind === "voice" ? [item.audioPath] : "attachmentPath" in item && item.attachmentPath ? [item.attachmentPath] : [];
      for (const path of files) assertPrivateFile(path, paths.outboundAssetsDir);
    } catch { return { state: "failed", code: "staged_attachment_invalid" }; }
    if ("targetMessageId" in item && !opts.store.knownTarget(destination, item.targetMessageId)) return { state: "failed", code: "target_context_mismatch" };
    try {
      if (item.kind === "typing") {
        const fn = item.state === "start" ? space.startTyping : space.stopTyping;
        if (!fn) return { state: "skipped", code: "typing_capability_absent" };
        await fn.call(space);
        return { state: "accepted", evidence: "control_invocation_resolved_not_device_delivery" };
      }
      if (item.kind === "reply") {
        const result = await sendReplyWithFallback(space, item.targetMessageId, item.text, { spectrumUndefinedIsSkipped: true, signal });
        return result.outcome.state === "retry_wait" ? preDispatchFailure(item.attempts, maxAttempts, opts.random) : result.outcome;
      }
      if (item.kind === "react" || item.kind === "app_update") {
        let target: DispatchMessage | undefined;
        try { target = await space.getMessage(item.targetMessageId); } catch { return preDispatchFailure(item.attempts, maxAttempts, opts.random); }
        if (signal.aborted) return { state: "unknown", code: "dispatch_aborted" };
        if (!target || target.id !== item.targetMessageId) return { state: "failed", code: "target_missing" };
        if (item.kind === "react") return contentOutcome(await target.react(item.emoji));
        const saved = opts.store.getMetadata<{ session: NonNullable<ProviderReference["miniAppCardSession"]> }>("app-session", item.targetMessageId);
        const session = saved?.session;
        if (!session || ![session.chatGuid,session.messageGuid,session.sessionId,session.targetMessageGuid].every((v) => typeof v === "string" && v) || session.chatGuid !== destination.spaceId) return { state: "failed", code: "app_session_missing_or_mismatched" };
        target.miniAppCardSession = session;
        const result = await space.send(edit(app(item.url, { live: item.live === true }), target as Message));
        if (result === undefined) return { state: "unknown", code: "edit_resolved_without_distinguishable_receipt", reference: { messageId: item.targetMessageId, miniAppCardSession: session } };
        return contentOutcome(result);
      }
      let payload: ContentInput;
      if (item.kind === "attachment_group") {
        if (item.attachmentPaths.length < 2 || (item.cards && item.cards.length !== item.attachmentPaths.length)) return { state: "failed", code: "attachment_group_alignment" };
        payload = group(attachment(item.attachmentPaths[0]!), attachment(item.attachmentPaths[1]!), ...item.attachmentPaths.slice(2).map((path) => attachment(path)));
      } else if (item.kind === "poll") payload = poll(item.title, item.options);
      else if (item.kind === "voice") payload = voice(item.audioPath, item.durationSeconds === undefined ? undefined : { duration: item.durationSeconds });
      else if (item.kind === "app") payload = app(item.url, { live: item.live === true });
      else {
        payload = item.attachmentPath ? attachment(item.attachmentPath) : item.text;
        if (item.effect) payload = effect(payload, (imessage.effect.message as Record<string, string>)[prepareOutboundEffect(item.effect)] as never);
      }
      const result = await space.send(payload);
      const outcome = contentOutcome(result);
      if (item.kind === "attachment_group" && outcome.state === "accepted" && outcome.reference?.messageId) {
        // Exact locked provider mapping: sendMultipart builds p:N/parent for all
        // original ordered items; no file filtering or post-send path scan.
        outcome.reference.parts = buildAttachmentGroupParts({ parentMessageId: outcome.reference.messageId, paths: item.attachmentPaths, cards: item.cards });
      }
      return outcome;
    } catch { return { state: "unknown", code: "provider_send_uncertain" }; }
  }
  async function run(claim: OutboundClaim): Promise<void> {
    const controller = new AbortController(); controllers.add(controller);
    let deadlineExpired = false;
    const work = Promise.resolve().then(() => deliver(claim, controller.signal));
    unresolved.add(work);
    void work.then((outcome) => {
      if (deadlineExpired && "reference" in outcome && outcome.reference) {
        try { opts.store.setMetadata("provider-late-reference", claim.item.id, { attemptId: claim.attemptId, outcome }); } catch { opts.onError?.("late_reference_write_failed"); }
      }
    }).finally(() => { unresolved.delete(work); notify(); }).catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<ProviderOutcome>((resolve) => {
      const expire = () => { deadlineExpired = true; resolve({ state: "unknown", code: "provider_deadline_or_shutdown" }); };
      controller.signal.addEventListener("abort", expire, { once: true });
      timer = setTimeout(() => controller.abort(), timeoutMs);
    });
    try {
      const outcome = await Promise.race([work, deadline]);
      try { opts.store.settleOutbound(claim.item.id, claim.attemptId, outcome); }
      catch {
        // Keep the durable sending attempt; recovery makes it unknown. Preserve
        // exact returned evidence if a separate journal write still works.
        try { opts.store.setMetadata("provider-unsettled-reference", claim.item.id, { attemptId: claim.attemptId, outcome }); } catch { /* DB may be unavailable. */ }
        opts.onError?.("outbound_settlement_failed");
      }
    } finally { if (timer) clearTimeout(timer); controllers.delete(controller); }
  }
  function pump() {
    scheduled = false; if (stopped) return;
    while (active.size < concurrency && unresolved.size < 4) {
      let claim: OutboundClaim | undefined;
      try { claim = opts.store.claimOutbound(); } catch { opts.onError?.("outbound_claim_failed"); return; }
      if (!claim) break;
      const task = run(claim); active.add(task);
      void task.finally(() => { active.delete(task); notify(); }).catch(() => opts.onError?.("outbound_dispatch_failed"));
    }
  }
  function notify() { if (!stopped && !scheduled) { scheduled = true; queueMicrotask(pump); } }
  async function drain() { do { await Promise.resolve(); await Promise.allSettled([...active]); } while (active.size || scheduled); }
  async function stop() { stopped = true; for (const controller of controllers) controller.abort(); await drain(); }
  return { notify, drain, stop };
}
