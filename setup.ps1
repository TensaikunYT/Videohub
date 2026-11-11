# VideoHub setup: a short guided install. Safe to run again (it updates instead of duplicating, keeps every answer
# already given and never moves or overwrites your folders or settings). Works from any folder.
#   powershell -ExecutionPolicy Bypass -File setup.ps1 [-DryRun] [-Yes] [answers...]
#   -DryRun            ask nothing, assume the recommended answers and print every step; change nothing outside this folder
#   -Yes               accept every recommended answer, ask nothing
# Answers (each question has one; "ask" = ask when needed, the default):
#   -Workspace <folder>              where your video work lives (default Documents\VideoHub)
#   -WatchFound ask|yes|no           also watch video folders found on the Desktop / in Documents (recommended: no)
#   -GpuEncoder ask|yes|no           render with the graphics card's video encoder when it has one (recommended: yes)
#   -GlobalRule ask|yes|no           add the "review before rendering" rule to ~/.claude/CLAUDE.md (recommended: yes)
#   -Shortcut ask|yes|no             Desktop shortcut (recommended: yes); -NoShortcut = no
#   -Startup ask|yes|no              start VideoHub (server only, no window) when you log in (recommended: no); -StartWithWindows = yes
#   -Example ask|yes|no              add the example film (recommended: yes)
#   -NoAgent                         do not build the render protection agent
param([switch]$DryRun, [switch]$Yes, [string]$Workspace = '', [ValidateSet('ask', 'yes', 'no')][string]$WatchFound = 'ask',
  [ValidateSet('ask', 'yes', 'no')][string]$GpuEncoder = 'ask', [ValidateSet('ask', 'yes', 'no')][string]$GlobalRule = 'ask',
  [ValidateSet('ask', 'yes', 'no')][string]$Shortcut = 'ask', [ValidateSet('ask', 'yes', 'no')][string]$Startup = 'ask',
  [ValidateSet('ask', 'yes', 'no')][string]$Example = 'ask',
  [switch]$NoShortcut, [switch]$NoAgent, [switch]$NoGuard, [switch]$StartWithWindows, [switch]$Test)
if ($Test) { $DryRun = $true }          # older name
if ($NoGuard) { $NoAgent = $true }      # older name
if ($NoShortcut) { $Shortcut = 'no' }
if ($StartWithWindows) { $Startup = 'yes' }
$ErrorActionPreference = 'Stop'
$hub = $PSScriptRoot
$quiet = $DryRun -or $Yes   # no questions: the recommended answers
try { [Console]::OutputEncoding = New-Object Text.UTF8Encoding $false } catch { }   # folder names with non-English letters from Node
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Plan($m) { Write-Host "  [dry run] would: $m" -ForegroundColor DarkCyan }
function Q($m) { Write-Host ''; Write-Host $m -ForegroundColor White }
# a yes/no question: $preset (from a parameter) wins; Enter = the recommended answer
function YesNo($question, $preset, [bool]$recommended) {
  if ($preset -eq 'yes') { return $true }; if ($preset -eq 'no') { return $false }
  if ($quiet) { Say "$question -> $(if ($recommended) { 'yes' } else { 'no' }) (recommended)" DarkGray; return $recommended }
  $hint = if ($recommended) { '[Y/n]' } else { '[y/N]' }
  while ($true) {
    $a = (Read-Host "$question $hint").Trim().ToLower()
    if (-not $a) { return $recommended }
    if ($a -match '^(y|yes)$') { return $true }; if ($a -match '^(n|no)$') { return $false }
    Say '  Please type y (yes) or n (no), or press Enter for the recommended answer.' Yellow
  }
}
$todo = @()
$claudeHome = Join-Path $env:USERPROFILE '.claude'
$init = Join-Path $hub 'scripts\init-config.mjs'
# answers this PC already gave (so a second run does not ask them again); data\ is per machine, never in git
$answersFile = Join-Path $hub 'data\setup-answers.json'
$answers = @{}
try { (Get-Content $answersFile -Raw -Encoding UTF8 | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $answers[$_.Name] = $_.Value } } catch { }
function Keep($name, $value) { $script:answers[$name] = $value }

