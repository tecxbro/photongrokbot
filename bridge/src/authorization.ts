import { constants, lstat, mkdir, open, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { assertPrivateFile, ensureInstancePaths, resolveInstancePaths } from "../../shared/instance-paths.mjs";
import type { BridgeStore, Destination, Submission } from "./contracts.ts";
import { publishMediaFile } from "./subprocess.ts";
export class AuthorizationError extends Error {
    constructor(public readonly code: string) { super(code); this.name = "AuthorizationError"; }
}
export function authorizeSubmission(submission: Submission, store: BridgeStore): Destination {
    if (submission.claim.batchId !== submission.batchId)
        throw new AuthorizationError("CLAIM_BATCH_MISMATCH");
    const revision = store.assertWork(submission.claim, submission.inputRevision);
    const destination = store.readBatch(submission.batchId).destination;
    if (!destination || destination.spaceId !== submission.payload.spaceId)
        throw new AuthorizationError("DESTINATION_MISMATCH");
    if (submission.taskId) {
        const input = store.getTaskInput(submission.taskId, submission.batchId, revision);
        if (!["accepted", "completed"].includes(input.state) || (submission.taskInputRevision !== undefined && submission.taskInputRevision !== input.inputRevision))
            throw new AuthorizationError("TASK_CONTEXT_MISMATCH");
    } else if (submission.taskInputRevision !== undefined) throw new AuthorizationError("TASK_CONTEXT_MISMATCH");
    if (submission.purpose === "control" && submission.payload.kind !== "typing")
        throw new AuthorizationError("CONTROL_TYPING_ONLY");
    if (submission.payload.kind === "typing" && submission.purpose !== "control")
        throw new AuthorizationError("TYPING_CONTROL_REQUIRED");
    if ("targetMessageId" in submission.payload && !store.knownTarget(destination, submission.payload.targetMessageId))
        throw new AuthorizationError("TARGET_CONTEXT_MISMATCH");
    return destination;
}
export function authorizeArtifactPaths(paths: ReturnType<typeof resolveInstancePaths>, payload: Submission["payload"]): void {
    const originals = payload.kind === "attachment_group" ? payload.attachmentPaths : payload.kind === "voice" ? [payload.audioPath] : "attachmentPath" in payload && payload.attachmentPath ? [payload.attachmentPath] : [];
    // Validate the complete original list before the first conversion starts.
    for (const path of originals)
        assertPrivateFile(path, paths.outboundAssetsDir);
}
/** Explicit operator staging only. This cannot distinguish administrators sharing
 * one Unix UID; its supported protocol does not grant send authority or claims.
 */
export async function stageOutboundFile(source: string, paths = resolveInstancePaths()): Promise<string> {
    if (!isAbsolute(source) || source.includes("\0") || source.split(/[\\/]/).includes(".."))
        throw new AuthorizationError("STAGE_PATH_INVALID");
    const full = resolve(source);
    let current: string = sep;
    for (const part of full.split(sep).filter(Boolean)) {
        current = join(current, part);
        if ((await lstat(current)).isSymbolicLink())
            throw new AuthorizationError("STAGE_SYMLINK_REJECTED");
    }
    const inInstance = relative(paths.root, full);
    if (!inInstance.startsWith(`..${sep}`) && inInstance !== ".." && !isAbsolute(inInstance))
        throw new AuthorizationError("STAGE_PRIVATE_INSTANCE_REJECTED");
    const name = basename(full);
    if (/^\.env(?:\.|$)|\.(?:pem|key|p12|pfx)$/i.test(name))
        throw new AuthorizationError("STAGE_SECRET_FILE_REJECTED");
    const stat = await lstat(full);
    if (!stat.isFile() || stat.size <= 0 || stat.size > 100 * 1024 * 1024)
        throw new AuthorizationError("STAGE_FILE_INVALID");
    ensureInstancePaths(paths);
    const output = join(paths.outboundAssetsDir, `${randomUUID()}-${name.replace(/[^\w.()+ -]/g, "_").slice(0, 150)}`);
    const temp = `${output}.partial`;
    const input = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW);
    const target = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
        const block = Buffer.alloc(1024 * 1024);
        let total = 0;
        for (;;) {
            const { bytesRead } = await input.read(block, 0, block.length, null);
            if (!bytesRead)
                break;
            total += bytesRead;
            if (total > stat.size)
                throw new AuthorizationError("STAGE_SOURCE_CHANGED");
            await target.writeFile(block.subarray(0, bytesRead));
        }
        if (total !== stat.size)
            throw new AuthorizationError("STAGE_SOURCE_CHANGED");
        await target.close();
        await publishMediaFile(temp, output);
        return output;
    }
    finally {
        await input.close();
        await target.close().catch(() => undefined);
        await rm(temp, { force: true });
    }
}
