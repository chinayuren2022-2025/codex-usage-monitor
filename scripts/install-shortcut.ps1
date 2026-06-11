# Creates (or refreshes) a Desktop shortcut pointing at Start-Monitor.cmd.
# Idempotent - safe to run on every launch.
# NOTE: ASCII-only name/description on purpose. The .cmd invokes Windows
# PowerShell 5.1, which decodes a no-BOM script using the system ANSI codepage;
# keeping this file ASCII guarantees a correct shortcut name on any locale.
$ErrorActionPreference = "Stop"
$proj = Split-Path -Parent $PSScriptRoot
$cmd = Join-Path $proj "Start-Monitor.cmd"
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $desktop "Codex Usage Monitor.lnk"

$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut($lnk)
$sc.TargetPath = $cmd
$sc.WorkingDirectory = $proj
$sc.Description = "Codex local token usage monitor - double-click to start; browser opens automatically"
$sc.WindowStyle = 7   # start minimized; close window to stop
$sc.IconLocation = "$env:SystemRoot\System32\shell32.dll,13"
$sc.Save()
Write-Output "Shortcut ready: $lnk"
