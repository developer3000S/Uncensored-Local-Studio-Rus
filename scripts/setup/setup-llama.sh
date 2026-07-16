#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
APP_DIR="$ROOT_DIR/app"
TOOLS_DIR="$APP_DIR/tools"
RELEASE="${LLAMA_RELEASE:-b9668}"
PLATFORM="$(uname -s)"
ARCH="$(uname -m)"

download_and_extract() {
  local asset="$1"
  local dest="$2"
  local archive="$TOOLS_DIR/$asset"
  local url="https://github.com/ggml-org/llama.cpp/releases/download/$RELEASE/$asset"

  if [[ -x "$dest/llama-server" ]]; then
    echo "   OK   llama.cpp backend already ready: $dest"
    return
  fi

  mkdir -p "$TOOLS_DIR" "$dest"
  rm -f "$archive" "$archive.part"
  echo "   >>   Downloading $asset"
  curl -fSL --progress-bar "$url" -o "$archive.part"
  mv "$archive.part" "$archive"
  if command -v python3 >/dev/null 2>&1; then
    python3 "$SCRIPT_DIR/extract_tar.py" --archive "$archive" --dest "$dest" --strip-components=1
  else
    tar -xzf "$archive" -C "$dest" --strip-components=1
  fi
  rm -f "$archive"
  chmod +x "$dest"/llama-* 2>/dev/null || true

  if [[ ! -x "$dest/llama-server" ]]; then
    echo "   XX   llama-server was not found after extracting $asset" >&2
    return 1
  fi
}

download_and_extract_optional() {
  local asset="$1"
  local dest="$2"
  local reason="$3"

  if [[ -x "$dest/llama-server" ]]; then
    echo "   OK   optional llama.cpp backend already ready: $dest"
    return 0
  fi

  if download_and_extract "$asset" "$dest"; then
    return 0
  fi

  echo "   !!   Skipping optional llama.cpp backend for $reason ($asset)" >&2
  rm -rf "$dest"
  return 0
}

has_command() {
  command -v "$1" >/dev/null 2>&1
}

