import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureVoiceWav16k,
  voiceDisplayText,
  transcribeVoiceWav,
} from "./voice-stt.ts";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

function assertEqual(a: unknown, b: unknown, msg: string): void {
  const as = JSON.stringify(a);
  const bs = JSON.stringify(b);
  if (as !== bs) throw new Error(`${msg}\n got: ${as}\nwant: ${bs}`);
}

// voiceDisplayText with/without transcript
assertEqual(
  voiceDisplayText("note.caf", "audio/x-caf", 100, 2.1),
  "[voice] note.caf (audio/x-caf, 100 bytes, 2.1s)",
  "voice header",
);
assertEqual(
  voiceDisplayText("note.caf", "audio/x-caf", 100, 2.1, "hi there"),
  "[voice] note.caf (audio/x-caf, 100 bytes, 2.1s)\nhi there",
  "voice + transcript",
);

const dir = await mkdtemp(join(tmpdir(), "gpproof-voice-stt-"));
try {
  // Prefer existing note.wav next to a fake CAF
  const caf = join(dir, "Audio Message.caf");
  const wav = join(dir, "note.wav");
  await writeFile(caf, Buffer.from("not-real-caf"));
  await writeFile(wav, Buffer.from("RIFF")); // existence only for ensure path
  const ensured = await ensureVoiceWav16k(caf);
  assertEqual(ensured, wav, "prefer existing note.wav");

  // Mock python helper that prints JSON
  const mockPy = join(dir, "mock-python.sh");
  const mockScript = join(dir, "fake_stt.py");
  await writeFile(
    mockPy,
    `#!/bin/sh\nexec /usr/bin/python3 "$@"\n`,
    { mode: 0o755 },
  );
  await writeFile(
    mockScript,
    `import json,sys\nprint(json.dumps({"text":"can you hear this","lines":[]}))\n`,
  );
  const stt = await transcribeVoiceWav(wav, {
    pythonBin: mockPy,
    scriptPath: mockScript,
    modelPath: dir,
  });
  assertEqual(stt.text, "can you hear this", "mock stt text");
  assert(!stt.error, "mock stt no error");

  // Failure path: helper exits 1 with error JSON — still returns structured result
  const failScript = join(dir, "fail_stt.py");
  await writeFile(
    failScript,
    `import json,sys\nprint(json.dumps({"error":"boom","text":""}))\nsys.exit(1)\n`,
  );
  const fail = await transcribeVoiceWav(wav, {
    pythonBin: mockPy,
    scriptPath: failScript,
    modelPath: dir,
  });
  assertEqual(fail.text, "", "fail text empty");
  assert(!!fail.error && fail.error.includes("boom"), "fail error");
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log("ALL_VOICE_STT_TESTS_PASSED");
