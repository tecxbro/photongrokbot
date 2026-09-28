import { getStore } from "./storage.ts";
import { boundedStdin } from "./batch-control.ts";
import { submitOutbound } from "./submit.ts";
import { stageOutboundFile } from "./authorization.ts";

/** Legacy syntax is only an adapter into the same fenced structured protocol. */
export function parseLegacyArgs(raw: string[]): unknown {
  const args = raw[0] === "--" ? raw.slice(1) : raw;
  const values = new Map<string, string[]>();
  const allowed = new Set(["space-id","text","attachment","effect","reply-to","react","target","typing","poll-title","option","voice","duration","app-url","app-update","live","batch-id","run-id","generation","action-key","purpose","task-id"]);
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    if (!flag.startsWith("--") || !allowed.has(flag.slice(2))) throw new Error("ARGUMENT_INVALID");
    const name = flag.slice(2); const prior = values.get(name) ?? [];
    if (prior.length && !["attachment","option"].includes(name)) throw new Error("ARGUMENT_DUPLICATE");
    const value = name === "live" ? "true" : args[++i];
    if (value === undefined || value.startsWith("--")) throw new Error("ARGUMENT_VALUE_REQUIRED");
    values.set(name, [...prior,value]);
  }
  const get = (key: string) => values.get(key)?.[0];
  for (const key of ["space-id","batch-id","run-id","generation","action-key","purpose"]) if (!get(key)) throw new Error("FENCED_CONTEXT_REQUIRED");
  const modeFlags = ["reply-to","react","typing","poll-title","voice","app-update"].filter((k) => values.has(k));
  if (values.has("app-url") && !values.has("app-update")) modeFlags.push("app-url");
  if (modeFlags.length > 1) throw new Error("INCOMPATIBLE_ARGUMENTS");
  const mode = modeFlags[0] ?? "text";
  const context = new Set(["space-id","batch-id","run-id","generation","action-key","purpose","task-id"]);
  const extras: Record<string,string[]> = { text:["text","attachment","effect"], "reply-to":["reply-to","text"], react:["react","target"], typing:["typing"], "poll-title":["poll-title","option"], voice:["voice","duration","text"], "app-url":["app-url","live"], "app-update":["app-update","app-url","live"] };
  for (const key of values.keys()) if (!context.has(key) && !extras[mode]!.includes(key)) throw new Error("INCOMPATIBLE_ARGUMENTS");
  const spaceId = get("space-id")!; let payload: Record<string,unknown>;
  if (mode === "reply-to") payload = { kind:"reply", spaceId, targetMessageId:get(mode), text:get("text") };
  else if (mode === "react") payload = { kind:"react", spaceId, targetMessageId:get("target"), emoji:get("react") };
  else if (mode === "typing") payload = { kind:"typing", spaceId, state:get("typing") };
  else if (mode === "poll-title") payload = { kind:"poll", spaceId, title:get(mode), options:values.get("option") ?? [] };
  else if (mode === "voice") payload = { kind:"voice", spaceId, audioPath:get(mode), ...(get("text") ? {text:get("text")} : {}), ...(get("duration") !== undefined ? {durationSeconds:Number(get("duration"))} : {}) };
  else if (mode === "app-url" || mode === "app-update") payload = { kind:mode === "app-url" ? "app" : "app_update", spaceId, url:get("app-url"), live:values.has("live"), ...(mode === "app-update" ? {targetMessageId:get("app-update")} : {}) };
  else { const attachments = values.get("attachment") ?? []; if (attachments.length > 1) { if (values.has("effect")) throw new Error("INCOMPATIBLE_ARGUMENTS"); payload = {kind:"attachment_group",spaceId,attachmentPaths:attachments,...(get("text") ? {text:get("text")} : {})}; } else payload = {kind:"text",spaceId,text:get("text") ?? "",...(attachments[0] ? {attachmentPath:attachments[0]} : {}),...(get("effect") ? {effect:get("effect")} : {})}; }
  return { version:1, batchId:get("batch-id"), claim:{batchId:get("batch-id"),runId:get("run-id"),generation:Number(get("generation"))}, actionKey:get("action-key"), purpose:get("purpose"), payload, ...(get("task-id") ? {taskId:get("task-id")} : {}) };
}
export async function enqueueMain(raw = process.argv.slice(2)): Promise<void> {
  const args = raw[0] === "--" ? raw.slice(1) : raw;
  if (args[0] === "--stage-file") {
    if (args.length !== 2 || !args[1]) throw new Error("ARGUMENT_INVALID");
    console.log(JSON.stringify({ stagedPath: await stageOutboundFile(args[1]) })); return;
  }
  let submission: unknown;
  if (args.includes("--json-stdin")) { if (args.length !== 1) throw new Error("INCOMPATIBLE_ARGUMENTS"); submission = JSON.parse(await boundedStdin()); }
  else submission = parseLegacyArgs(args);
  const statuses = await submitOutbound(submission, { store:getStore() });
  console.log(JSON.stringify({ count:statuses.length, items:statuses.map(({id,state,attempts}) => ({id,state,attempts})) }));
}
if (import.meta.main) {
  try { await enqueueMain(); } catch { console.error("OUTBOUND_SUBMISSION_REJECTED"); process.exitCode = 1; }
}
