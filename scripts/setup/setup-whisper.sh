#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
APP_DIR="$ROOT_DIR/app"
TOOLS_DIR="$APP_DIR/tools"
RELEASE="${WHISPER_RELEASE:-v1.9.1}"
PLATFORM="$(uname -s)"
ARCH="$(uname -m)"

download_and_extract() {
  local asset="$1"
  local dest="$2"
  local archive="$TOOLS_DIR/$asset"
  local url="https://github.com/ggml-org/whisper.cpp/releases/download/$RELEASE/$asset"

  if [[ -x "$dest/whisper-cli" ]]; then
    echo "   OK   whisper.cpp speech backend already ready: $dest"
    return 0
  fi

  mkdir -p "$TOOLS_DIR" "$dest"
  rm -f "$archive" "$archive.part"
  echo "   >>   Downloading $asset"
  curl -fSL --progress-bar "$url" -o "$archive.part"
  mv "$archive.part" "$archive"
  tar -xzf "$archive" -C "$dest" --strip-components=1
  rm -f "$archive"
  chmod +x "$dest"/whisper-* "$dest"/main "$dest"/server 2>/dev/null || true

  if [[ ! -x "$dest/whisper-cli" && -x "$dest/main" ]]; then
    cp "$dest/main" "$dest/whisper-cli"
    chmod +x "$dest/whisper-cli"
  fi
  if [[ ! -x "$dest/whisper-server" && -x "$dest/server" ]]; then
    cp "$dest/server" "$dest/whisper-server"
    chmod +x "$dest/whisper-server"
  fi

  if [[ ! -x "$dest/whisper-cli" ]]; then
    echo "   XX   whisper-cli was not found after extracting $asset" >&2
    return 1
  fi
}

if [[ "$PLATFORM" == "Linux" ]]; then
  mkdir -p "$APP_DIR/speech-backend/linux/cpu" "$APP_DIR/speech-backend/linux/vulkan"
  if [[ ! -x "$APP_DIR/speech-backend/linux/cpu/whisper-cli" && -x "$APP_DIR/speech-backend/linux/whisper-cli" ]]; then
    cp "$APP_DIR/speech-backend/linux"/whisper-* "$APP_DIR/speech-backend/linux/cpu/" 2>/dev/null || true
    cp "$APP_DIR/speech-backend/linux"/main "$APP_DIR/speech-backend/linux/cpu/" 2>/dev/null || true
    cp "$APP_DIR/speech-backend/linux"/server "$APP_DIR/speech-backend/linux/cpu/" 2>/dev/null || true
    chmod +x "$APP_DIR/speech-backend/linux/cpu"/whisper-* "$APP_DIR/speech-backend/linux/cpu"/main "$APP_DIR/speech-backend/linux/cpu"/server 2>/dev/null || true
    echo "   OK   migrated existing whisper.cpp CPU backend to app/speech-backend/linux/cpu."
  fi
  if [[ "$ARCH" == "aarch64" || "$ARCH" == "arm64" ]]; then
    download_and_extract "whisper-bin-ubuntu-arm64.tar.gz" "$APP_DIR/speech-backend/linux/cpu"
  else
    download_and_extract "whisper-bin-ubuntu-x64.tar.gz" "$APP_DIR/speech-backend/linux/cpu"
  fi
  echo "   ..   CPU backend path: app/speech-backend/linux/cpu"
  echo "   ..   Optional Vulkan GPU backend path: app/speech-backend/linux/vulkan"
elif [[ "$PLATFORM" == "Darwin" ]]; then
  mkdir -p "$APP_DIR/speech-backend/mac/cpu" "$APP_DIR/speech-backend/mac/metal"
  if [[ ! -x "$APP_DIR/speech-backend/mac/cpu/whisper-cli" && -x "$APP_DIR/speech-backend/mac/whisper-cli" ]]; then
    cp "$APP_DIR/speech-backend/mac"/whisper-* "$APP_DIR/speech-backend/mac/cpu/" 2>/dev/null || true
    cp "$APP_DIR/speech-backend/mac"/main "$APP_DIR/speech-backend/mac/cpu/" 2>/dev/null || true
    cp "$APP_DIR/speech-backend/mac"/server "$APP_DIR/speech-backend/mac/cpu/" 2>/dev/null || true
    chmod +x "$APP_DIR/speech-backend/mac/cpu"/whisper-* "$APP_DIR/speech-backend/mac/cpu"/main "$APP_DIR/speech-backend/mac/cpu"/server 2>/dev/null || true
    echo "   OK   migrated existing whisper.cpp backend to app/speech-backend/mac/cpu."
  fi
  if [[ -x "$APP_DIR/speech-backend/mac/cpu/whisper-cli" || -x "$APP_DIR/speech-backend/mac/metal/whisper-cli" ]]; then
    echo "   OK   whisper.cpp macOS speech backend already ready."
  else
    echo "   !!   No official portable macOS whisper.cpp CLI archive is available for this setup script yet."
    echo "        Build whisper.cpp manually and copy whisper-cli to app/speech-backend/mac/cpu or app/speech-backend/mac/metal."
  fi
else
  echo "Unsupported platform: $PLATFORM" >&2
  exit 1
fi
