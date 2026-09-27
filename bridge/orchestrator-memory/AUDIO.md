# Audio / voice notes — Photon Spectrum bridge

## Outbound (audio-message bubble)

```bash
bun run enqueue -- --space-id "<spaceId>" --voice /absolute/path/to/note.m4a
bun run enqueue -- --space-id "<spaceId>" --voice /path/note.wav --duration 3
```

Or `enqueueOutbound({ kind: "voice", spaceId, audioPath, durationSeconds? })`.

Uses Spectrum `voice(path)` → upload + `sendAttachment(..., { isAudioMessage: true })` so iMessage shows the waveform play UI (not a generic file).

Prefer `.m4a` / AAC. Spectrum may remux other formats via `ensureM4a`.

## Inbound

Authorized inbound `content.type === "voice"` is downloaded like attachments and stored under `data/inbound-attachments/<messageId>/`.

### STT (Moonshine)

Inbound voice is transcribed locally with **Moonshine** `small-streaming-en` quantized build `quantized_26_08_21` (ORT assets, ~214 MB):

- Model dir: `data/models/moonshine/small-streaming-en/quantized_26_08_21/`
- Python venv: `.venv-moonshine/` (`pip install moonshine-voice`)
- Helper: `tools/moonshine_stt.py` — `python tools/moonshine_stt.py --wav <path>` → stdout JSON `{ "text": "..." }`
- Bun wrapper: `src/voice-stt.ts` (ensure 16 kHz mono WAV via ffmpeg if needed, then spawn venv python)

Flow after save:

1. Ensure `note.wav` (or `transcript-input.wav`) at 16 kHz mono next to the CAF/m4a (ffmpeg if missing).
2. Run Moonshine `ModelArch.SMALL_STREAMING` STT.
3. Attach `transcript` on the unread record and append it under the `[voice] …` display `text` so Front Door can direct-answer without inventing STT.
4. On STT failure, still enqueue the voice path (log error; no drop).

Unread records look like:

```json
{
  "kind": "voice",
  "text": "[voice] Audio Message.caf (audio/x-caf, 34591 bytes, 2.1s)\ncan you hear this",
  "transcript": "can you hear this",
  "attachmentPath": ".../Audio Message.caf",
  "attachmentMimeType": "audio/x-caf",
  "attachmentBytes": 34591,
  "attachmentDuration": 2.1
}
```

Front Door / unread batches may include the `transcript` field (string). Regular file attachments that happen to be audio stay `kind: "attachment"` unless Spectrum marks them as voice.

## Agent notes

- Sending a playable voice note → `--voice`, not `--attachment`.
- `--attachment` on an `.m4a` sends a normal file bubble.
- Architecture unchanged: same enqueue → runtime → Spectrum path. Do not change Front Door Step 2/3.
