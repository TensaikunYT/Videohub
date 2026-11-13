# VideoHub update: copies this folder's code over an existing VideoHub install on this PC.
# Keeps the PC's own data (data\: settings, render queue, caches) and every project's notes; nothing is deleted.
#   UPDATE.cmd [-Target <VideoHub folder>] [-NoAgent] [-NoSkill] [-DryRun]   (or: powershell -NoProfile -ExecutionPolicy Bypass -File update.ps1 ...)
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

# Resolve junctions in Node before comparing paths: copying nested or aliased installs can recurse into backups.
$old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
try { & node (Join-Path $src 'scripts\install.mjs') validate-update --source $src --target $Target; $pathsCode = $LASTEXITCODE } finally { $ErrorActionPreference = $old }
if ($pathsCode -ne 0) { Say 'The update folders are not safely separate; no server was stopped and no code was changed.' Yellow; exit 2 }

# 2-3. Check ownership and the queue, then stop only this install and verify it exited.
# The shared helper refuses inaccessible queues, reused PIDs and a port occupied by another installation.
$stopArgs = @('stop','--target',$Target)
if ($DryRun) { $stopArgs += '--dry-run' }
$old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
try { & node (Join-Path $src 'scripts\install.mjs') @stopArgs; $stopCode = $LASTEXITCODE } finally { $ErrorActionPreference = $old }
if ($stopCode -ne 0) { Say 'The installed server could not be stopped safely; no code was changed.' Yellow; exit 2 }

# 4. backup of the code being replaced (data\update-backup\<time>), then copy
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$bak = Join-Path $Target "data\update-backup\$stamp"
$items = @('server', 'ui', 'templates', 'skill', 'claude', 'examples', 'engine-hooks', 'docs', 'scripts', 'CLAUDE.md', 'AGENTS.md', 'README.md', 'LICENSE', 'SETUP.cmd', 'UPDATE.cmd', 'update.ps1', 'setup.ps1', 'uninstall.ps1', 'open.cmd', 'setup.sh', 'update.sh', 'uninstall.sh', 'open.sh', 'package.json', 'package-lock.json')
$lockOld = Join-Path $Target 'package-lock.json'; $lockHashOld = if (Test-Path $lockOld) { (Get-FileHash $lockOld).Hash } else { '' }
if ($DryRun) {
  Plan "back up the replaced code to $bak and copy: $($items -join ', ')"
  Plan "re-point this install's Desktop shortcut and start-up entry to `"$((Get-Command node).Source)`" `"$Target\scripts\install.mjs`" open"
  Plan 'move retired files (old guard helper, open.vbs, open.ps1) to the Recycle Bin without running them'
  Say 'Dry run finished: nothing was changed.' Yellow; exit 0
}
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

# 6. Launchers: the Desktop shortcut and the "start with Windows" entry of this install used to run
#    wscript open.vbs -> hidden PowerShell. Both now run the installed Node.js directly (scripts\install.mjs open).
#    Only entries that belong to this install are changed; everything else is left alone.
$node = (Get-Command node).Source
$lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'VideoHub.lnk'
$lnkOld = $false
if (Test-Path $lnk) {
  try {
    $sc = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
    $mine = ([string]$sc.WorkingDirectory).TrimEnd([char]92) -ieq $Target.TrimEnd([char]92) -or $sc.Arguments.IndexOf("$Target\", [StringComparison]::OrdinalIgnoreCase) -ge 0
    if ($mine) {
      $sc.TargetPath = $node; $sc.Arguments = "`"$Target\scripts\install.mjs`" open"; $sc.WorkingDirectory = $Target; $sc.WindowStyle = 7
      $sc.Save(); Say 'Desktop shortcut now starts VideoHub through Node.js (no VBScript, no PowerShell)' Green
    } elseif ($sc.Arguments -match 'open\.vbs') { $lnkOld = $true }
  } catch { Say "The Desktop shortcut could not be updated: $($_.Exception.Message)" Yellow; $lnkOld = $true }
}
$old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
$runOld = $false
try {
  $state = (& node (Join-Path $Target 'scripts\install.mjs') autostart) | ConvertFrom-Json
  if ($state.enabled) {
    & node (Join-Path $Target 'scripts\install.mjs') autostart --startup yes | Out-Null
    if ($LASTEXITCODE -eq 0) { Say '"Start with Windows" entry now starts the server through Node.js' Green } else { $runOld = $true }
  }
} catch { $runOld = $true }
$runValue = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue).VideoHub
if ($runValue -and $runValue.IndexOf("$Target\open.vbs", [StringComparison]::OrdinalIgnoreCase) -ge 0) { $runOld = $true }

# 7a. Retired files go to the Recycle Bin, never run and never hard-deleted: the old render protection program
#     (guard\VideoHubAgent.exe / RenderGuard.exe, which Windows Smart App Control blocks; a running copy is stopped)
#     and, when nothing points at them any more, the old open.vbs / open.ps1 launchers.
$retireArgs = @('retire-legacy', '--target', $Target)
if (-not ($lnkOld -or $runOld)) { $retireArgs += '--launchers' } else { Say 'open.vbs is kept: a shortcut or start-up entry still uses it.' Yellow }
& node (Join-Path $Target 'scripts\install.mjs') @retireArgs
if ($LASTEXITCODE -ne 0) { Say 'Some retired files were left in place (see above); VideoHub works without removing them.' Yellow }
$ErrorActionPreference = $old

# 7b. Refresh only agent integrations already belonging to this install.
if (-not $NoSkill) {
  $agentResult = (& node (Join-Path $Target 'scripts\agents.mjs') --action refresh --agents claude,opencode --hub $Target) | ConvertFrom-Json
  foreach ($line in $agentResult.actions) { Say ('  ' + $line) DarkGray }
  foreach ($err in $agentResult.errors) { Say $err Yellow }
}

Say ''
Say '== Done. Open VideoHub with the Desktop shortcut (the server starts again with the new code).' Cyan
Say 'Agent sessions that are already open see the new hub_* tools after they restart them.'
