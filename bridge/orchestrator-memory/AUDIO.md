# Audio and Moonshine

Moonshine 0.1.5 with the frozen small-streaming-en model revision is mandatory during first setup. [Installation](../../stt/INSTALL.md) pins package versions, files and checksums. The private paths are `tools/moonshine-venv` and `models/moonshine/small-streaming-en/quantized_26_08_21` below the instance root. Restarts never download or upgrade them.

Accepted voice first becomes durable metadata/media work. A bounded worker downloads, converts to 16kHz mono PCM when needed, transcribes, and persists a correlated result. Preserve original audio; remove owned temporary derivatives. Failure remains unavailable/failed and cannot swallow the batch or block later text. Do not claim a transcript exists until stored evidence says so. Audio received as an ordinary attachment stays an attachment unless the provider marks voice.

A playable outbound note uses canonical payload `{kind:"voice",spaceId,audioPath,durationSeconds?}` with a private staged file and current claim. A text attachment payload sends a generic file instead. Preserve actual duration and uncertainty; no second transport is needed. See the [operating contract](../../docs/product-repair/OPERATING_CONTRACT.md).
