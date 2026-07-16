#!/bin/bash

# Script for automatic GitHub repository update
# Usage: ./update.sh "Your commit message"

# Check for presence of commit message
if [ -z "$1" ]; then
    echo "Error: Please provide a commit message."
    echo "Example: ./update.sh \"Fixed log processing error\""
    exit 1
fi

COMMIT_MSG="$1"

echo "--- Starting GitHub update ---"

# Fix git dubious ownership issue
git config --global --add safe.directory /disk/llm

# 1. Adding all changes
echo "[1/4] Adding files..."
git add .

# 2. Creating commit
echo "[2/4] Creating commit: '$COMMIT_MSG'..."
git commit -m "$COMMIT_MSG"

# 3. Pushing to main branch
echo "[3/4] Pushing data to GitHub (branch main)..."
# Добавляем флаг --no-thin и предварительную очистку для стабильности на внешних дисках
git gc --auto > /dev/null 2>&1
git push origin main --no-thin

# 4. Rebuild frontend
echo "[4/4] Rebuild frontend ..."
cd app/frontend
npm install --no-bin-links
mkdir -p node_modules/.bin
# Create wrapper scripts for binaries (exfat doesn't support symlinks)
cat > node_modules/.bin/vite << 'WRAPPER'
#!/usr/bin/env node
import('../vite/bin/vite.js')
WRAPPER
chmod +x node_modules/.bin/vite
cat > node_modules/.bin/tauri << 'WRAPPER'
#!/usr/bin/env node
require('../@tauri-apps/cli/tauri.js')
WRAPPER
chmod +x node_modules/.bin/tauri
npm run build
cd ../..

if [ $? -eq 0 ]; then
    echo "--- Success: Repository updated! ---"
else
    echo "--- Error: Failed to update repository. ---"
    exit 1
fi