Say "== VideoHub setup: $hub" Cyan
if ($DryRun) { Say 'Dry run: no questions, the recommended answers, nothing outside this folder is changed.' Yellow }
elseif ($Yes) { Say 'Using the recommended answer for every question.' Yellow }
else { Say 'A few plain questions follow. Press Enter to take the recommended answer shown in [brackets].' }

# 1. tools: what is missing, why it is needed, the exact command, and what to do next
$missing = "then double-click SETUP.cmd again."
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
$major = if ($node) { [int]((& node -v).TrimStart('v').Split('.')[0]) } else { 0 }
if ($major -lt 22) {
  Say ''
  if ($node) { Say "Node.js is too old here (version $major; VideoHub needs 22 or newer)." Red } else { Say 'Node.js is missing.' Red }
  Say 'VideoHub is a small program written for Node.js, so it cannot run without it.' Red
  Say 'Install it: open the Start menu, type "PowerShell", open it, paste this line and press Enter:' White
  Say '    winget install -e --id OpenJS.NodeJS.LTS' Cyan
  Say "When it has finished, close that window and $missing" White
  exit 1
}
Say "Node.js $(& node -v): ok" Green
$ff = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
if (-not $ff -and (Test-Path 'C:\ffmpeg\bin\ffmpeg.exe')) { $ff = 'C:\ffmpeg\bin\ffmpeg.exe' }
if ($ff) { Say "ffmpeg: ok ($ff)" Green } else {
  Say 'ffmpeg is missing. VideoHub still lists your films, but it needs ffmpeg to make videos (renders), previews and frame pictures.' Yellow
  Say '  Install it: paste this into PowerShell and press Enter:   winget install -e --id Gyan.FFmpeg' Yellow
  Say "  Then close PowerShell and $missing" Yellow
  $todo += 'Install ffmpeg (renders need it):  winget install -e --id Gyan.FFmpeg   - then double-click SETUP.cmd again'
}
$browser = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($browser) { Say "Browser for rendering: ok ($browser)" Green } else {
  Say 'No Microsoft Edge or Google Chrome found. Renders draw every frame in one of them (invisibly), so they need one.' Yellow
  Say '  Install Chrome: paste this into PowerShell and press Enter:   winget install -e --id Google.Chrome' Yellow
  Say "  Then $missing" Yellow
  $todo += 'Install Edge or Chrome (renders use it):  winget install -e --id Google.Chrome   - then double-click SETUP.cmd again'
}
$claude = (Get-Command claude.exe, claude.cmd -ErrorAction SilentlyContinue | Select-Object -First 1).Source   # not claude.ps1: it is called through cmd
if (-not $claude) { $claude = Get-ChildItem "$env:LOCALAPPDATA\Claude-Data\*\claude-code\*\*\claude.exe" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName }
if ($claude) { Say "Claude Code: ok ($claude)" Green } else { Say 'Claude Code was not found. VideoHub works without it, but Claude Code is what writes the films: https://claude.com/claude-code (the Claude tools are registered anyway).' Yellow }

# 2. packages (inside this folder)
if ($DryRun) { Plan "npm install in $hub" }
else {
  Push-Location $hub
  try { cmd /c "npm install --no-audit --no-fund --loglevel=error"; if ($LASTEXITCODE -ne 0) { throw 'npm install failed' } } finally { Pop-Location }
  Say 'Packages: ok' Green
}

