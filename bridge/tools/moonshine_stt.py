#!/usr/bin/env python3
"""Pinned local Moonshine helper. JSON stdout; no downloads or network.

--verify-installation verifies packages and immutable model bytes. The bridge
owns the wall-clock deadline, drains both pipes, and reaps this process.
"""
from __future__ import annotations
import argparse
import contextlib
import hashlib
import importlib.metadata
import json
import os
import stat
import sys
import wave
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_ROOT = Path(os.environ.get("PHOTON_INSTANCE_DIR", "/workspace/photongrokbot-state"))
DEFAULT_MODEL = DEFAULT_ROOT / "models/moonshine/small-streaming-en/quantized_26_08_21"


@contextlib.contextmanager
def diagnostics_to_stderr():
    """Redirect native-library stdout too, preserving the JSON protocol."""
    sys.stdout.flush()
    original = os.dup(1)
    try:
        os.dup2(2, 1)
        yield
    finally:
        sys.stdout.flush()
        os.dup2(original, 1)
        os.close(original)


def private_regular_file(path: Path) -> None:
    absolute = path.absolute()
    for parent in [absolute, *absolute.parents]:
        if parent.is_symlink():
            raise ValueError("model_symlink_rejected")
    if not stat.S_ISREG(absolute.stat().st_mode):
        raise ValueError("model_file_required")


def verify_installation(model_path: Path) -> dict:
    manifest_bytes = (HERE / "moonshine-model.json").read_bytes()
    manifest = json.loads(manifest_bytes)
    versions = {}
    for raw in (HERE / "moonshine-requirements.txt").read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        package, expected = line.split("==")
        actual = importlib.metadata.version(package)
        if actual != expected:
            raise ValueError("moonshine_dependency_version_mismatch")
        versions[package] = actual
    for name, expected in manifest["files"].items():
        if Path(name).name != name:
            raise ValueError("invalid_model_manifest")
        path = model_path / name
        private_regular_file(path)
        size = path.stat().st_size
        if size != expected["bytes"]:
            raise ValueError("moonshine_model_size_mismatch")
        digest = hashlib.sha256() if "sha256" in expected else hashlib.sha1()
        if "gitBlobSha1" in expected:
            digest.update(f"blob {size}\0".encode())
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
        if digest.hexdigest() != expected.get("sha256", expected.get("gitBlobSha1")):
            raise ValueError("moonshine_model_hash_mismatch")
    from moonshine_voice import ModelArch, Transcriber  # noqa: F401
    if int(ModelArch.SMALL_STREAMING) != manifest["modelArch"]:
        raise ValueError("moonshine_arch_mismatch")
    return {"verified": True, "modelRevision": manifest["revision"], "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(), "packages": versions}


def apply_limits() -> None:
    try:
        import resource
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        resource.setrlimit(resource.RLIMIT_FSIZE, (100 * 1024 * 1024,) * 2)
        resource.setrlimit(resource.RLIMIT_CPU, (100, 105))
        if sys.platform.startswith("linux"):
            resource.setrlimit(resource.RLIMIT_AS, (2 * 1024**3,) * 2)
    except (ImportError, ValueError, OSError):
        # cgroup availability is an operator gate. Parent still enforces deadlines.
        pass


def transcribe(wav_path: Path, model_path: Path) -> dict:
    private_regular_file(wav_path)
    with wave.open(str(wav_path), "rb") as source:
        if source.getnchannels() != 1 or source.getframerate() != 16000 or source.getsampwidth() != 2 or source.getcomptype() != "NONE":
            raise ValueError("stt_requires_16k_mono_pcm16")
        if not 0 < source.getnframes() <= 16000 * 300:
            raise ValueError("voice_duration_limit")
    from moonshine_voice import ModelArch, Transcriber
    from moonshine_voice.utils import load_wav_file
    audio_data, sample_rate = load_wav_file(str(wav_path))
    # Verified 0.1.5 wheel API: Transcript.lines and close(). No guessed streaming.
    transcriber = Transcriber(model_path=str(model_path), model_arch=ModelArch.SMALL_STREAMING)
    try:
        transcript = transcriber.transcribe_without_streaming(audio_data=list(audio_data), sample_rate=sample_rate)
        lines = [{"text": line.text.strip()} for line in transcript.lines if line.text and line.text.strip()]
        text = " ".join(line["text"] for line in lines)
        if not text:
            raise ValueError("moonshine_empty_transcript")
        return {"text": text, "lines": lines}
    finally:
        transcriber.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify/transcribe pinned local Moonshine installation")
    parser.add_argument("--wav")
    parser.add_argument("--model", default=str(DEFAULT_MODEL))
    parser.add_argument("--verify-installation", action="store_true")
    args = parser.parse_args()
    apply_limits()
    try:
        with diagnostics_to_stderr():
            receipt = verify_installation(Path(args.model))
            if args.verify_installation:
                result = receipt
            elif args.wav:
                result = transcribe(Path(args.wav), Path(args.model))
            else:
                raise ValueError("wav_required")
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as error:
        code = str(error) if isinstance(error, ValueError) and str(error).replace("_", "").isalnum() else "moonshine_setup_or_transcription_failed"
        print(json.dumps({"error": code, "text": ""}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
