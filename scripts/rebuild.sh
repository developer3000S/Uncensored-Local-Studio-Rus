#!/usr/bin/env bash
#
# Local AI Studio - Rebuild Frontend and verify Backend
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/app/frontend"
SERVER_SCRIPT="$ROOT_DIR/scripts/server/serve.cjs"

echo "============================================================"
echo "  Local AI Studio - Rebuild Frontend + Verify Backend"
echo "============================================================"
echo ""

# ── Frontend ────────────────────────────────────────────────
echo ">> Building frontend (app/frontend)..."
if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
  echo "   Installing frontend dependencies..."
  (cd "$FRONTEND_DIR" && npm install)
fi

(cd "$FRONTEND_DIR" && npm run build)
echo "   OK   Frontend built successfully."
echo ""

# ── Backend ─────────────────────────────────────────────────
echo ">> Verifying backend syntax (scripts/server/serve.cjs)..."
if ! node --check "$SERVER_SCRIPT" 2>/dev/null; then
  echo "   XX   Backend syntax check FAILED."
  exit 1
fi
echo "   OK   Backend syntax is valid."
echo ""

# ── TTS runtime ─────────────────────────────────────────────
TTS_RUNTIME="$ROOT_DIR/app/tts-runtime"
if [[ -d "$TTS_RUNTIME" ]] && [[ -f "$TTS_RUNTIME/package.json" ]]; then
  echo ">> Checking TTS runtime (kokoro-js)..."
  if [[ ! -d "$TTS_RUNTIME/node_modules/kokoro-js" ]]; then
    echo "   Installing kokoro-js..."
    if [[ -x "$ROOT_DIR/app/tools/node-linux/bin/npm" ]]; then
      (cd "$TTS_RUNTIME" && "$ROOT_DIR/app/tools/node-linux/bin/npm" install --prefer-offline)
    else
      (cd "$TTS_RUNTIME" && npm install --prefer-offline)
    fi
  fi
  echo "   OK   TTS runtime ready."
fi
echo ""

echo "============================================================"
echo "  Rebuild complete."
echo "  Restart the application server to load the changes."
echo "============================================================"
