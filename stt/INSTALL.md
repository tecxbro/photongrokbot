# Mandatory pinned Moonshine installation

Initial setup must verify local Moonshine before readiness. Models are downloaded during explicitly authorized setup; they are not shipped in the source and are never downloaded on ordinary runtime restart. Later transcription failure is a reported degraded media state while text remains available.

Read the [operating contract](../docs/product-repair/OPERATING_CONTRACT.md). Select/initialize the canonical private instance first. All paths below use its verified explicit PHOTON_INSTANCE_DIR; never use the code checkout as model or venv storage.

## Frozen inputs

- Python package moonshine-voice 0.1.5, with the complete exact dependency set in [moonshine-requirements.txt](../bridge/tools/moonshine-requirements.txt).
- Model small-streaming-en, build quantized_26_08_21, architecture enum 4.
- Immutable asset revision `0bf2f2e5aff22e6fbba4300b00a4e00bbc4f8aae`; [moonshine-model.json](../bridge/tools/moonshine-model.json) gives every file size and SHA-256 or Git blob hash.
- Python 3.10+ and ffmpeg/ffprobe must be available on the actual VM. Confirm installed versions; no implicit package upgrade.

From bridge/ after private bootstrap:

```sh
python3 -m venv --copies "$PHOTON_INSTANCE_DIR/tools/moonshine-venv"
"$PHOTON_INSTANCE_DIR/tools/moonshine-venv/bin/python" -m pip install --no-deps -r tools/moonshine-requirements.txt
```

On resume, reuse the existing venv and inspect installed versions rather than recreating it. Obtain the nine manifest files from the official `moonshine-ai/moonshine-voice-assets` repository at that exact revision, under `model/small-streaming-en/quantized_26_08_21`. Store them in `$PHOTON_INSTANCE_DIR/models/moonshine/small-streaming-en/quantized_26_08_21`. Create model directories with mode 0700 and model files with mode 0600. Use private temporary files and atomic replacement after verification; do not symlink a model cache, fetch moving main, or substitute a different model when a file is missing. The immutable download URL pattern is `https://huggingface.co/moonshine-ai/moonshine-voice-assets/resolve/0bf2f2e5aff22e6fbba4300b00a4e00bbc4f8aae/model/small-streaming-en/quantized_26_08_21/<manifest-filename>`.

## Verify actual installation

```sh
bun run setup-state -- verify-moonshine
```

This executes the private Python helper with bounded time/output, checks every frozen package/file, imports the installed API, and stores model revision, manifest digest and package versions in setup evidence. Directory existence or a hand-written success flag is insufficient. No model inference or download was executed during the offline repair tests; actual VM model/native behavior remains a deployment gate.

For an authorized private 16kHz mono WAV, the actual helper invocation is:

```sh
"$PHOTON_INSTANCE_DIR/tools/moonshine-venv/bin/python" tools/moonshine_stt.py --wav "$PRIVATE_WAV_PATH" --model "$PHOTON_INSTANCE_DIR/models/moonshine/small-streaming-en/quantized_26_08_21"
```

Its JSON transcript is private data, not a diagnostic to paste into chat. Runtime conversions, process limits, retries and temporary cleanup belong to the bounded media worker. Preserve original audio and honest unavailable/failed state if any step fails.
