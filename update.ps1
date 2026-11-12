# VideoHub update: copies this folder's code over an existing VideoHub install on this PC.
# Keeps the PC's own data (data\: settings, render queue, caches) and every project's notes; nothing is deleted.
#   powershell -ExecutionPolicy Bypass -File update.ps1 [-Target <VideoHub folder>] [-NoAgent] [-NoSkill] [-DryRun]
# (With git you can simply `git pull` inside the install instead, then run setup.ps1 again.)
param([string]$Target, [switch]$NoAgent, [switch]$NoGuard, [switch]$NoSkill, [switch]$DryRun)
if ($NoGuard) { $NoAgent = $true }
$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Plan($m) { Write-Host "  [dry run] would: $m" -ForegroundColor DarkCyan }
Say '== VideoHub update' Cyan

# 1. the installed VideoHub: given, or where the Desktop shortcut points
if (-not $Target) {
  $desk = [Environment]::GetFolderPath('Desktop')
  $cands = @((Join-Path $desk 'VideoHub'))
  $lnk = Join-Path $desk 'VideoHub.lnk'
  if (Test-Path $lnk) { try { $wd = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk).WorkingDirectory; if ($wd) { $cands = @($wd) + $cands } } catch { } }
  $Target = $cands | Where-Object { $_ -and (Test-Path (Join-Path $_ 'server\hub.js')) } | Select-Object -First 1
}
if (-not $Target -or -not (Test-Path (Join-Path $Target 'server\hub.js'))) {
  Say 'No installed VideoHub found. For a first install use SETUP.cmd (or: update.ps1 -Target <VideoHub folder>).' Red; exit 1
}
$Target = (Resolve-Path $Target).Path
if ($Target.TrimEnd('\') -ieq $src.TrimEnd('\')) { Say 'This folder is the installed VideoHub; nothing to update.' Yellow; exit 0 }
Say "Installed VideoHub: $Target"

# 2. not while something renders or cleans (the hub would be stopped under it)
$port = 7788
try { $cfg = [IO.File]::ReadAllText((Join-Path $Target 'data\config.json')) | ConvertFrom-Json; if ($cfg.port) { $port = [int]$cfg.port } } catch { }
$up = $false
try {
  $ping = Invoke-RestMethod "http://127.0.0.1:$port/api/ping" -TimeoutSec 3; $up = $true
  $jobs = @(Invoke-RestMethod "http://127.0.0.1:$port/api/jobs" -TimeoutSec 5) | Where-Object { $_.state -in 'running', 'queued' }
  if ($jobs.Count) { Say "$($jobs.Count) render(s) running or queued. Run this again when they are done; nothing was changed." Yellow; exit 2 }
  $cl = Invoke-RestMethod "http://127.0.0.1:$port/api/disk/clean" -TimeoutSec 5 -ErrorAction SilentlyContinue
  if ($cl.state -eq 'running') { Say 'A cleanup is running. Run this again when it is done; nothing was changed.' Yellow; exit 2 }
} catch { }

# 3. stop this install's hub (only node processes running <Target>\server\hub.js)
$hubJs = (Join-Path $Target 'server\hub.js')
$procs = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains($hubJs.ToLower()) -or ($up -and $_.ProcessId -eq $ping.pid) })
foreach ($p in $procs) { if ($DryRun) { Plan "stop the VideoHub server (pid $($p.ProcessId))" } else { try { Stop-Process -Id $p.ProcessId -Force -Confirm:$false; Say "VideoHub server stopped (pid $($p.ProcessId))" } catch { } } }
if ($procs.Count -and -not $DryRun) { Start-Sleep -Milliseconds 800 }

