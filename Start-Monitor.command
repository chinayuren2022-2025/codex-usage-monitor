#!/bin/sh
# Double-click launcher for macOS (Finder runs .command files in Terminal).
# Close the Terminal window (or press Ctrl-C) to stop monitoring.
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
  printf "  Press Return to close..." && read -r _
  exit 1
fi

node src/server.mjs

echo
echo "  Server stopped."
printf "  Press Return to close..." && read -r _