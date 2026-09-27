#!/usr/bin/env python3
"""Transcribe a 16 kHz mono WAV with Moonshine small-streaming-en (local ORT).

Prints JSON to stdout: {"text": "...", "lines": [...]} on success,
or {"error": "...", "text": ""} on failure (exit 1).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODEL = (
    REPO_ROOT
    / "data"
    / "models"
    / "moonshine"
    / "small-streaming-en"
    / "quantized_26_08_21"
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Moonshine WAV transcription helper")
    parser.add_argument("--wav", required=True, help="Path to 16 kHz mono WAV")
    parser.add_argument(
        "--model",
        default=str(DEFAULT_MODEL),
        help="Directory containing Moonshine ORT assets",
    )
    args = parser.parse_args()

    wav_path = Path(args.wav)
    model_path = Path(args.model)

    if not wav_path.is_file():
        print(json.dumps({"error": f"wav not found: {wav_path}", "text": ""}))
        return 1
    if not model_path.is_dir():
        print(json.dumps({"error": f"model dir not found: {model_path}", "text": ""}))
        return 1

    try:
        from moonshine_voice import ModelArch, Transcriber
        from moonshine_voice.utils import load_wav_file
    except ImportError as err:
        print(json.dumps({"error": f"moonshine_voice import failed: {err}", "text": ""}))
        return 1

    try:
        audio_data, sample_rate = load_wav_file(str(wav_path))
        # load_wav_file may return numpy; convert to list of floats
        if hasattr(audio_data, "tolist"):
            audio_list = audio_data.tolist()
        else:
            audio_list = list(audio_data)

        transcriber = Transcriber(
            model_path=str(model_path),
            model_arch=ModelArch.SMALL_STREAMING,
        )
        try:
            transcript = transcriber.transcribe_without_streaming(
                audio_data=audio_list,
                sample_rate=int(sample_rate),
            )
            lines = []
            texts = []
            for line in getattr(transcript, "lines", []) or []:
                t = (getattr(line, "text", None) or "").strip()
                if t:
                    texts.append(t)
                    lines.append(
                        {
                            "text": t,
                            "start": getattr(line, "start_time", None),
                            "end": getattr(line, "end_time", None),
                        }
                    )
            text = " ".join(texts).strip()
            # Fallback streaming path if batch returned empty
            if not text:
                text = _stream_fallback(transcriber, audio_list, int(sample_rate))
                if text:
                    lines = [{"text": text}]
            print(json.dumps({"text": text, "lines": lines}, ensure_ascii=False))
            return 0
        finally:
            try:
                transcriber.close()
            except Exception:
                pass
    except Exception as err:
        print(json.dumps({"error": str(err), "text": ""}))
        return 1


def _stream_fallback(transcriber, audio_list, sample_rate: int) -> str:
    """start → add_audio → stop collect lines if batch STT is empty."""
    try:
        stream = transcriber.create_stream()
    except Exception:
        return ""
    collected: list[str] = []
    try:
        # Chunk ~0.5s at 16k
        chunk = max(1, sample_rate // 2)
        for i in range(0, len(audio_list), chunk):
            piece = audio_list[i : i + chunk]
            stream.add_audio(piece)
        result = stream.stop() if hasattr(stream, "stop") else None
        if result is not None:
            for line in getattr(result, "lines", []) or []:
                t = (getattr(line, "text", None) or "").strip()
                if t:
                    collected.append(t)
        # Some APIs expose completed lines on the stream
        for line in getattr(stream, "lines", []) or []:
            t = (getattr(line, "text", None) or "").strip()
            if t:
                collected.append(t)
    except Exception:
        return ""
    # dedupe while preserving order
    seen = set()
    out = []
    for t in collected:
        if t not in seen:
            seen.add(t)
            out.append(t)
    return " ".join(out).strip()


if __name__ == "__main__":
    sys.exit(main())