has_linux_gpu_vendor() {
  local vendor="$1"
  [[ -d /sys/bus/pci/devices ]] || return 1
  grep -Ril "$vendor" /sys/bus/pci/devices/*/vendor >/dev/null 2>&1
}

build_llama_from_source() {
  local backend="$1" # "cpu", "vulkan", "cuda"
  local dest_dir="$2"
  
  if [[ -x "$dest_dir/llama-server" ]]; then
    echo "   OK   llama.cpp $backend backend already ready: $dest_dir"
    return 0
  fi

  echo "   >>   Building llama.cpp $backend backend from source..."
  local BUILD_DIR="/tmp/uais-build-llama"
  local JOBS="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"
  
  if [[ ! -d "$BUILD_DIR" ]]; then
    echo "   >>   Cloning llama.cpp..."
    git clone --depth 1 --branch "$RELEASE" https://github.com/ggml-org/llama.cpp.git "$BUILD_DIR" || {
      git clone https://github.com/ggml-org/llama.cpp.git "$BUILD_DIR"
      cd "$BUILD_DIR"
      git checkout -f "$RELEASE"
    }
  fi
  
  local PUSHED_DIR="$(pwd)"
  cd "$BUILD_DIR"
  git submodule update --init --recursive --depth 1 || git submodule update --init --recursive
  
  local build_subdir="build-$backend"
  rm -rf "$build_subdir" && mkdir "$build_subdir" && cd "$build_subdir"
  
  local cmake_flags="-DCMAKE_BUILD_TYPE=Release"
  if [[ "$backend" == "vulkan" ]]; then
    cmake_flags="$cmake_flags -DGGML_VULKAN=ON"
  elif [[ "$backend" == "cuda" ]]; then
    cmake_flags="$cmake_flags -DGGML_CUDA=ON"
  fi

  if [[ "$PLATFORM" == "Darwin" ]]; then
    if [[ "$ARCH" == "x86_64" ]] && ! sysctl -a | grep machdep.cpu.features | grep -q AVX2; then
      echo "   >>   AVX2 is not supported by CPU, disabling AVX2/FMA for compilation."
      cmake_flags="$cmake_flags -DGGML_AVX2=OFF -DGGML_FMA=OFF"
    fi
  elif [[ "$PLATFORM" == "Linux" ]]; then
    if [[ "$ARCH" == "x86_64" || "$ARCH" == "amd64" ]] && ! grep -q avx2 /proc/cpuinfo; then
      echo "   >>   AVX2 is not supported by CPU, disabling AVX2/FMA for compilation."
      cmake_flags="$cmake_flags -DGGML_AVX2=OFF -DGGML_FMA=OFF"
    fi
  fi
  
  echo "   >>   Running cmake for llama.cpp $backend backend..."
  if cmake .. $cmake_flags && cmake --build . --config Release -j"$JOBS"; then
    mkdir -p "$dest_dir"
    local server_bin=""
    local cli_bin=""
    if [[ -f bin/llama-server ]]; then
      server_bin="bin/llama-server"
    elif [[ -f llama-server ]]; then
      server_bin="llama-server"
    fi
    
    if [[ -f bin/llama-cli ]]; then
      cli_bin="bin/llama-cli"
    elif [[ -f llama-cli ]]; then
      cli_bin="llama-cli"
    fi
    
    if [[ -n "$server_bin" ]]; then
      cp "$server_bin" "$dest_dir/llama-server"
      chmod +x "$dest_dir/llama-server"
    else
      echo "   XX   Build succeeded but llama-server was not found." >&2
      cd "$PUSHED_DIR"
      return 1
    fi
    
    if [[ -n "$cli_bin" ]]; then
      cp "$cli_bin" "$dest_dir/llama-cli"
      chmod +x "$dest_dir/llama-cli"
    fi
    
    find bin . -maxdepth 2 -type f -name "llama-*" -not -name "*.*" -exec cp {} "$dest_dir/" \; 2>/dev/null || true
    find . -maxdepth 2 \( -type f -o -type l \) \( -name "*.so" -o -name "*.so.*" -o -name "*.dylib" -o -name "*.dylib.*" \) -exec cp -L {} "$dest_dir/" \; 2>/dev/null || true
    
    echo "   OK   llama.cpp $backend backend compiled and installed successfully from source."
    cd "$PUSHED_DIR"
    return 0
  else
    echo "   XX   llama.cpp $backend backend build from source failed." >&2
    cd "$PUSHED_DIR"
    return 1
  fi
}

if [[ "$PLATFORM" == "Darwin" ]]; then
  if [[ "$ARCH" == "arm64" ]]; then
    download_and_extract "llama-$RELEASE-bin-macos-arm64.tar.gz" "$APP_DIR/llm-backend/mac/arm64"
  else
    download_and_extract "llama-$RELEASE-bin-macos-x64.tar.gz" "$APP_DIR/llm-backend/mac/x64"
    if ! "$APP_DIR/llm-backend/mac/x64/llama-server" --help >/dev/null 2>&1; then
      echo "   >>   Precompiled llama-server failed to execute (likely due to missing CPU features like AVX2)."
      echo "   >>   Removing incompatible precompiled binary and compiling from source..."
      rm -rf "$APP_DIR/llm-backend/mac/x64"
      build_llama_from_source cpu "$APP_DIR/llm-backend/mac/x64"
    fi
  fi
elif [[ "$PLATFORM" == "Linux" ]]; then
  if [[ "${UAIS_FORCE_COMPILE:-0}" == "1" ]]; then
    if has_command nvidia-smi || has_linux_gpu_vendor "0x10de"; then
      build_llama_from_source cuda "$APP_DIR/llm-backend/linux/cuda" || true
    fi
    build_llama_from_source vulkan "$APP_DIR/llm-backend/linux/vulkan" || true
    build_llama_from_source cpu "$APP_DIR/llm-backend/linux/cpu"
  elif [[ "$ARCH" == "aarch64" || "$ARCH" == "arm64" ]]; then
    download_and_extract "llama-$RELEASE-bin-ubuntu-vulkan-arm64.tar.gz" "$APP_DIR/llm-backend/linux/vulkan"
    download_and_extract "llama-$RELEASE-bin-ubuntu-arm64.tar.gz" "$APP_DIR/llm-backend/linux/cpu"
  else
    if has_command nvidia-smi || has_linux_gpu_vendor "0x10de"; then
      download_and_extract_optional "llama-$RELEASE-bin-ubuntu-cuda-12.4-x64.tar.gz" "$APP_DIR/llm-backend/linux/cuda" "NVIDIA CUDA acceleration"
    fi
    if has_command rocminfo || has_linux_gpu_vendor "0x1002"; then
      download_and_extract_optional "llama-$RELEASE-bin-ubuntu-rocm-x64.tar.gz" "$APP_DIR/llm-backend/linux/rocm" "AMD ROCm acceleration"
    fi
    if has_linux_gpu_vendor "0x8086"; then
      download_and_extract_optional "llama-$RELEASE-bin-ubuntu-sycl-fp32-x64.tar.gz" "$APP_DIR/llm-backend/linux/sycl" "Intel SYCL acceleration"
    fi
    download_and_extract "llama-$RELEASE-bin-ubuntu-vulkan-x64.tar.gz" "$APP_DIR/llm-backend/linux/vulkan"
    download_and_extract "llama-$RELEASE-bin-ubuntu-x64.tar.gz" "$APP_DIR/llm-backend/linux/cpu"
  fi
else
  echo "Unsupported platform: $PLATFORM" >&2
  exit 1
fi