# a git clone of a browser-uploaded repo has no .gitignore: keep this PC's files out of git in the clone itself
$gitInfo = Join-Path $hub '.git\info'
if ((Test-Path $gitInfo) -and -not (Test-Path (Join-Path $hub '.gitignore')) -and -not $DryRun) {
  $ex = Join-Path $gitInfo 'exclude'; $have = if (Test-Path $ex) { Get-Content $ex } else { @() }
  $want = 'node_modules/','data/','guard/*.exe','guard/app.ico','*.log','.test-tmp/','examples/*/render/','examples/*/.videohub/','examples/*/node_modules/' | Where-Object { $have -notcontains $_ }
  if ($want) { Add-Content -Path $ex -Value $want -Encoding ascii }
}

# 3. render protection agent (guard\VideoHubAgent.exe: CPU caps, RAM slow mode, pause hotkeys). Invisible part of VideoHub
#    (no window, no tray icon); the hub starts and stops it. Optional: without it renders run unprotected.
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not $NoAgent) {
  if (-not (Test-Path $csc)) { Say "The .NET Framework 4 C# compiler is missing ($csc), so the render protection agent cannot be built. VideoHub works without it; renders just run without CPU/RAM protection. (It ships with Windows 10/11; if it is missing, turn on '.NET Framework 4.8' in Windows Features.)" Yellow; $todo += 'Optional: render protection agent not built (no csc.exe)' }
  elseif ($DryRun) { Plan "build guard\VideoHubAgent.exe with $csc (guard\build.ps1)" }
  else { try { & "$hub\guard\build.ps1"; Say 'Render protection agent built (guard\VideoHubAgent.exe)' Green } catch { Say "The render protection agent could not be built: $_  (VideoHub works without it.)" Yellow; $todo += 'Optional: render protection agent not built (guard\build.ps1)' } }
}

# 4. the workspace, folders found on this PC and render speed: asked here, decided and written by scripts\init-config.mjs
$st = (& node $init --state) | ConvertFrom-Json
if ($st.error) { Say $st.error Red; exit 1 }
$ws = $null; $watch = @(); $enc = $null
if ($st.installed) {
  Say ''; Say "Your video work lives in: $($st.workspace)  (already set; change single folders in VideoHub > Settings)" Green
} else {
  Q 'Where should your video work live?'
  Say "  One folder holds everything VideoHub makes: your films, every finished video (outputs), sounds, thumbnails" Gray
  Say "  and an archive for old versions. Recommended: $($st.defaultWorkspace)" Gray
  if ($Workspace) { $ws = $Workspace } elseif ($quiet) { $ws = $st.defaultWorkspace }
  while ($true) {
    if (-not $ws) {
      $a = (Read-Host "  Press Enter for the recommended folder, or type another full path").Trim().Trim('"')
      $ws = if ($a) { $a } else { $st.defaultWorkspace }
    }
    $chk = (& node $init --check $ws) | ConvertFrom-Json
    if ($chk.ok) { break }
    Say "  $($chk.why)" Yellow
    if ($Workspace -or $quiet) { exit 1 }
    $ws = $null
  }
  Say "  Workspace: $ws" Green
  if (@($st.discovered).Count) {
    Q 'VideoHub found folders that look like video work:'
    $st.discovered | ForEach-Object { Say "  - $($_.path)" Gray }
    Say '  It can list the films in them too (it never moves or changes them). You can also turn them on later in' Gray
    Say '  VideoHub > Settings > Watched folders.' Gray
    if (YesNo '  Watch these folders as well?' $WatchFound $false) { $watch = @($st.discovered | ForEach-Object { $_.path }) }
  }
}
if ($st.encoder) { Say "Render speed: $($st.encoder) (already set; change it in VideoHub > Settings > Render speed)" Green }
elseif (-not $ff) { $enc = 'auto'; Say 'Render speed: decided once ffmpeg is installed (run setup again then).' Yellow }
else {
  $det = if ($DryRun) { (& node $init --detect --ffmpeg $ff --dry-run) | ConvertFrom-Json } else { (& node $init --detect --ffmpeg $ff) | ConvertFrom-Json }
  $gpu = @($det.available | Where-Object { $_ -ne 'x264' })
  if ($gpu.Count) {
    $name = if (@($det.gpus).Count) { @($det.gpus)[0] } else { 'graphics card' }
    Q "Your graphics card ($name) can encode video."
    $enc = if (YesNo '  Use it for renders? Same picture quality, usually faster, and your processor stays free.' $GpuEncoder $true) { 'auto' } else { 'x264' }
  } else { $enc = 'auto'; Say ''; Say 'Renders will use the processor (no graphics-card video encoder was found on this PC).' Gray }
}
$argsInit = @()
if ($ws) { $argsInit += @('--workspace', $ws) }
foreach ($w in $watch) { $argsInit += @('--watch', $w) }
if ($enc) { $argsInit += @('--encoder', $enc) }
if ($DryRun) { $argsInit += '--dry-run' }
$res = (& node $init @argsInit) | ConvertFrom-Json
if ($res.error) { Say $res.error Red; exit 1 }
foreach ($line in $res.actions) { if ($line -match '^would ') { Plan ($line -replace '^would ', '') } else { Say "  $line" DarkGray } }
$wsNow = $res.workspace

