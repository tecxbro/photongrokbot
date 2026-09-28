import { access, constants, lstat, open, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolveInstancePaths, assertPrivateFile } from "../../shared/instance-paths.mjs";
import { runBoundedProcess, publishMediaFile, type ProcessOptions } from "./subprocess.ts";

type InstancePaths = ReturnType<typeof resolveInstancePaths>;
export const MOONSHINE_PACKAGE_VERSION = "0.1.5";
export const MOONSHINE_MODEL_BUILD = "quantized_26_08_21";
export type VoiceOptions = ProcessOptions & { paths?: InstancePaths; ffmpegBin?: string; pythonBin?: string; scriptPath?: string; modelPath?: string; maxAudioSeconds?: number };
export type VoiceSttResult = { text: string; wavPath: string; error?: string };
export function moonshinePaths(paths: InstancePaths = resolveInstancePaths()) {
  return {
    python: join(paths.toolsDir, "moonshine-venv", "bin", "python"),
    script: fileURLToPath(new URL("../tools/moonshine_stt.py", import.meta.url)),
    model: join(paths.modelsDir, "moonshine", "small-streaming-en", MOONSHINE_MODEL_BUILD),
  };
}
async function exists(path: string): Promise<boolean> {
  try { await access(path, constants.F_OK); return true; } catch { return false; }
}

/** Read RIFF chunks, not extensions. Reject truncated data and invalid PCM layout. */
export async function inspectWav(path: string): Promise<{ sampleRate: number; channels: number; bits: number; format: number; dataBytes: number; seconds: number }> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 44 || stat.size > 100 * 1024 * 1024) throw new Error("invalid_wav_size");
    const read = async (length: number, position: number) => {
      const bytes = Buffer.alloc(length);
      const result = await handle.read(bytes, 0, length, position);
      if (result.bytesRead !== length) throw new Error("truncated_wav");
      return bytes;
    };
    const header = await read(12, 0);
    if (header.toString("ascii", 0, 4) !== "RIFF" || header.toString("ascii", 8, 12) !== "WAVE" || header.readUInt32LE(4) + 8 > stat.size) throw new Error("invalid_wav_header");
    const end = header.readUInt32LE(4) + 8;
    let format: { format: number; channels: number; sampleRate: number; bits: number; block: number; byteRate: number } | undefined;
    let dataBytes = 0;
    for (let position = 12; position + 8 <= end;) {
      const chunk = await read(8, position);
      const size = chunk.readUInt32LE(4);
      const kind = chunk.toString("ascii", 0, 4);
      if (position + 8 + size > end) throw new Error("truncated_wav_chunk");
      if (kind === "fmt ") {
        if (size < 16) throw new Error("invalid_wav_format");
        const fmt = await read(16, position + 8);
        format = { format: fmt.readUInt16LE(0), channels: fmt.readUInt16LE(2), sampleRate: fmt.readUInt32LE(4), byteRate: fmt.readUInt32LE(8), block: fmt.readUInt16LE(12), bits: fmt.readUInt16LE(14) };
      }
      if (kind === "data") dataBytes += size;
      position += 8 + size + (size % 2);
    }
    if (!format || !format.channels || !format.sampleRate || !format.bits || !format.block || !dataBytes || dataBytes % format.block || format.block !== format.channels * format.bits / 8 || format.byteRate !== format.sampleRate * format.block) throw new Error("invalid_wav_format");
    return { ...format, dataBytes, seconds: dataBytes / format.byteRate };
  } finally { await handle.close(); }
}

