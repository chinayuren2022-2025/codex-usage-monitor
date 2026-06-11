# Builds a clean, shareable ZIP of the monitor for teammates (Node required to run).
# Output: dist\codex-usage-monitor.zip  ->  unzip, double-click Start-Monitor.cmd.
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

# Only ship what an end user needs. Scratch files (anchor-result.json), dist/, and
# node_modules/ are excluded by omission.
Copy-Item (Join-Path $proj "src")     $stage -Recurse
Copy-Item (Join-Path $proj "public")  $stage -Recurse
Copy-Item (Join-Path $proj "scripts") $stage -Recurse
Copy-Item (Join-Path $proj "Start-Monitor.cmd") $stage
Copy-Item (Join-Path $proj "package.json")      $stage
Copy-Item (Join-Path $proj "README.md")         $stage

# Belt-and-suspenders: drop any scratch that slipped in.
Get-ChildItem $stage -Recurse -Filter "anchor-result.json" | Remove-Item -Force -ErrorAction SilentlyContinue

Compress-Archive -Path $stage -DestinationPath $zip -Force
Remove-Item $stage -Recurse -Force

$kb = [math]::Round((Get-Item $zip).Length / 1KB)
Write-Output ""
Write-Output "Package ready: $zip  ($kb KB)"
Write-Output "Share it: teammate unzips, double-clicks Start-Monitor.cmd (needs Node.js)."
