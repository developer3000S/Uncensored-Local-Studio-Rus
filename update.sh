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
cd app/frontend && node node_modules/vite/bin/vite.js build

if [ $? -eq 0 ]; then
    echo "--- Success: Repository updated! ---"
else
    echo "--- Error: Failed to update repository. ---"
    exit 1
fi
