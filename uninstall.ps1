# VideoHub uninstall: undoes what setup.ps1 did on this PC. Your films, their notes (.videohub folders), the outputs
# folder and this VideoHub folder itself are NOT touched; delete the folder yourself afterwards if you want.
#   powershell -ExecutionPolicy Bypass -File uninstall.ps1 [-DryRun]
param([switch]$DryRun)
$ErrorActionPreference = 'Continue'
$hub = $PSScriptRoot
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Do-It($what, [scriptblock]$act) { if ($DryRun) { Write-Host "  [dry run] would: $what" -ForegroundColor DarkCyan } else { & $act; Say "done: $what" Green } }
Say "== VideoHub uninstall: $hub" Cyan

# 1. stop this install's hub and its render protection agent
$port = 7788
try { $cfg = [IO.File]::ReadAllText("$hub\data\config.json") | ConvertFrom-Json; if ($cfg.port) { $port = [int]$cfg.port } } catch { }
$hubJs = (Join-Path $hub 'server\hub.js').ToLower()
$procs = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains($hubJs) })
foreach ($p in $procs) { Do-It "stop the VideoHub server (pid $($p.ProcessId))" { Stop-Process -Id $p.ProcessId -Force } }
$agent = Join-Path $hub 'guard\VideoHubAgent.exe'
if (Test-Path $agent) { Do-It 'quit the render protection agent (lifts every CPU cap)' { Start-Process $agent -ArgumentList '--quit' -WindowStyle Hidden -Wait } }

# 2. Claude: MCP server, skill, global rule - only when they belong to THIS install (another VideoHub folder keeps its own)
$mcp = (Join-Path $hub 'server\mcp.js')
$cj = Join-Path $env:USERPROFILE '.claude.json'
$mine = $false
if (Test-Path $cj) { $mine = [IO.File]::ReadAllText($cj).Replace('\\', '\').ToLower().Contains($mcp.ToLower()) }
$claude = (Get-Command claude.exe, claude.cmd -ErrorAction SilentlyContinue | Select-Object -First 1).Source   # not claude.ps1: it is called through cmd
if ($mine) {
  if ($claude) { Do-It 'remove the MCP server "videohub" (claude mcp remove --scope user videohub)' { cmd /c "`"$claude`" mcp remove videohub --scope user >nul 2>&1" } }
  $js = "const fs=require('fs'),f=process.argv[1];let j=JSON.parse(fs.readFileSync(f,'utf8'));if(j.mcpServers&&j.mcpServers.videohub){delete j.mcpServers.videohub;fs.writeFileSync(f,JSON.stringify(j,null,2));console.log('removed')}"
  Do-It "remove videohub from $cj" { & node -e $js $cj }
} else { Say 'The registered MCP server "videohub" is not this install (or none is registered): left alone.' }
$sk = Join-Path $env:USERPROFILE '.claude\skills\videohub'
if ((Test-Path "$sk\SKILL.md") -and -not ([IO.File]::ReadAllText("$sk\SKILL.md").Contains($hub))) { Say "The skill in $sk belongs to another install: left alone."; $sk = $null }
if ($sk -and (Test-Path $sk)) { Do-It "delete the skill folder $sk (to the Recycle Bin)" { Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($sk, 'OnlyErrorDialogs', 'SendToRecycleBin') } }
$cm = Join-Path $env:USERPROFILE '.claude\CLAUDE.md'
if (Test-Path $cm) {
  $cur = [IO.File]::ReadAllText($cm)
  $rx = '\r?\n?' + [regex]::Escape('<!-- videohub:begin') + '[\s\S]*?' + [regex]::Escape('<!-- videohub:end -->') + '\r?\n?'
  if ($cur -match $rx -and $Matches[0].Contains($hub)) { Do-It "remove the VideoHub rule block from $cm" { Copy-Item $cm "$cm.videohub-backup" -Force; [IO.File]::WriteAllText($cm, ([regex]::Replace($cur, $rx, "`r`n")).TrimStart(), (New-Object Text.UTF8Encoding $false)) } }
}

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
