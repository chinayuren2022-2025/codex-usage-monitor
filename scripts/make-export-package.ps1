# Build a clean, shareable ZIP containing only the export/send tool (for teammates with Codex usage data).
# Output: dist\codex-export-tool.zip  ->  unzip, double-click export-send.cmd (Windows) or export-send.command (macOS).
$ErrorActionPreference = "Stop"
$proj = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $proj "dist"
$stage = Join-Path $dist "codex-export-tool"

New-Item -ItemType Directory -Force -Path $dist | Out-Null
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
$zip = Join-Path $dist "codex-export-tool.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

# Core export script (cross-platform, Node.js)
Copy-Item (Join-Path $proj "scripts\export-send.mjs") $stage

# Windows launcher
Copy-Item (Join-Path $proj "scripts\export-send.cmd") $stage

# macOS launcher
Copy-Item (Join-Path $proj "scripts\export-send.command") $stage

# README (ASCII-only for Windows PowerShell 5.1 compat)
@"
Codex Usage Export Tool
=======================

Before you run:
  1. Install Node.js from https://nodejs.org (LTS version)
  2. Double-click:
     - Windows: export-send.cmd
     - macOS:   export-send.command
  3. That's it! The tool will:
     - Scan your ~/.codex/sessions/ folder for usage data
     - Extract token counts and rate limit info
     - Send the data to the calibration server

No dependencies, no install -- just Node.js.

If the upload fails, the data is saved to your Desktop as a backup.
You can also run with --local to skip the upload and only save locally:
  node export-send.mjs --local
"@ | Set-Content (Join-Path $stage "README.txt")

Compress-Archive -Path $stage -DestinationPath $zip -Force
Remove-Item $stage -Recurse -Force

$kb = [math]::Round((Get-Item $zip).Length / 1KB)
Write-Output ""
Write-Output "Package ready: $zip  ($kb KB)"
Write-Output "Send codex-export-tool.zip to the teammate."
Write-Output "Windows: unzip, double-click export-send.cmd"
Write-Output "macOS:   unzip, double-click export-send.command"