# 5. MCP server "videohub" for every Claude Code session (user scope)
$mcp = Join-Path $hub 'server\mcp.js'
if ($DryRun) { Plan "register the MCP server: claude mcp add --scope user videohub -- node `"$mcp`"  (or write it into $env:USERPROFILE\.claude.json)" }
else {
  $registered = $false
  if ($claude) {
    # PowerShell 5.1 turns a native program's stderr into errors; these calls may legitimately print to stderr
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
      cmd /c "`"$claude`" mcp remove videohub --scope user >nul 2>&1"
      cmd /c "`"$claude`" mcp add --scope user videohub -- node `"$mcp`" >nul 2>&1"
      $registered = ($LASTEXITCODE -eq 0)
    } finally { $ErrorActionPreference = $old }
  }
  if (-not $registered) {
    # no CLI: merge into ~/.claude.json ourselves (backup first). Missing: create it; there but not readable JSON: write
    # nothing and exit 2 (the manual command is shown below), never replace the user's settings with {}
    $cj = Join-Path $env:USERPROFILE '.claude.json'
    if (Test-Path $cj) { Copy-Item $cj "$cj.videohub-backup" -Force }
    $js = "const fs=require('fs'),f=process.argv[1];let j={};if(fs.existsSync(f)){try{j=JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,''))}catch{process.exit(2)}if(!j||typeof j!=='object'||Array.isArray(j))process.exit(2)}j.mcpServers=j.mcpServers||{};j.mcpServers.videohub={type:'stdio',command:'node',args:[process.argv[2]],env:{}};fs.writeFileSync(f,JSON.stringify(j,null,2));"
    & node -e $js $cj $mcp
    $registered = ($LASTEXITCODE -eq 0)
  }
  if ($registered) { Say 'Claude tools (MCP server "videohub") registered; new Claude Code sessions will see the hub_* tools' Green } else { $todo += 'The MCP server could not be registered: claude mcp add --scope user videohub -- node "' + $mcp + '"' }
}

# 6. the skill Claude reads (~/.claude/skills/videohub), with this install's path filled in
$sk = Join-Path $claudeHome 'skills\videohub'
if ($DryRun) { Plan "copy skill\videohub to $sk (with {{VIDEOHUB_DIR}} = $hub)" }
else {
  New-Item -ItemType Directory -Force $sk | Out-Null
  foreach ($f in Get-ChildItem "$hub\skill\videohub" -File) {
    $txt = [IO.File]::ReadAllText($f.FullName).Replace('{{VIDEOHUB_DIR}}', $hub)
    [IO.File]::WriteAllText((Join-Path $sk $f.Name), $txt, (New-Object Text.UTF8Encoding $false))
  }
  Say "Skill installed: $sk" Green
}