# 4. backup of the code being replaced (data\update-backup\<time>), then copy
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$bak = Join-Path $Target "data\update-backup\$stamp"
$items = @('server', 'ui', 'templates', 'skill', 'claude', 'examples', 'engine-hooks', 'docs', 'scripts', 'CLAUDE.md', 'README.md', 'LICENSE', 'SETUP.cmd', 'UPDATE.cmd', 'update.ps1', 'setup.ps1', 'uninstall.ps1', 'open.ps1', 'open.vbs', 'package.json', 'package-lock.json')
$lockOld = Join-Path $Target 'package-lock.json'; $lockHashOld = if (Test-Path $lockOld) { (Get-FileHash $lockOld).Hash } else { '' }
if ($DryRun) { Plan "back up the replaced code to $bak and copy: $($items -join ', ')"; Say 'Dry run finished: nothing was changed.' Yellow; exit 0 }
New-Item -ItemType Directory -Force $bak | Out-Null
$n = 0
foreach ($it in $items) {
  $from = Join-Path $src $it; if (-not (Test-Path $from)) { continue }
  $to = Join-Path $Target $it
  if (Test-Path $to) { $b = Join-Path $bak $it; New-Item -ItemType Directory -Force (Split-Path $b) | Out-Null; Copy-Item $to $b -Recurse -Force }
  if ((Get-Item $from).PSIsContainer) {
    New-Item -ItemType Directory -Force $to | Out-Null
    Copy-Item (Join-Path $from '*') $to -Recurse -Force   # adds and replaces; files only the old version had are left alone
  } else {
    New-Item -ItemType Directory -Force (Split-Path $to) | Out-Null
    Copy-Item $from $to -Force
  }
  $n++
}
Say "$n items copied (the old code is in $bak)" Green

# 5. packages only when they changed
$lockHashNew = if (Test-Path $lockOld) { (Get-FileHash $lockOld).Hash } else { '' }
if ($lockHashNew -ne $lockHashOld -or -not (Test-Path (Join-Path $Target 'node_modules'))) {
  Push-Location $Target
  try { cmd /c "npm install --no-audit --no-fund --loglevel=error"; if ($LASTEXITCODE -ne 0) { throw 'npm install failed' } } finally { Pop-Location }
  Say 'Packages updated' Green
} else { Say 'Packages unchanged' }

# 6. render protection is now part of the VideoHub server: an old install's agent program (guard\VideoHubAgent.exe or
#    guard\RenderGuard.exe, which Windows Smart App Control blocks) is asked to quit (it lifts its CPU limits) and removed
$gd = Join-Path $Target 'guard'
foreach ($name in 'VideoHubAgent.exe', 'RenderGuard.exe') {
  $exe = Join-Path $gd $name; if (-not (Test-Path $exe)) { continue }
  $running = @(Get-CimInstance Win32_Process -Filter "Name='$name'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath -ieq $exe })
  if ($DryRun) { Plan "quit and remove the old render protection program $exe"; continue }
  if ($running.Count) { try { Start-Process $exe -ArgumentList '--quit' -WindowStyle Hidden -Wait -ErrorAction Stop } catch { $running | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } } }
  Remove-Item $exe -Force -ErrorAction SilentlyContinue
  Say "Old render protection program removed ($name); protection now runs inside VideoHub" Green
}
if (-not $DryRun) {
  Get-ChildItem $gd -Filter '*.exe' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue   # its build backups
  foreach ($f in 'RenderGuard.cs', 'build.ps1') { Remove-Item (Join-Path $gd $f) -Force -ErrorAction SilentlyContinue }
  Remove-Item (Join-Path $gd 'tests') -Recurse -Force -ErrorAction SilentlyContinue
  reg delete 'HKCU\Software\Microsoft\Windows\CurrentVersion\Run' /v RenderGuard /f 2>$null | Out-Null
}

# 7. the skill Claude reads (with the install's path filled in)
if (-not $NoSkill) {
  $sk = Join-Path $env:USERPROFILE '.claude\skills\videohub'
  New-Item -ItemType Directory -Force $sk | Out-Null
  foreach ($f in Get-ChildItem (Join-Path $Target 'skill\videohub') -File) { [IO.File]::WriteAllText((Join-Path $sk $f.Name), [IO.File]::ReadAllText($f.FullName).Replace('{{VIDEOHUB_DIR}}', $Target), (New-Object Text.UTF8Encoding $false)) }
  Say "Skill updated: $sk" Green
}

Say ''
Say '== Done. Open VideoHub with the Desktop shortcut (the server starts again with the new code).' Cyan
Say 'Claude sessions that are already open see the new hub_* tools after they restart them.'
