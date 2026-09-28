import { createHash } from "node:crypto";
import { canonical } from "./storage.contract.ts";
import { existsSync, readFileSync } from "node:fs";
import { parseLiveMiniEnv } from "./setup-verification.ts";
import { resolveInstancePaths, assertPrivateFile } from "../../shared/instance-paths.mjs";
import type { BridgeStore, OutboundStatus, Submission } from "./contracts.ts";
import type { CardOptionMeta, EnqueueOutboundInput } from "./types.ts";
import { authorizeSubmission, authorizeArtifactPaths } from "./authorization.ts";
import { normalizeEnqueueAttachments } from "./outbound-jpeg.ts";
import { prepareOutboundText } from "./outbound-text.ts";
import { prepareOutboundApp } from "./outbound-app.ts";
import { prepareOutboundEffect } from "./outbound-effect.ts";
import { prepareOutboundPoll } from "./outbound-poll.ts";
export function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("OBJECT_REQUIRED"); return value as Record<string, unknown>; }
export function keys(row: Record<string, unknown>, allowed: string[]): void { if (Object.keys(row).some((k) => !allowed.includes(k)))
    throw new Error("UNKNOWN_FIELD"); }
export function string(value: unknown, max = 32768): string { if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0"))
    throw new Error("STRING_INVALID"); return value; }
