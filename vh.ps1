# vh - VideoHub launcher.
# Starts the local VideoHub server if it is not running, waits for /api/ping, then opens the UI as a browser
# app window (Edge or Chrome --app, no address bar; the default browser is the last fallback).
# -ServerOnly starts only the server (login startup).
param([switch]$ServerOnly, [switch]$Shortcut)
$ErrorActionPreference = 'Stop'
$hub = $PSScriptRoot
if ($Shortcut) {
  # Recreate the desktop shortcuts after an upstream update rewrites them.
  $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $icon = Join-Path $hub 'data\app.ico'
  if (-not (Test-Path $icon)) { $icon = 'C:\Program Files\nodejs\node.exe,0' }
  $args = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $hub 'vh.ps1') + '"'
  $shell = New-Object -ComObject WScript.Shell
  foreach ($name in @('VideoHub.lnk', 'vh.lnk')) {
    $path = Join-Path ([Environment]::GetFolderPath('Desktop')) $name
    $s = $shell.CreateShortcut($path)
    $s.TargetPath = $ps; $s.Arguments = $args; $s.WorkingDirectory = $hub
    $s.IconLocation = $icon; $s.Description = 'vh - local review studio'; $s.WindowStyle = 1
    $s.Save()
    Write-Output "wrote $path"
  }
  exit 0
}
$port = 7788
try {
  $cfg = Get-Content (Join-Path $hub 'data\config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($cfg.port) { $port = [int]$cfg.port }
} catch { }
$url = "http://127.0.0.1:$port"
function Alive {
  try { return (Invoke-WebRequest "$url/api/ping" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 }
  catch { return $false }
}
# ffmpeg is needed for renders and for the review proxy. The shortcut can inherit a shorter PATH than a normal
# shell, so find it here and put its folder first for the server process (never hard-code it into the app).
$ff = $null
$cmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
if ($cmd) { $ff = $cmd.Source }
if (-not $ff -and (Test-Path 'C:\ffmpeg\bin\ffmpeg.exe')) { $ff = 'C:\ffmpeg\bin\ffmpeg.exe' }
if (-not $ff -and (Test-Path 'C:\YT-DLP')) {
  $ff = Get-ChildItem 'C:\YT-DLP' -Directory -Filter 'ffmpeg-*' -ErrorAction SilentlyContinue |
    ForEach-Object { Join-Path $_.FullName 'ffmpeg\bin\ffmpeg.exe' } |
    Where-Object { Test-Path $_ } | Select-Object -First 1
}
if ($ff) { $env:PATH = (Split-Path -Parent $ff) + ';' + $env:PATH; $env:FFMPEG = $ff; $env:FFPROBE = (Join-Path (Split-Path -Parent $ff) 'ffprobe.exe') }
if (-not (Alive)) {
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $node) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show('Node.js was not found. Run SETUP.cmd in the VideoHub folder.') | Out-Null
    exit 1
  }
  # Start-Process, not a child console process: the server must outlive this launcher.
  Start-Process -FilePath $node -ArgumentList "`"$hub\server\hub.js`"" -WorkingDirectory $hub -WindowStyle Hidden
  for ($i = 0; $i -lt 60 -and -not (Alive); $i++) { Start-Sleep -Milliseconds 250 }
}
if (-not (Alive)) {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show("vh could not start at $url. Check Node.js and the VideoHub data folder.") | Out-Null
  exit 1
}
if ($ServerOnly) { exit 0 }

$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") |
  Where-Object { Test-Path $_ } | Select-Object -First 1
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") |
  Where-Object { Test-Path $_ } | Select-Object -First 1
if ($edge) { Start-Process -FilePath $edge -ArgumentList @("--app=$url", '--no-first-run', '--no-default-browser-check') }
elseif ($chrome) { Start-Process -FilePath $chrome -ArgumentList @("--app=$url", '--no-first-run', '--no-default-browser-check') }
else { Start-Process $url }
