# VideoHub uninstall: undoes what setup.ps1 did on this PC. Your films, their notes (.videohub folders), the outputs
# folder and this VideoHub folder itself are NOT touched; delete the folder yourself afterwards if you want.
#   powershell -NoProfile -ExecutionPolicy Bypass -File uninstall.ps1 [-DryRun]   (the policy flag covers this one visible process)
param([switch]$DryRun)
$ErrorActionPreference = 'Continue'
$hub = $PSScriptRoot
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Do-It($what, [scriptblock]$act) { if ($DryRun) { Write-Host "  [dry run] would: $what" -ForegroundColor DarkCyan } else { & $act; Say "done: $what" Green } }
Say "== VideoHub uninstall: $hub" Cyan

# 1. stop this install's hub (render protection runs inside it; an old guard helper is retired by update, never run)
$stopArgs = @('stop','--target',$hub)
if ($DryRun) { $stopArgs += '--dry-run' }
& node (Join-Path $hub 'scripts\install.mjs') @stopArgs
if ($LASTEXITCODE -ne 0) { Say 'The server could not be stopped safely; nothing was uninstalled.' Yellow; exit 2 }

# 2. Remove only agent integrations owned by this installation; skill folders go to the Recycle Bin.
$agentArgs = @('--action','uninstall','--agents','claude,opencode','--hub',$hub)
if ($DryRun) { $agentArgs += '--dry-run' }
$agentResult = (& node (Join-Path $hub 'scripts\agents.mjs') @agentArgs) | ConvertFrom-Json
foreach ($line in $agentResult.actions) { Say ('  ' + $line) DarkGray }
foreach ($err in $agentResult.errors) { Say $err Yellow }

# 3. Desktop shortcut and start-up entry
$lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'VideoHub.lnk'
$lnkMine = $false; if (Test-Path $lnk) { try { $lnkMine = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk).Arguments.Contains($hub) } catch { } }
if ($lnkMine) { Do-It "delete the Desktop shortcut $lnk" { Remove-Item $lnk -Force } }
$rk = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$v = (Get-ItemProperty $rk -ErrorAction SilentlyContinue).VideoHub
if ($v -and $v -match [regex]::Escape($hub)) { Do-It 'remove the "start with Windows" entry' { Remove-ItemProperty $rk -Name VideoHub } }

Say ''
Say '== Done. Left in place: this folder (with data\), your films and their .videohub notes, the outputs folder,' Cyan
Say '   and %APPDATA%\RenderGuard (the agent''s settings and history). Delete them yourself if you want them gone.' Cyan
