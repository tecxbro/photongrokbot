import { access, constants } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const MOONSHINE_VENV_PYTHON = join(ROOT, ".venv-moonshine", "bin", "python");
export const MOONSHINE_STT_SCRIPT = join(ROOT, "tools", "moonshine_stt.py");
export const MOONSHINE_MODEL_DIR = join(
  ROOT,
  "data",
  "models",
  "moonshine",
  "small-streaming-en",
  "quantized_26_08_21",
);

export type VoiceSttResult = {
  text: string;
  wavPath: string;
  error?: string;
};

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure a 16 kHz mono WAV exists next to the inbound voice file.
 * Prefers existing note.wav / transcript-input.wav; otherwise ffmpeg from CAF/m4a/etc.
 */
export async function ensureVoiceWav16k(
  audioPath: string,
  opts?: { ffmpegBin?: string },
): Promise<string> {
  const dir = dirname(audioPath);
  const ext = extname(audioPath).toLowerCase();
  const candidates = [
    join(dir, "note.wav"),
    join(dir, "transcript-input.wav"),
  ];
  if (ext === ".wav") {
    candidates.unshift(audioPath);
  }
  for (const c of candidates) {
    if (await pathExists(c)) return c;
  }

  const outPath = join(dir, "note.wav");
  const ffmpeg = opts?.ffmpegBin ?? "ffmpeg";
  const proc = Bun.spawn(
    [
      ffmpeg,
      "-y",
      "-i",
      audioPath,
      "-ar",
      "16000",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      outPath,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const code = await proc.exited;
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error(
      `ffmpeg CAF→16k wav failed (exit ${code}): ${err.slice(0, 400)}`,
    );
  }
  if (!(await pathExists(outPath))) {
    throw new Error(`ffmpeg reported success but missing ${outPath}`);
  }
  return outPath;
}

/**
 * Run Moonshine STT via the venv Python helper. Returns transcript text (may be empty).
 * Never throws for STT failures — sets result.error instead.
 */
export async function transcribeVoiceWav(
  wavPath: string,
  opts?: {
    pythonBin?: string;
    scriptPath?: string;
    modelPath?: string;
    timeoutMs?: number;
  },
): Promise<VoiceSttResult> {
  const python = opts?.pythonBin ?? MOONSHINE_VENV_PYTHON;
  const script = opts?.scriptPath ?? MOONSHINE_STT_SCRIPT;
  const model = opts?.modelPath ?? MOONSHINE_MODEL_DIR;
  const timeoutMs = opts?.timeoutMs ?? 120_000;

  if (!(await pathExists(python))) {
    return {
      text: "",
      wavPath,
      error: `moonshine venv python missing: ${python}`,
    };
  }
  if (!(await pathExists(script))) {
    return { text: "", wavPath, error: `stt script missing: ${script}` };
  }

  try {
    const proc = Bun.spawn(
      [python, script, "--wav", wavPath, "--model", model],
      { stdout: "pipe", stderr: "pipe" },
    );
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
    }, timeoutMs);
    const [code, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    clearTimeout(timer);

    const trimmed = stdout.trim();
    let parsed: { text?: string; error?: string } = {};
    try {
      parsed = trimmed ? JSON.parse(trimmed) : {};
    } catch {
      return {
        text: "",
        wavPath,
        error: `stt non-JSON stdout (exit ${code}): ${trimmed.slice(0, 200) || stderr.slice(0, 200)}`,
      };
    }
    const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
    if (code !== 0 || parsed.error) {
      return {
        text,
        wavPath,
        error: parsed.error ?? `stt exit ${code}: ${stderr.slice(0, 200)}`,
      };
    }
    return { text, wavPath };
  } catch (err) {
    return { text: "", wavPath, error: String(err) };
  }
}

/** Full pipeline: ensure 16k wav + Moonshine STT. */
export async function transcribeInboundVoice(
  attachmentPath: string,
): Promise<VoiceSttResult> {
  try {
    const wavPath = await ensureVoiceWav16k(attachmentPath);
    return await transcribeVoiceWav(wavPath);
  } catch (err) {
    return {
      text: "",
      wavPath: attachmentPath,
      error: String(err),
    };
  }
}

export function voiceDisplayText(
  name: string,
  mimeType: string,
  bytes?: number,
  duration?: number,
  transcript?: string,
): string {
  const size =
    typeof bytes === "number" && bytes > 0 ? `, ${bytes} bytes` : "";
  const dur =
    typeof duration === "number" && duration >= 0 ? `, ${duration}s` : "";
  const header = `[voice] ${name} (${mimeType}${size}${dur})`;
  const t = transcript?.trim();
  return t ? `${header}\n${t}` : header;
}

/** CLI: bun run src/voice-stt.ts --wav <path> */
if (import.meta.main) {
  const args = process.argv.slice(2);
  const wavIdx = args.indexOf("--wav");
  const pathArg =
    wavIdx >= 0 ? args[wavIdx + 1] : args.find((a) => !a.startsWith("-"));
  if (!pathArg) {
    console.error("usage: bun run src/voice-stt.ts --wav <path>");
    process.exit(2);
  }
  const result = await transcribeInboundVoice(pathArg);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.error && !result.text ? 1 : 0);
}
