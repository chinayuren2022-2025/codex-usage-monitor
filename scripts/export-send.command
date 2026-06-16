#!/bin/bash
# Double-click launcher for macOS (Finder runs .command files in Terminal).
# Exports your Codex usage data and sends it to the calibration server.
cd "$(dirname "$0")" || exit 1

# Ensure this script is executable (zip extracts can lose the +x bit).
if [ ! -x "$0" ]; then
  chmod +x "$0"
  exec "$0" "$@"
fi

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Node.js is not installed."
  echo
  echo "  This tool requires Node.js (LTS version)."
  echo "  Opening the download page in your browser..."
  echo
  open "https://nodejs.org/en/download" 2>/dev/null || echo "  Please visit: https://nodejs.org/en/download"
  echo
  echo "  After installing Node.js, double-click this file again."
  echo
  read -r -p "  Press Return to close..."
  exit 1
fi

echo
echo "  This will export your Codex usage data and send it to the receiver."
echo "  No personal files are touched - only ~/.codex/sessions/**.jsonl"
echo

node "$(dirname "$0")/export-send.mjs" "$@"

echo
read -r -p "  Press Return to close..."