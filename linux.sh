#!/usr/bin/env bash
#
# Неприметная AI Studio — лаунчер для Linux
# Двойной клик или запуск: ./linux.sh
# Используйте --max-perf, чтобы при первом запуске включить загрузку ROCm backend на Linux.
#


set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$SCRIPT_DIR/app"
PLATFORM="$(uname -s)"

if [[ "$PLATFORM" != "Linux" ]]; then
  echo "[ОШИБКА] Этот скрипт предназначен только для Linux. На macOS запустите ./mac.sh." >&2

  exit 1
fi

NODE_DIR="$APP_DIR/tools/node-linux"
NODE_BIN="$NODE_DIR/bin/node"
BACKEND_PATH="$APP_DIR/backend/linux/vulkan/sd-vulkan"
CPU_BACKEND_PATH="$APP_DIR/backend/linux/cpu/sd-cpu"
PLATFORM_LABEL="Linux"

DIST_INDEX="$APP_DIR/dist/index.html"
SETUP_SCRIPT="$SCRIPT_DIR/scripts/setup/setup.sh"
SERVE_SCRIPT="$SCRIPT_DIR/scripts/server/serve.cjs"

FRONTEND_PORT="${FRONTEND_PORT:-1420}"
LLM_PORT="${LLM_PORT:-10086}"
SETUP_REASON=""
SETUP_MODE="Repair"
MAX_PERF_FLAG=""
SETUP_OPENVINO=0

is_port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return
  fi
  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1
    return
  fi
  (echo >"/dev/tcp/127.0.0.1/$port") >/dev/null 2>&1
}

resolve_frontend_port() {
  local preferred="$1"
  local port

  if ! is_port_in_use "$preferred"; then
    echo "$preferred"
    return 0
  fi

  for ((port = 1421; port <= 1499; port += 1)); do
    if [[ "$port" == "$preferred" ]]; then
      continue
    fi
    if ! is_port_in_use "$port"; then
      echo "$port"
      return 0
    fi
  done

  echo "[ОШИБКА] Не найден свободный порт для фронтенда. Пробовал $preferred и диапазон 1421-1499." >&2

  return 1
}

# Parse args
for arg in "$@"; do
  case "$arg" in
    --max-perf)
      MAX_PERF_FLAG="--max-perf"
      ;;
    --setup-openvino)
      SETUP_OPENVINO=1
      ;;
    *)
      echo "[ОШИБКА] Неизвестный параметр: $arg" >&2
      echo "Использование: ./linux.sh [--max-perf] [--setup-openvino]" >&2

      exit 1
      ;;
  esac
done

if [[ $SETUP_OPENVINO -eq 1 ]]; then
  bash "$SCRIPT_DIR/scripts/setup/setup-openvino-npu.sh"
fi

# Настраиваю node_modules, чтобы избежать конфликтов платформ.

FRONTEND_NODE_MODULES="$APP_DIR/frontend/node_modules"
LINUX_NODE_MODULES="$APP_DIR/frontend/node_modules_linux"
ACTIVE_OS_FILE="$APP_DIR/frontend/.active_modules_os"

# Проверяю, поддерживает ли файловая система символические ссылки.

USE_SYMLINKS=true
TEST_LINK="$APP_DIR/frontend/.test_symlink"
rm -f "$TEST_LINK"
if ln -s "node_modules_linux" "$TEST_LINK" 2>/dev/null; then
  rm -f "$TEST_LINK"
else
  USE_SYMLINKS=false
fi

if [ "$USE_SYMLINKS" = true ]; then
  if [[ -d "$FRONTEND_NODE_MODULES" && ! -L "$FRONTEND_NODE_MODULES" ]]; then
    echo "  >> Migrating existing node_modules to node_modules_linux..."
    rm -rf "$LINUX_NODE_MODULES"
    mv "$FRONTEND_NODE_MODULES" "$LINUX_NODE_MODULES"
  fi
  rm -f "$FRONTEND_NODE_MODULES"
  mkdir -p "$LINUX_NODE_MODULES"
  ln -sf "node_modules_linux" "$FRONTEND_NODE_MODULES"