const optionalString = (value: unknown) => value === undefined ? undefined : string(value);
const base = ["kind", "spaceId"];
export function parsePayload(value: unknown): EnqueueOutboundInput {
    const p = object(value);
    const kind = p.kind ?? "text";
    string(p.spaceId, 1024);
    const allow: Record<string, string[]> = { text: ["text", "attachmentPath", "effect"], reply: ["text", "targetMessageId"], react: ["emoji", "targetMessageId"], poll: ["title", "options"], voice: ["audioPath", "text", "durationSeconds"], typing: ["state"], attachment_group: ["attachmentPaths", "text", "batchId", "cards"], app: ["url", "live"], app_update: ["url", "live", "targetMessageId"] };
    if (typeof kind !== "string" || !allow[kind])
        throw new Error("KIND_INVALID");
    keys(p, [...base, ...allow[kind]!]);
    const result = { ...p, kind } as Record<string, unknown>;
    if ("targetMessageId" in p)
        string(p.targetMessageId, 1024);
    if (kind === "text") {
        if (typeof p.text !== "string")
            throw new Error("TEXT_REQUIRED");
        prepareOutboundText(p.text, optionalString(p.attachmentPath));
        if (p.effect !== undefined)
            result.effect = prepareOutboundEffect(string(p.effect));
    }
    if (kind === "reply") {
        string(p.targetMessageId);
        prepareOutboundText(string(p.text));
    }
    if (kind === "react") {
        string(p.targetMessageId);
        string(p.emoji, 64);
    }
    if (kind === "poll") {
        if (!Array.isArray(p.options) || p.options.length > 100 || p.options.some((s) => typeof s !== "string"))
            throw new Error("POLL_OPTIONS_INVALID");
        Object.assign(result, prepareOutboundPoll(string(p.title), p.options as string[]));
    }
    if (kind === "voice") {
        string(p.audioPath);
        optionalString(p.text);
        if (p.durationSeconds !== undefined && (typeof p.durationSeconds !== "number" || !Number.isFinite(p.durationSeconds) || p.durationSeconds < 0))
            throw new Error("DURATION_INVALID");
    }
    if (kind === "typing" && p.state !== "start" && p.state !== "stop")
        throw new Error("TYPING_INVALID");
    if (kind === "app" || kind === "app_update") {
        if (p.live !== undefined && typeof p.live !== "boolean")
            throw new Error("LIVE_INVALID");
        Object.assign(result, prepareOutboundApp(string(p.url), p.live as boolean | undefined));
        if (kind === "app_update")
            string(p.targetMessageId);
    }
    if (kind === "attachment_group") {
        if (!Array.isArray(p.attachmentPaths) || p.attachmentPaths.length < 2 || p.attachmentPaths.length > 100)
            throw new Error("GROUP_REQUIRES_AT_LEAST_2_PATHS");
        p.attachmentPaths.forEach((v) => string(v));
        optionalString(p.batchId);
        if (p.text !== undefined)
            prepareOutboundText(string(p.text));
        if (p.cards !== undefined) {
            if (!Array.isArray(p.cards) || p.cards.length !== p.attachmentPaths.length)
                throw new Error("CARD_ALIGNMENT_INVALID");
            for (const row of p.cards) {
                const card = object(row);
                keys(card, ["optionId", "title", "url", "caption", "details", "price", "priceQualifier"]);
                Object.values(card).forEach((v) => string(v));
            }
        }
    }
    return result as EnqueueOutboundInput;
}
export function parseSubmission(value: unknown): Submission {
    const row = object(value);
    keys(row, ["version", "batchId", "taskId", "claim", "actionKey", "purpose", "payload", "presentation", "inputRevision", "taskInputRevision", "optionSetRevision"]);
    if (row.version !== 1)
        throw new Error("VERSION_INVALID");
    string(row.batchId, 512);
    optionalString(row.taskId);
    for (const key of ["inputRevision", "taskInputRevision"]) if (row[key] !== undefined && (!Number.isSafeInteger(row[key]) || Number(row[key]) < 1)) throw new Error("INPUT_REVISION_INVALID");
    if (row.optionSetRevision !== undefined) string(row.optionSetRevision, 120);
    string(row.actionKey, 512);
    if (!["progress", "final", "control", "presentation"].includes(String(row.purpose)))
        throw new Error("PURPOSE_INVALID");
    const claim = object(row.claim);
    keys(claim, ["batchId", "runId", "generation"]);
    string(claim.batchId, 512);
    string(claim.runId, 512);
    if (!Number.isSafeInteger(claim.generation) || Number(claim.generation) <= 0)
        throw new Error("GENERATION_INVALID");
    if (row.presentation !== undefined) {
        const p = object(row.presentation);
        keys(p, ["cardId", "taskId", "viewUrl", "claimId"]);
        for (const field of ["cardId", "taskId", "viewUrl", "claimId"])
            string(p[field]);
        if (row.purpose !== "presentation")
            throw new Error("PRESENTATION_PURPOSE_REQUIRED");
    }
    return { ...row, payload: parsePayload(row.payload) } as Submission;
}
export type SubmitOptions = {
    store: BridgeStore;
    paths?: ReturnType<typeof resolveInstancePaths>;
    signal?: AbortSignal;
    normalize?: typeof normalizeEnqueueAttachments;
};
export async function submitOutbound(raw: unknown, opts: SubmitOptions): Promise<OutboundStatus[]> {
    opts.signal?.throwIfAborted();
    const submission = parseSubmission(raw);
    const destination = authorizeSubmission(submission, opts.store);
    const paths = opts.paths ?? resolveInstancePaths();
    authorizeArtifactPaths(paths, submission.payload);
    if (submission.optionSetRevision) {
        const revision = opts.store.assertWork(submission.claim, submission.inputRevision);
        const option = opts.store.getMetadata<{payloadHash:string}>("option-set-context", canonical([submission.batchId, revision, submission.optionSetRevision, destination]));
        if (option?.payloadHash !== createHash("sha256").update(canonical(submission.payload)).digest("hex")) throw new Error("OPTION_SET_CONTEXT_MISMATCH");
    }
    if (submission.payload.kind === "app" || submission.payload.kind === "app_update") {
        const url = submission.payload.url;
        let configured = opts.store.getMetadata<{
            origin: string;
        }>("live-mini-host", "configured");
        if (!configured && existsSync(paths.liveMiniEnv)) {
            const env = parseLiveMiniEnv(readFileSync(assertPrivateFile(paths.liveMiniEnv, paths.root), "utf8"));
            configured = { origin: new URL(env.PUBLIC_BASE_URL).origin };
        }
        const parsed = new URL(url);
        const indexed = opts.store.getMetadata<{
            cardId: string;
        }>("task-card-url", url);
        const originalApp = submission.payload.kind === "app_update" ? opts.store.getMetadata<{
            url?: string;
        }>("app-session", submission.payload.targetMessageId) : undefined;
        const registeredOriginal = originalApp?.url ? opts.store.getMetadata<{
            cardId: string;
        }>("task-card-url", originalApp.url) : undefined;
        const taskCard = indexed || registeredOriginal || (configured?.origin === parsed.origin && /^\/live-(?:[1-9]|10)\/[^/]+$/.test(parsed.pathname));
        // Task-card milestones update the hosted JSON at the original URL. An
        // edit invocation is not an authorized replacement for that lifecycle.
        if (submission.payload.kind === "app_update" && (taskCard || submission.presentation))
            throw new Error("TASK_CARD_JSON_UPDATES_ONLY");
        if (!submission.presentation && taskCard)
            throw new Error("TASK_CARD_PRESENTATION_REQUIRED");
        if (submission.presentation) {
            const p = submission.presentation;
            const registered = opts.store.getMetadata<{
                cardId: string;
                taskId: string;
                batchId: string;
                destination: {
                    spaceId: string;
                    lineId: string;
                };
                viewUrl: string;
            }>("task-card-context", p.cardId);
            if (!registered || registered.cardId !== p.cardId || registered.taskId !== p.taskId || registered.batchId !== opts.store.getTask(p.taskId)?.batchId || registered.viewUrl !== url || p.viewUrl !== url || registered.destination.spaceId !== destination.spaceId || registered.destination.lineId !== destination.lineId || (submission.taskId !== undefined && submission.taskId !== registered.taskId))
                throw new Error("TASK_CARD_CONTEXT_MISMATCH");
        }
    }
    else if (submission.presentation)
        throw new Error("TASK_CARD_APP_REQUIRED");
    if (submission.presentation) opts.store.getTaskInput(submission.presentation.taskId, submission.batchId, opts.store.assertWork(submission.claim, submission.inputRevision));
    const payload = await (opts.normalize ?? normalizeEnqueueAttachments)(submission.payload, { paths, signal: opts.signal });
    opts.signal?.throwIfAborted();
    // Store rechecks the generation/destination in its own short transaction.
    const items = opts.store.enqueue(payload, { actionKey: submission.actionKey, purpose: submission.purpose, claim: submission.claim, inputRevision: submission.inputRevision, taskInputRevision: submission.taskInputRevision, optionSetRevision: submission.optionSetRevision, destination, ...(submission.taskId ? { taskId: submission.taskId } : {}), ...(submission.presentation ? { presentation: submission.presentation } : {}) });
    return items.map((item) => opts.store.outboundStatus(item.id)!);
}