# 7. the global rule: every Claude Code session on this PC reviews films in VideoHub before rendering.
#    Kept between marker lines in ~/.claude/CLAUDE.md, replaced on the next run, removed by uninstall.ps1.
$cm = Join-Path $claudeHome 'CLAUDE.md'
$begin = '<!-- videohub:begin (added by VideoHub setup; remove with uninstall.ps1) -->'; $end = '<!-- videohub:end -->'
$rule = [IO.File]::ReadAllText((Join-Path $hub 'claude\global-rule.md')).Replace('{{VIDEOHUB_DIR}}', $hub).Trim()
$cur = if (Test-Path $cm) { [IO.File]::ReadAllText($cm) } else { '' }
$rx = [regex]::Escape($begin) + '[\s\S]*?' + [regex]::Escape($end)
$want = $GlobalRule
if ($want -eq 'ask' -and $cur -match $rx) { $want = 'yes' }                 # added on an earlier run: refreshed, not asked again
elseif ($want -eq 'ask' -and $answers.globalRule -eq 'no') { $want = 'no' }  # declined on an earlier run
if ($want -eq 'ask') {
  Q 'Should Claude show you every new film in VideoHub before it renders?'
  Say '  This adds a short rule to your Claude instructions (~/.claude/CLAUDE.md): Claude opens each new film in' Gray
  Say '  VideoHub''s live preview and waits for your notes before making the video. uninstall.ps1 removes it again.' Gray
  $want = if (YesNo '  Add the rule?' 'ask' $true) { 'yes' } else { 'no' }
}
Keep 'globalRule' $want
if ($want -eq 'yes') {
  $block = "$begin`r`n$rule`r`n$end"
  $new = if ($cur -match $rx) { [regex]::Replace($cur, $rx, [System.Text.RegularExpressions.MatchEvaluator] { param($m) $block }) } elseif ($cur.Trim()) { $cur.TrimEnd() + "`r`n`r`n" + $block + "`r`n" } else { $block + "`r`n" }
  if ($DryRun) { Plan "write this block into $cm (replacing an older VideoHub block if there is one):"; Write-Host $block -ForegroundColor DarkGray }
  else {
    New-Item -ItemType Directory -Force $claudeHome | Out-Null
    if (Test-Path $cm) { Copy-Item $cm "$cm.videohub-backup" -Force }
    [IO.File]::WriteAllText($cm, $new, (New-Object Text.UTF8Encoding $false))
    Say "Global rule added to $cm (backup: CLAUDE.md.videohub-backup)" Green
  }
} else { Say 'Global rule skipped (run setup again with -GlobalRule yes to add it later).' }

# 8. Desktop shortcut (VideoHub opens through open.vbs: no console window)
$desk = [Environment]::GetFolderPath('Desktop'); $lnkPath = Join-Path $desk 'VideoHub.lnk'
$wantLnk = if ($Shortcut -ne 'ask') { $Shortcut -eq 'yes' } elseif (Test-Path $lnkPath) { $true } elseif ($answers.shortcut -eq 'no') { $false }
  else { Q 'A Desktop shortcut opens VideoHub with a double-click.'; YesNo '  Make the shortcut?' 'ask' $true }
Keep 'shortcut' $(if ($wantLnk) { 'yes' } else { 'no' })
if ($wantLnk) {
  if ($DryRun) { Plan "create the Desktop shortcut $lnkPath -> wscript `"$hub\open.vbs`"" }
  else {
    $wsh = New-Object -ComObject WScript.Shell
    $lnk = $wsh.CreateShortcut($lnkPath)
    $lnk.TargetPath = "$env:SystemRoot\System32\wscript.exe"; $lnk.Arguments = "`"$hub\open.vbs`""
    $lnk.WorkingDirectory = $hub
    if (Test-Path "$hub\guard\app.ico") { $lnk.IconLocation = "$hub\guard\app.ico" }
    $lnk.Description = 'VideoHub'
    $lnk.Save()
    Say "Desktop shortcut: $lnkPath" Green
  }
}