else
  # Fallback: Filesystem does not support symlinks (e.g. FAT32/exFAT)
  echo "  >> Filesystem does not support symlinks. Using directory swapping fallback..."
  
  if [[ -L "$FRONTEND_NODE_MODULES" || -f "$FRONTEND_NODE_MODULES" ]]; then
    rm -f "$FRONTEND_NODE_MODULES"
  fi
  
  PREV_OS=""
  if [[ -f "$ACTIVE_OS_FILE" ]]; then
    PREV_OS=$(cat "$ACTIVE_OS_FILE")
  fi
  
  if [[ -d "$FRONTEND_NODE_MODULES" && "$PREV_OS" != "linux" ]]; then
    if [[ -n "$PREV_OS" ]]; then
      echo "  >> Swapping out node_modules to node_modules_$PREV_OS..."
      rm -rf "$APP_DIR/frontend/node_modules_$PREV_OS"
      mv "$FRONTEND_NODE_MODULES" "$APP_DIR/frontend/node_modules_$PREV_OS"
    else
      echo "  >> Saving node_modules as node_modules_windows..."
      rm -rf "$APP_DIR/frontend/node_modules_windows"
      mv "$FRONTEND_NODE_MODULES" "$APP_DIR/frontend/node_modules_windows"
    fi
  fi
  
  if [[ -d "$LINUX_NODE_MODULES" && ! -d "$FRONTEND_NODE_MODULES" ]]; then
    echo "  >> Swapping in node_modules_linux..."
    mv "$LINUX_NODE_MODULES" "$FRONTEND_NODE_MODULES"
  elif [[ ! -d "$FRONTEND_NODE_MODULES" ]]; then
    mkdir -p "$FRONTEND_NODE_MODULES"
  fi
  
  echo "linux" > "$ACTIVE_OS_FILE"
fi

# ── Проверка первого запуска ────────────────────────────────────────────


if [[ ! -d "$NODE_DIR" ]]; then
  SETUP_MODE="First-Time Setup"
fi

if [[ ! -x "$NODE_BIN" ]]; then
  SETUP_REASON="Не найден переносимый Node.js для Linux."

fi

if [[ ! -f "$DIST_INDEX" ]]; then
  SETUP_REASON="Отсутствует сборка фронтенда (build)."

fi

# At minimum we need CPU or Vulkan backend on Linux, and both CLI and server binaries must be executable
CPU_SERVER_PATH="$APP_DIR/backend/linux/cpu/sd-server-cpu"
VULKAN_SERVER_PATH="$APP_DIR/backend/linux/vulkan/sd-server-vulkan"
LLM_CUDA_PATH="$APP_DIR/llm-backend/linux/cuda/llama-server"
LLM_ROCM_PATH="$APP_DIR/llm-backend/linux/rocm/llama-server"
LLM_SYCL_PATH="$APP_DIR/llm-backend/linux/sycl/llama-server"
LLM_VULKAN_PATH="$APP_DIR/llm-backend/linux/vulkan/llama-server"
LLM_CPU_PATH="$APP_DIR/llm-backend/linux/cpu/llama-server"
SPEECH_BACKEND_PATH="$APP_DIR/speech-backend/linux/cpu/whisper-cli"
TTS_RUNTIME_PATH="$APP_DIR/tts-runtime/node_modules/kokoro-js"
if [[ ! -x "$CPU_BACKEND_PATH" || ! -x "$CPU_SERVER_PATH" ]] && [[ ! -x "$BACKEND_PATH" || ! -x "$VULKAN_SERVER_PATH" ]]; then
  SETUP_REASON="Не найдены файлы бэкенда Linux или они недоступны для выполнения."

fi
if [[ ! -x "$LLM_CUDA_PATH" && ! -x "$LLM_ROCM_PATH" && ! -x "$LLM_SYCL_PATH" && ! -x "$LLM_VULKAN_PATH" && ! -x "$LLM_CPU_PATH" ]]; then
  SETUP_REASON="Отсутствует (или недоступен для выполнения) текстовый бэкенд llama.cpp для Linux."

fi
if [[ ! -x "$SPEECH_BACKEND_PATH" ]]; then
  SETUP_REASON="Отсутствует (или недоступен для выполнения) speech-бэкенд whisper.cpp для Linux."

fi
if [[ ! -d "$TTS_RUNTIME_PATH" ]]; then
  SETUP_REASON="Отсутствует runtime Kokoro для text-to-speech."

fi

