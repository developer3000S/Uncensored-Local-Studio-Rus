#!/usr/bin/env python3
"""
Whisper STT worker using OpenAI Whisper (PyTorch) as a replacement for whisper.cpp.
Reads JSON payload from stdin, writes JSON result to stdout.
"""
import json
import os
import sys
from pathlib import Path

import torch
import whisper

MODEL_CACHE_DIR = Path(os.environ.get("WHISPER_MODEL_CACHE", str(Path.home() / ".cache" / "whisper")))
SAMPLE_RATE = 16000

# Map GGML model filenames to OpenAI Whisper model names
MODEL_NAME_MAP = {
    "ggml-tiny.bin": "tiny",
    "ggml-tiny.en.bin": "tiny",
    "ggml-base.bin": "base",
    "ggml-base.en.bin": "base",
    "ggml-small.bin": "small",
    "ggml-small.en.bin": "small",
    "ggml-medium.bin": "medium",
    "ggml-large-v3.bin": "large-v3",
    "ggml-large-v3-turbo.bin": "large-v3",
}

# Map custom model filenames (with spaces/special chars) by matching keywords
CUSTOM_MODEL_MAP = {
    "tiny": "tiny",
    "base": "base",
    "small": "small",
    "medium": "medium",
    "large-v3": "large-v3",
    "large": "large-v3",
}


def resolve_model_name(filename_or_id):
    """Resolve a model filename or ID to an OpenAI Whisper model name."""
    # Direct match
    if filename_or_id in MODEL_NAME_MAP:
        return MODEL_NAME_MAP[filename_or_id]

    # Try case-insensitive match
    lower = filename_or_id.lower()
    for key, value in MODEL_NAME_MAP.items():
        if key.lower() == lower:
            return value

    # Keyword match for custom filenames
    for keyword, model_name in CUSTOM_MODEL_MAP.items():
        if keyword in lower:
            return model_name

    # Default fallback
    return "base"


def ensure_model(model_name):
    """Ensure the Whisper model is downloaded and cached."""
    MODEL_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    # whisper.load_model handles downloading and caching automatically
    return model_name


def transcribe(audio_path, model_name="base", language="auto", translate=False):
    """Transcribe audio using OpenAI Whisper."""
    model = whisper.load_model(model_name, download_root=str(MODEL_CACHE_DIR))

    lang = None if language == "auto" else language
    result = model.transcribe(
        audio_path,
        language=lang,
        task="translate" if translate else "transcribe",
        verbose=False,
    )

    segments = []
    for seg in result.get("segments", []):
        segments.append({
            "start": seg.get("start", 0),
            "end": seg.get("end", 0),
            "text": seg.get("text", ""),
        })

    return {
        "text": result.get("text", "").strip(),
        "language": result.get("language", language),
        "segments": segments,
    }


def main():
    payload = json.loads(sys.stdin.read())
    audio_path = payload["audio_path"]
    model_filename = payload.get("model", "ggml-base.bin")
    language = payload.get("language", "auto")
    translate = payload.get("translate", False)

    model_name = resolve_model_name(model_filename)
    ensure_model(model_name)

    result = transcribe(audio_path, model_name, language, translate)

    sys.stdout.write(json.dumps({
        "ok": True,
        "text": result["text"],
        "language": result["language"],
        "segments": result["segments"],
    }))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
