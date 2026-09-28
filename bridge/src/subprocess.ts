import { fileURLToPath } from "node:url";
import { constants, open, rename } from "node:fs/promises";
import { dirname } from "node:path";

/** Same-filesystem publication: bytes and directory entry durable before settle. */
export async function publishMediaFile(temporary: string, output: string): Promise<void> {
  if (dirname(temporary) !== dirname(output)) throw new Error("media_publish_directory_mismatch");
  const file = await open(temporary, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await file.sync(); } finally { await file.close(); }
  await rename(temporary, output);
  const directory = await open(dirname(output), constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await directory.sync(); } finally { await directory.close(); }
}

export class SubprocessError extends Error {
  constructor(public readonly code: "process_timeout" | "process_aborted" | "process_output_limit" | "process_failed" | "process_capacity") {
    super(code);
    this.name = "SubprocessError";
  }
}

export type ProcessOptions = {
  timeoutMs?: number;
  killGraceMs?: number;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  signal?: AbortSignal;
  /** An operator-provisioned Linux cgroup; never created by the worker. */
  cgroup?: string;
};

let activeProcesses = 0;

/** Drain both pipes immediately, retain bounded output, and reap before returning.
 * No shell is involved. Timeout/abort/output overflow terminates the process.
 */
export async function runBoundedProcess(argv: string[], opts: ProcessOptions = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  if (!argv.length || argv.some((part) => typeof part !== "string" || part.includes("\0"))) throw new Error("invalid_process_arguments");
  if (opts.signal?.aborted) throw new SubprocessError("process_aborted");
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const grace = opts.killGraceMs ?? 250;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(grace) || grace < 0) throw new Error("invalid_process_deadline");
  if (activeProcesses >= 4) throw new SubprocessError("process_capacity");
  activeProcesses++;
  let proc;
  try { proc = Bun.spawn(argv, {
    stdin: "ignore", stdout: "pipe", stderr: "pipe",
    // Do not propagate messaging credentials into media decoders.
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/tmp", LANG: "C.UTF-8", OMP_NUM_THREADS: "1", OPENBLAS_NUM_THREADS: "1" },
    ...(opts.cgroup ? { cgroup: opts.cgroup } : {}),
  }); } catch (error) { activeProcesses--; throw error; }
  let failure: SubprocessError | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let pipeTimer: ReturnType<typeof setTimeout> | undefined;
  const stdoutReader = proc.stdout.getReader();
  const stderrReader = proc.stderr.getReader();
  const terminate = (code: SubprocessError["code"]) => {
    if (failure) return;
    failure = new SubprocessError(code);
    try { proc.kill("SIGTERM"); } catch { /* Already exited. */ }
    killTimer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch { /* Already reaped. */ }
      // Descendants must not leave our output collectors waiting on open pipes.
      pipeTimer = setTimeout(() => {
        void stdoutReader.cancel().catch(() => undefined);
        void stderrReader.cancel().catch(() => undefined);
      }, grace);
    }, grace);
  };
  const abort = () => terminate("process_aborted");
  const timer = setTimeout(() => terminate("process_timeout"), timeoutMs);
  opts.signal?.addEventListener("abort", abort, { once: true });
  if (opts.signal?.aborted) abort();
  async function collect(reader: typeof stdoutReader, limit: number): Promise<string> {
    const chunks: Buffer[] = [];
    let retained = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const available = Math.max(0, limit - retained);
        if (value.byteLength > available) terminate("process_output_limit");
        if (available > 0) {
          const chunk = Buffer.from(value.subarray(0, available));
          retained += chunk.byteLength;
          chunks.push(chunk);
        }
      }
    } catch { terminate("process_failed"); }
    return Buffer.concat(chunks).toString("utf8");
  }
  try {
    const [code, stdout, stderr] = await Promise.all([
      proc.exited,
      collect(stdoutReader, opts.maxStdoutBytes ?? 64 * 1024),
      collect(stderrReader, opts.maxStderrBytes ?? 64 * 1024),
    ]);
    if (failure) throw failure;
    return { code, stdout, stderr };
  } finally {
    activeProcesses--;
    clearTimeout(timer);
    if (killTimer) clearTimeout(killTimer);
    if (pipeTimer) clearTimeout(pipeTimer);
    opts.signal?.removeEventListener("abort", abort);
    stdoutReader.releaseLock();
    stderrReader.releaseLock();
  }
}

/** HEIF decoding runs in its own killable process, never the receive process. */
export async function convertHeifIsolated(input: string, output: string, maxBytes: number, quality: number, opts: ProcessOptions = {}): Promise<void> {
  const result = await runBoundedProcess([process.execPath, fileURLToPath(import.meta.url), "--heif", input, output, String(maxBytes), String(quality)], opts);
  if (result.code !== 0) throw new SubprocessError("process_failed");
}

if (import.meta.main) {
  const [mode, input, output, rawMax, rawQuality] = process.argv.slice(2);
  try {
    if (mode !== "--heif" || !input || !output) throw new Error("invalid_arguments");
    const maxBytes = Number(rawMax);
    const quality = Number(rawQuality);
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > 100 * 1024 * 1024 || !Number.isInteger(quality) || quality < 1 || quality > 100) throw new Error("invalid_limits");
    const { open, lstat } = await import("node:fs/promises");
    const { constants } = await import("node:fs");
    const { dirname } = await import("node:path");
    const { heifToJpeg } = await import("heif2jpeg");
    if (dirname(input) !== dirname(output)) throw new Error("invalid_output");
    const stat = await lstat(input);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) throw new Error("invalid_input");
    const handle = await open(input, constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes: Buffer;
    try { bytes = await handle.readFile(); } finally { await handle.close(); }
    const jpeg = await heifToJpeg(bytes, { quality });
    if (jpeg.byteLength > maxBytes || jpeg.byteLength < 4 || jpeg[0] !== 255 || jpeg[1] !== 216) throw new Error("invalid_decoded_output");
    const out = await open(output, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await out.writeFile(jpeg); await out.sync(); } finally { await out.close(); }
  } catch {
    // Decoder diagnostics may contain user content or paths; keep stdout empty.
    process.exitCode = 1;
  }
}
