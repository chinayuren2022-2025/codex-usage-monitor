# Builds a clean, shareable ZIP of the monitor for teammates (Node required to run).
# Output: dist\codex-usage-monitor.zip  ->  unzip, double-click Start-Monitor.cmd/.command.
# ASCII-only on purpose (Windows PowerShell 5.1 decodes no-BOM scripts as ANSI).
$ErrorActionPreference = "Stop"
$proj = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $proj "dist"
$stage = Join-Path $dist "codex-usage-monitor"
$zip = Join-Path $dist "codex-usage-monitor.zip"

New-Item -ItemType Directory -Force -Path $dist | Out-Null
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
if (Test-Path $zip) { Remove-Item $zip -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

# Core app (dashboard)
Copy-Item (Join-Path $proj "src")     $stage -Recurse
Copy-Item (Join-Path $proj "public")  $stage -Recurse
Copy-Item (Join-Path $proj "Start-Monitor.cmd")     $stage
Copy-Item (Join-Path $proj "Start-Monitor.command") $stage
Copy-Item (Join-Path $proj "package.json")      $stage
Copy-Item (Join-Path $proj "README.md")         $stage

# Export tool (for sending usage data back to the calibration maintainer)
# Only the 3 files a teammate needs — no receiver/fetch/analyze (those are for the maintainer).
Copy-Item (Join-Path $proj "scripts\export-send.mjs")     $stage
Copy-Item (Join-Path $proj "scripts\export-send.cmd")     $stage
Copy-Item (Join-Path $proj "scripts\export-send.command") $stage

# Remove internal-only scripts that snuck in via src/ copy (anchor-snap is a
# calibration maintainer tool, not something teammates need, but it's harmless
# so we leave it). Remove scratch files.
Get-ChildItem $stage -Recurse -Filter "anchor-result.json" | Remove-Item -Force -ErrorAction SilentlyContinue
# Remove the scripts/ dir from the staging copy — we already cherry-picked export-send above
# (scripts/ also contains receiver, fetch, analyze which are maintainer-only)
if (Test-Path (Join-Path $stage "scripts")) { Remove-Item (Join-Path $stage "scripts") -Recurse -Force }

Compress-Archive -Path $stage -DestinationPath $zip -Force
Remove-Item $stage -Recurse -Force

$kb = [math]::Round((Get-Item $zip).Length / 1KB)
Write-Output ""
Write-Output "Package ready: $zip  ($kb KB)"
Write-Output "Windows: unzip, double-click Start-Monitor.cmd"
Write-Output "macOS:   unzip, double-click Start-Monitor.command"