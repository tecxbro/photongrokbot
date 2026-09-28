import { test, expect, afterAll } from "bun:test";
import { mkdir, mkdtemp, realpath, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveInstancePaths, ensureInstancePaths } from "../../shared/instance-paths.mjs";
import { ensureVoiceWav16k, inspectWav, voiceDisplayText, transcribeVoiceWav, moonshinePaths } from "./voice-stt.ts";
import { runBoundedProcess } from "./subprocess.ts";
if (process.env.PHOTON_TEST_MODE !== "1") throw new Error("TEST_GUARD_REQUIRED");
const root = await mkdtemp(join(await realpath(tmpdir()), "photon-voice-test-"));
const paths = resolveInstancePaths({ instanceDir: root, env: { PHOTON_TEST_MODE: "1" } });
ensureInstancePaths(paths);
afterAll(() => rm(root, { recursive: true, force: true }));
function wav(rate = 16000, channels = 1): Buffer {
  const bytes = rate * channels * 2 / 10;
  const out = Buffer.alloc(44 + bytes);
  out.write("RIFF"); out.writeUInt32LE(out.length - 8, 4); out.write("WAVEfmt ", 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(channels, 22);
  out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate * channels * 2, 28); out.writeUInt16LE(channels * 2, 32);
  out.writeUInt16LE(16, 34); out.write("data", 36); out.writeUInt32LE(bytes, 40);
  return out;
}
async function input(name: string, bytes: Buffer): Promise<string> {
  const path = join(paths.inboundAttachmentsDir, name);
  await writeFile(path, bytes, { mode: 0o600 });
  return path;
}
async function mockDecoder(name: string, code: string): Promise<string> {
  const path = join(paths.toolsDir, name);
  await writeFile(path, `#!${process.execPath}\n${code}`, { mode: 0o700 });
  return path;
}

test("voice display preserves duration/transcript; model paths are instance-owned", () => {
  expect(voiceDisplayText("note.caf", "audio/x-caf", 100, 2.1)).toBe("[voice] note.caf (audio/x-caf, 100 bytes, 2.1s)");
  expect(voiceDisplayText("note.caf", "audio/x-caf", 100, 2.1, "hi there")).toBe("[voice] note.caf (audio/x-caf, 100 bytes, 2.1s)\nhi there");
  expect(moonshinePaths(paths).python).toBe(join(paths.toolsDir, "moonshine-venv/bin/python"));
  expect(moonshinePaths(paths).model.startsWith(paths.modelsDir)).toBe(true);
});

test("valid mono PCM WAV reused regardless of extension; unrelated note.wav ignored", async () => {
  const path = await input("actually.caf", wav());
  await input("note.wav", Buffer.from("RIFF"));
  expect(await ensureVoiceWav16k(path, { paths, ffmpegBin: "/missing" })).toBe(path);
  expect((await inspectWav(path)).sampleRate).toBe(16000);
});

test("stereo and non-16k WAV are decoded; different inputs never share an output", async () => {
  const ffmpegBin = await mockDecoder("ffmpeg-ok", `await Bun.write(process.argv.at(-1),Buffer.from('${wav().toString("base64")}','base64'));`);
  const stereo = await input("stereo.wav", wav(16000, 2));
  const otherRate = await input("44100.wav", wav(44100));
  const one = await ensureVoiceWav16k(stereo, { paths, ffmpegBin });
  const two = await ensureVoiceWav16k(otherRate, { paths, ffmpegBin });
  expect(one).not.toBe(two);
  expect(one).not.toBe(stereo);
  expect((await inspectWav(one)).channels).toBe(1);
  expect((await inspectWav(two)).sampleRate).toBe(16000);
});

test("malformed, truncated or decoder-invalid WAV never becomes ready", async () => {
  const truncated = wav(); truncated.writeUInt32LE(999999, 40);
  const path = await input("truncated.wav", truncated);
  await expect(inspectWav(path)).rejects.toThrow("truncated_wav_chunk");
  const ffmpegBin = await mockDecoder("ffmpeg-bad", "await Bun.write(process.argv.at(-1),'RIFF');");
  const before = await readdir(paths.inboundAttachmentsDir);
  await expect(ensureVoiceWav16k(path, { paths, ffmpegBin })).rejects.toThrow("invalid_wav_size");
  expect(await readdir(paths.inboundAttachmentsDir)).toEqual(before);
});

test("hung FFmpeg is reaped and partial output removed", async () => {
  const ffmpegBin = await mockDecoder("ffmpeg-hung", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000);");
  const path = await input("hung.caf", Buffer.from("not-real-caf"));
  const before = await readdir(paths.inboundAttachmentsDir);
  await expect(ensureVoiceWav16k(path, { paths, ffmpegBin, timeoutMs: 60, killGraceMs: 10 })).rejects.toThrow("process_timeout");
  expect(await readdir(paths.inboundAttachmentsDir)).toEqual(before);
});

test("STT structured success; failed and empty transcripts are explicit degradation", async () => {
  const path = await input("transcribe.wav", wav());
  const script = join(paths.toolsDir, "fake_stt.py");
  const opts = { paths, pythonBin: "/usr/bin/python3", scriptPath: script, modelPath: paths.modelsDir };
  await writeFile(script, 'import json\nprint(json.dumps({"text":"can you hear this","lines":[]}))\n');
  expect(await transcribeVoiceWav(path, opts)).toEqual({ text: "can you hear this", wavPath: path });
  await writeFile(script, 'import json,sys\nprint(json.dumps({"error":"secret-do-not-surface","text":""}))\nsys.exit(1)\n');
  expect((await transcribeVoiceWav(path, opts)).error).toBe("moonshine_transcription_failed");
  await writeFile(script, 'print("{\\"text\\":\\"\\"}")\n');
  expect((await transcribeVoiceWav(path, opts)).error).toBe("moonshine_empty_transcript");
  expect((await transcribeVoiceWav(await input("bad-stt.wav", wav(44100)), opts)).error).toBe("stt_requires_16k_mono_pcm16");
});

test("Python helper uses verified batch API and closes transcriber on empty output", async () => {
  const path = await input("python-helper.wav", wav());
  const helper = moonshinePaths(paths).script;
  const code = `import importlib.util,sys,types\nsys.dont_write_bytecode=True\nspec=importlib.util.spec_from_file_location('helper',${JSON.stringify(helper)})\nm=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\nclosed=[]\nclass T:\n def __init__(self,**kwargs): pass\n def transcribe_without_streaming(self,**kwargs): return types.SimpleNamespace(lines=[])\n def close(self): closed.append(True)\nsys.modules['moonshine_voice']=types.SimpleNamespace(Transcriber=T,ModelArch=types.SimpleNamespace(SMALL_STREAMING=4))\nsys.modules['moonshine_voice.utils']=types.SimpleNamespace(load_wav_file=lambda p:([0.0],16000))\ntry: m.transcribe(m.Path(${JSON.stringify(path)}),m.Path(${JSON.stringify(paths.modelsDir)}))\nexcept ValueError as e: assert str(e)=='moonshine_empty_transcript'\nassert closed==[True]\nprint('CLOSED')\n`;
  const result = await runBoundedProcess(["/usr/bin/python3", "-c", code]);
  expect(result.code).toBe(0);
  expect(result.stdout.trim()).toBe("CLOSED");
});