if [[ -n "$SETUP_REASON" ]]; then
  echo ""
  echo "  ============================================================"
  echo "   UNCENSORED AI STUDIO      |  $PLATFORM_LABEL $SETUP_MODE"
  echo "  ============================================================"
  echo ""
  if [[ "$SETUP_MODE" == "First-Time Setup" ]]; then
    echo "  Похоже, это первый запуск на Linux. Выполняю настройку автоматически..."

  else
    echo "  Нужна быстрая проверка и восстановление перед запуском."

  fi
  echo "  Причина: $SETUP_REASON"
  echo "  Во время настройки модели не загружаются. Загрузите их или импортируйте в приложении."

  echo ""
  read -rp "  Нажмите Enter, чтобы продолжить, или Ctrl+C чтобы отменить."


  # Очищаю порты управляемого бэкенда перед настройкой.
  # Порт фронтенда трогать не нужно — лаунчер сам выберет свободный порт.

  if command -v lsof >/dev/null 2>&1; then
    lsof -t -i:8080 -i:"${LLM_PORT}" | xargs kill -9 >/dev/null 2>&1 || true
  elif command -v fuser >/dev/null 2>&1; then
    fuser -k "8080/tcp" >/dev/null 2>&1 || true
    fuser -k "${LLM_PORT}/tcp" >/dev/null 2>&1 || true
  fi

  if ! bash "$SETUP_SCRIPT" $MAX_PERF_FLAG; then
    echo ""
    echo "  [ОШИБКА] Не удалось выполнить настройку. Проверьте вывод выше."
    read -rp "  Нажмите Enter, чтобы закрыть..."

    exit 1
  fi
fi

# ── Запуск ────────────────────────────────────────────────────────────────

clear 2>/dev/null || true
echo ""
echo "  ============================================================"
echo "   UNCENSORED AI STUDIO      |  Запуск..."

echo "  ============================================================"
echo ""

REQUESTED_FRONTEND_PORT="$FRONTEND_PORT"
FRONTEND_PORT="$(resolve_frontend_port "$REQUESTED_FRONTEND_PORT")"
if [[ "$FRONTEND_PORT" != "$REQUESTED_FRONTEND_PORT" ]]; then
  echo "  Порт фронтенда ${REQUESTED_FRONTEND_PORT} занят; используется ${FRONTEND_PORT} вместо этого."
fi


  # Очищаю порты управляемого бэкенда

if command -v lsof >/dev/null 2>&1; then
  lsof -t -i:8080 -i:"${LLM_PORT}" | xargs kill -9 >/dev/null 2>&1 || true
elif command -v fuser >/dev/null 2>&1; then
  fuser -k "8080/tcp" >/dev/null 2>&1 || true
  fuser -k "${LLM_PORT}/tcp" >/dev/null 2>&1 || true
fi

# Запускаю сервер

echo "  Запуск Uncensored AI Studio..."

export PATH="$NODE_DIR/bin:$PATH"
export FRONTEND_PORT="$FRONTEND_PORT"

# Запускаю сервер в фоне и сохраняю PID

"$NODE_BIN" "$SERVE_SCRIPT" &
SERVER_PID=$!

# Жду готовности сервера

sleep 2

# Открываю браузер

if command -v xdg-open >/dev/null 2>&1; then
  echo "  Открываю браузер: http://localhost:${FRONTEND_PORT}"

  xdg-open "http://localhost:${FRONTEND_PORT}" >/dev/null 2>&1 &
else
  echo "  Откройте браузер по адресу: http://localhost:${FRONTEND_PORT}"

fi

echo ""
echo "  ============================================================"
echo "   Запущено!"

echo "   Web UI:     http://localhost:${FRONTEND_PORT}"
echo "   GPU API:    Автовыбор приложением (стартует с 8080)"

echo "   Text API:   Запускается при загрузке модели GGUF (порт ${LLM_PORT})"

echo "   Speech:     Управляется локально приложением"

echo "   TTS:        Управляется локально приложением"

echo ""
echo "   Нажмите Ctrl+C в этом окне, чтобы остановить все службы."

echo "  ============================================================"
echo ""

# Очистка при завершении

cleanup() {
  echo ""
  echo "  Останавливаю..."


  if kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill -TERM "$SERVER_PID" >/dev/null 2>&1 || true
    sleep 1
    kill -KILL "$SERVER_PID" >/dev/null 2>&1 || true
  fi
  echo "  Готово. До свидания!"

  exit 0
}
trap cleanup SIGINT SIGTERM

# Держу скрипт активным

wait "$SERVER_PID" || true
cleanup
