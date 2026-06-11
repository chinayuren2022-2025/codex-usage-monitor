#!/bin/bash
# Double-click launcher for macOS (Finder runs .command files in Terminal).
# Close the Terminal window (or press Ctrl-C) to stop monitoring.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Node.js not found. Install it from https://nodejs.org and run again."
  echo
  read -r -p "  Press Return to close..."
  exit 1
fi

node src/server.mjs

echo
echo "  Server stopped."
read -r -p "  Press Return to close..."
