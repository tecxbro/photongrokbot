# Moonshine STT install (required — bot runs this)

Inbound voice transcription is **mandatory** for this pack. The bot follows this guide during `skills/getting-started` setup on the **agent VM**.

This pack **omits** binary STT weights (`.ort`, `tokenizer.bin`) — they are large (~214 MB). **Download them; do not claim they shipped in the tarball.**

Live path expected by the bridge (`src/voice-stt.ts` / `tools/moonshine_stt.py`):

```text
data/models/moonshine/small-streaming-en/quantized_26_08_21/
```

| | |
|---|---|
| Model id | `small-streaming-en` |
| Build | `quantized_26_08_21` |
| Python package | `moonshine-voice` (live: 0.1.5) |
| Arch enum | `ModelArch.SMALL_STREAMING` = **4** |

## Expected files (match live tree)

```text
adapter.ort
cross_kv.ort
decoder_kv.ort
decoder_kv_with_attention.ort
encoder.ort
frontend.model.ort
frontend.weights.ort
streaming_config.json
tokenizer.bin
```

(~214 MB total — do not commit.)

## 1. Venv + package (bot runs on {{BRIDGE_ROOT}})

```bash
cd /path/to/bridge   # e.g. {{BRIDGE_ROOT}}
python3 -m venv .venv-moonshine
.venv-moonshine/bin/pip install -U pip
.venv-moonshine/bin/pip install -U moonshine-voice
# ffmpeg on PATH for CAF/m4a → 16 kHz mono wav
```

## 2. Preferred: Hugging Face mirror

Repo: https://huggingface.co/moonshine-ai/moonshine-voice-assets/tree/main/model/small-streaming-en/quantized_26_08_21

```bash
# pip install -U "huggingface_hub[cli]"   # provides `hf`
hf download moonshine-ai/moonshine-voice-assets \
  --include "model/small-streaming-en/quantized_26_08_21/**" \
  --local-dir moonshine-assets

mkdir -p data/models/moonshine/small-streaming-en
cp -a moonshine-assets/model/small-streaming-en/quantized_26_08_21 \
  data/models/moonshine/small-streaming-en/
# or symlink:
# ln -sfn "$(pwd)/moonshine-assets/model/small-streaming-en/quantized_26_08_21" \
#   data/models/moonshine/small-streaming-en/quantized_26_08_21
```

Alternate CLI: `huggingface-cli download moonshine-ai/moonshine-voice-assets --include "model/small-streaming-en/quantized_26_08_21/**" --local-dir moonshine-assets`

## 3. Alternate: Moonshine CDN / SDK

Official CDN (what the SDK uses; **not** Hugging Face):

`https://download.moonshine.ai/model/small-streaming-en/quantized_26_08_21/`

```bash
.venv-moonshine/bin/pip install -U moonshine-voice
.venv-moonshine/bin/python -m moonshine_voice.download \
  --stt --language en --model-arch 4 \
  --root /tmp/moonshine-dl
# SMALL_STREAMING = 4 on moonshine-voice 0.1.5 — verify if unsure:
#   .venv-moonshine/bin/python -c "from moonshine_voice import ModelArch; print(int(ModelArch.SMALL_STREAMING))"

# Layout under --root:
#   /tmp/moonshine-dl/download.moonshine.ai/model/small-streaming-en/quantized_26_08_21/
mkdir -p data/models/moonshine/small-streaming-en
cp -a /tmp/moonshine-dl/download.moonshine.ai/model/small-streaming-en/quantized_26_08_21 \
  data/models/moonshine/small-streaming-en/
```

CDN deps API lists most files above; live disk also has `decoder_kv_with_attention.ort`
(prefer the HF tree if CDN omits it).

## 4. ffmpeg

```bash
sudo apt-get install -y ffmpeg   # Debian/Ubuntu agent VM
```

`bridge/src/voice-stt.ts` converts with ffmpeg to 16 kHz mono PCM WAV before STT.

## 5. Verify (bot)

```bash
.venv-moonshine/bin/python tools/moonshine_stt.py --wav /path/to/16k.wav
# → JSON stdout: {"text":"...","lines":[...]}

python tools/moonshine-transcribe.py --wav /path/to/16k.wav   # prefers .venv-moonshine
```

Helpers may also sit under this pack’s `stt/`. Bun glue: `bridge/src/voice-stt.ts`.

Setup is incomplete until the model directory exists and the venv can import `moonshine_voice`.

## Note on HF vs CDN

The **SDK downloader** pulls from `download.moonshine.ai`. This pack documents **Hugging Face as the preferred replicate method**, with CDN/SDK as a working alternate.