export async function ensureVoiceWav16k(audioPath: string, opts: VoiceOptions = {}): Promise<string> {
  const paths = opts.paths ?? resolveInstancePaths();
  const safeInput = await assertPrivateFile(audioPath, paths.inboundAttachmentsDir);
  const maxSeconds = opts.maxAudioSeconds ?? 300;
  if (!Number.isFinite(maxSeconds) || maxSeconds <= 0 || maxSeconds > 1800) throw new Error("invalid_audio_duration_limit");
  if ((await lstat(safeInput)).size > 100 * 1024 * 1024) throw new Error("voice_input_too_large");
  try {
    const existing = await inspectWav(safeInput);
    if (existing.seconds > maxSeconds) throw new Error("voice_duration_limit");
    if (existing.format === 1 && existing.sampleRate === 16000 && existing.channels === 1 && existing.bits === 16) return safeInput;
  } catch (error) {
    if (error instanceof Error && error.message === "voice_duration_limit") throw error;
    // Non-WAV and malformed input must go through the bounded decoder.
  }
  const dir = dirname(safeInput);
  const id = randomUUID();
  const temporary = join(dir, `.${id}.partial.wav`);
  const output = join(dir, `${id}-16k.wav`);
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  await handle.close();
  const maxOutput = Math.ceil(maxSeconds * 16000 * 2 + 4096);
  try {
    const result = await runBoundedProcess([
      opts.ffmpegBin ?? "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
      "-threads", "1", "-max_alloc", "67108864", "-protocol_whitelist", "file,pipe", "-format_whitelist", "aac,aiff,asf,avi,caf,flac,matroska,webm,mov,mp3,ogg,wav", "-i", safeInput,
      "-map", "0:a:0", "-vn", "-sn", "-dn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", "-threads", "1", "-fs", String(maxOutput), "-f", "wav", temporary,
    ], { ...opts, timeoutMs: opts.timeoutMs ?? 30_000 });
    if (result.code !== 0) throw new Error("ffmpeg_failed");
    await assertPrivateFile(temporary, paths.inboundAttachmentsDir);
    const info = await inspectWav(temporary);
    if (info.format !== 1 || info.sampleRate !== 16000 || info.channels !== 1 || info.bits !== 16 || info.seconds > maxSeconds || (await lstat(temporary)).size >= maxOutput) throw new Error("invalid_decoded_wav");
    opts.signal?.throwIfAborted();
    await publishMediaFile(temporary, output);
    return output;
  } finally { await rm(temporary, { force: true }); }
}

export async function transcribeVoiceWav(wavPath: string, opts: VoiceOptions = {}): Promise<VoiceSttResult> {
  try {
    const paths = opts.paths ?? resolveInstancePaths();
    const defaults = moonshinePaths(paths);
    const python = opts.pythonBin ?? defaults.python;
    const script = opts.scriptPath ?? defaults.script;
    const model = opts.modelPath ?? defaults.model;
    await assertPrivateFile(wavPath, paths.inboundAttachmentsDir);
    const wav = await inspectWav(wavPath);
    if (wav.format !== 1 || wav.sampleRate !== 16000 || wav.channels !== 1 || wav.bits !== 16 || wav.seconds > (opts.maxAudioSeconds ?? 300)) throw new Error("stt_requires_16k_mono_pcm16");
    if (!(await exists(python)) || !(await exists(script)) || !(await exists(model))) throw new Error("moonshine_setup_incomplete");
    const result = await runBoundedProcess([python, script, "--wav", wavPath, "--model", model], { ...opts, timeoutMs: opts.timeoutMs ?? 120_000 });
    let parsed: { text?: unknown; error?: unknown };
    try { parsed = JSON.parse(result.stdout.trim()); } catch { throw new Error("stt_invalid_json"); }
    if (!parsed || typeof parsed !== "object" || result.code !== 0 || parsed.error) throw new Error("moonshine_transcription_failed");
    const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
    if (!text) throw new Error("moonshine_empty_transcript");
    return { text, wavPath };
  } catch (error) {
    // Fixed internal codes only: do not return raw child stderr or credential-bearing errors.
    const safe = error instanceof Error && /^[a-z0-9_]+$/.test(error.message) ? error.message : "moonshine_transcription_failed";
    return { text: "", wavPath, error: safe };
  }
}
export async function transcribeInboundVoice(attachmentPath: string, opts: VoiceOptions = {}): Promise<VoiceSttResult> {
  try { return await transcribeVoiceWav(await ensureVoiceWav16k(attachmentPath, opts), opts); }
  catch (error) { return { text: "", wavPath: attachmentPath, error: error instanceof Error && /^[a-z0-9_]+$/.test(error.message) ? error.message : "voice_decode_failed" }; }
}
export function voiceDisplayText(name: string, mimeType: string, bytes?: number, duration?: number, transcript?: string): string {
  const header = `[voice] ${name} (${mimeType}${typeof bytes === "number" && bytes > 0 ? `, ${bytes} bytes` : ""}${typeof duration === "number" && duration >= 0 ? `, ${duration}s` : ""})`;
  return transcript?.trim() ? `${header}\n${transcript.trim()}` : header;
}
if (import.meta.main) {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--wav");
  const path = idx >= 0 ? args[idx + 1] : undefined;
  if (!path) { console.error("usage: bun run src/voice-stt.ts --wav <private-inbound-path>"); process.exit(2); }
  const result = await transcribeInboundVoice(path);
  console.log(JSON.stringify(result));
  process.exit(result.error ? 1 : 0);
}