# 9. start with Windows: off unless chosen (it can also be switched on later on VideoHub's Renders page)
$rk = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$hasRun = $false; try { $hasRun = [bool](Get-ItemProperty $rk -Name VideoHub -ErrorAction Stop) } catch { }
$wantRun = if ($Startup -ne 'ask') { $Startup -eq 'yes' } elseif ($hasRun) { $true } elseif ($answers.startup) { $answers.startup -eq 'yes' }
  else { Q 'VideoHub can start quietly when you log in (no window), so Claude''s tools and the render queue are always ready.'; YesNo '  Start VideoHub with Windows?' 'ask' $false }
Keep 'startup' $(if ($wantRun) { 'yes' } else { 'no' })
if ($wantRun -and -not $hasRun) {
  $val = "`"$env:SystemRoot\System32\wscript.exe`" `"$hub\open.vbs`" --server"
  if ($DryRun) { Plan "add the start-up entry $rk\VideoHub = $val" } else { Set-ItemProperty $rk -Name VideoHub -Value $val; Say 'VideoHub starts with Windows (server only, no window)' Green }
} elseif ($wantRun) { Say 'VideoHub starts with Windows (already set).' Green }

# 10. the example film: a 10-second film that shows the whole loop (the same copy as the Welcome panel's button)
$exDest = Join-Path $wsNow 'films\hello-film'
$exHave = Test-Path (Join-Path $exDest 'index.html')
$wantEx = if ($Example -ne 'ask') { $Example -eq 'yes' } elseif ($exHave -or $answers.example) { $false }   # there already, or answered on an earlier run
  else { Q 'Add the example film so you can try VideoHub right away? (a 10-second film; delete it whenever you like)'; YesNo '  Add it?' 'ask' $true }
if (-not $answers.example) { Keep 'example' $(if ($wantEx -or $exHave) { 'yes' } else { 'no' }) }
if ($wantEx) {
  if ($DryRun) { Plan "copy examples\hello-film into $(Join-Path $wsNow 'films') (unless it is there already)" }
  else {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $ex = (& node $init --example) | ConvertFrom-Json
    $ErrorActionPreference = $old
    if ($ex.error) { Say "The example film could not be added: $($ex.error)  (the Welcome panel in VideoHub offers it too)" Yellow }
    elseif ($ex.kept) { Say "The example film is already there: $($ex.target)" Green } else { Say "Example film added: $($ex.path)" Green }
  }
}

# remember the answers (a second run shows them instead of asking)
if ($DryRun) { Plan "remember the answers in $answersFile" }
else { New-Item -ItemType Directory -Force (Split-Path $answersFile) | Out-Null; [IO.File]::WriteAllText($answersFile, ($answers | ConvertTo-Json), (New-Object Text.UTF8Encoding $false)) }

Say ''
Say '== Done. What now:' Cyan
Say "  Your video work lives in  $wsNow  (films, outputs, sounds, thumbnails, archive; README.txt says what each is)."
if ($wantLnk) { Say '  Open VideoHub with the VideoHub shortcut on your Desktop.' } else { Say "  Open VideoHub: double-click open.vbs in $hub" }
Say '  Start a NEW Claude Code session (sessions already open do not see VideoHub''s tools).'
if ($wantEx -or $exHave) { Say '  First thing to try: click the "hello-film" card in VideoHub, press Space to play it, click a frame to leave a note.' }
else { Say '  First thing to try: ask Claude Code "make me a 10-second animated title as a VideoHub film" and watch it appear in VideoHub.' }
if ($DryRun) { Say ''; Say 'Dry run finished: nothing outside this folder was changed.' Yellow }
if ($todo.Count) { Say ''; Say 'Left for you to do:' Yellow; $todo | ForEach-Object { Say " - $_" Yellow } }
