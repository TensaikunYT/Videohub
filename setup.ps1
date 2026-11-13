# VideoHub setup: a short guided install. Safe to run again (it updates instead of duplicating, keeps every answer
# already given and never moves or overwrites your folders or settings). Works from any folder.
#   SETUP.cmd [-DryRun] [-Yes] [answers...]   (or: powershell -NoProfile -ExecutionPolicy Bypass -File setup.ps1 ...)
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
#   -Agents claude,opencode           agents to integrate (default: detected agents)
#   -NoAgent                         (ignored: nothing is built any more; kept so old commands still run)
param([switch]$DryRun, [switch]$Yes, [string]$Workspace = '', [ValidateSet('ask', 'yes', 'no')][string]$WatchFound = 'ask',
  [ValidateSet('ask', 'yes', 'no')][string]$GpuEncoder = 'ask', [ValidateSet('ask', 'yes', 'no')][string]$GlobalRule = 'ask',
  [ValidateSet('ask', 'yes', 'no')][string]$Shortcut = 'ask', [ValidateSet('ask', 'yes', 'no')][string]$Startup = 'ask',
  [ValidateSet('ask', 'yes', 'no')][string]$Example = 'ask', [string[]]$Agents = @(),
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
$agentHelper = Join-Path $hub 'scripts\agents.mjs'
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
# Detect only the agent installations requested by the user; both agents share one skill and rule source.
$found = @(((& node $agentHelper --detect) | ConvertFrom-Json).agents)
if (-not $Agents.Count -and $answers.agents) { $Agents = @($answers.agents) }
if (-not $Agents.Count) {
  if ($found.Count -eq 1) { $Agents = $found }
  elseif ($quiet) { $Agents = if ($found.Count) { $found } else { @('claude') } }
  else {
    Q 'Which coding agents should VideoHub connect to?'
    $recommended = if ($found.Count) { $found -join ',' } else { 'claude' }
    while (-not $Agents.Count) {
      $choice = (Read-Host "  claude, opencode, or claude,opencode [recommended: $recommended]").Trim().ToLower()
      if (-not $choice) { $choice = $recommended }
      $parts = @($choice.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
      if ($parts.Count -and -not @($parts | Where-Object { $_ -notin 'claude','opencode' }).Count) { $Agents = $parts }
      else { Say '  Choose claude, opencode, or claude,opencode.' Yellow }
    }
  }
}
$Agents = @($Agents | ForEach-Object { $_.Split(',') } | ForEach-Object { $_.Trim().ToLower() } | Select-Object -Unique)
if (@($Agents | Where-Object { $_ -notin 'claude','opencode' }).Count) { throw 'Agents must be claude, opencode, or claude,opencode.' }
Keep 'agents' $Agents
Say ('Coding agents: ' + ($Agents -join ', ')) Green

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

# 3. render protection is part of the VideoHub server (CPU limit, low priority, RAM slow mode): nothing to build.
#    (Before Nov 2026 a C# agent, guard\VideoHubAgent.exe, was compiled here; Windows Smart App Control blocked it.)

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

# 5-7. Agent tools, skill, and the optional review-before-rendering rule.
$want = $GlobalRule
if ($want -eq 'ask' -and $answers.globalRule) { $want = $answers.globalRule }
if ($want -eq 'ask') {
  Q 'Should your agent show every new film in VideoHub before rendering?'
  Say '  This adds a short review rule to the selected agents only. Your other rules stay in place.'
  $want = if (YesNo '  Add the rule?' 'ask' $true) { 'yes' } else { 'no' }
}
Keep 'globalRule' $want
$agentArgs = @('--action','setup','--agents',($Agents -join ','),'--global-rule',$want,'--hub',$hub)
if ($DryRun) { $agentArgs += '--dry-run' }
if (-not $st.installed) { $agentArgs += '--set-agent-name' }
$agentResult = (& node $agentHelper @agentArgs) | ConvertFrom-Json
foreach ($line in $agentResult.actions) { Say ('  ' + $line) DarkGray }
foreach ($err in $agentResult.errors) { $todo += $err }
# 8. Desktop shortcut: runs the installed Node.js directly (scripts\install.mjs open), minimized, so its short-lived
#    console stays in the taskbar. No VBScript and no hidden PowerShell are involved.
$desk = [Environment]::GetFolderPath('Desktop'); $lnkPath = Join-Path $desk 'VideoHub.lnk'
$wantLnk = if ($Shortcut -ne 'ask') { $Shortcut -eq 'yes' } elseif (Test-Path $lnkPath) { $true } elseif ($answers.shortcut -eq 'no') { $false }
  else { Q 'A Desktop shortcut opens VideoHub with a double-click.'; YesNo '  Make the shortcut?' 'ask' $true }
Keep 'shortcut' $(if ($wantLnk) { 'yes' } else { 'no' })
if ($wantLnk) {
  if ($DryRun) { Plan "create the Desktop shortcut $lnkPath -> `"$node`" `"$hub\scripts\install.mjs`" open" }
  else {
    $wsh = New-Object -ComObject WScript.Shell
    $lnk = $wsh.CreateShortcut($lnkPath)
    $lnk.TargetPath = $node; $lnk.Arguments = "`"$hub\scripts\install.mjs`" open"
    $lnk.WindowStyle = 7   # minimized
    $lnk.WorkingDirectory = $hub
    $ico = "$hub\data\app.ico"
    if (-not (Test-Path $ico)) { try { & "$hub\scripts\make-icon.ps1" -Out $ico } catch { } }
    if (Test-Path $ico) { $lnk.IconLocation = $ico }
    $lnk.Description = 'VideoHub'
    $lnk.Save()
    Say "Desktop shortcut: $lnkPath" Green
  }
}

# 9. start with Windows: off unless chosen (it can also be switched on later on VideoHub's Renders page)
$rk = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$hasRun = $false; try { $hasRun = [bool](Get-ItemProperty $rk -Name VideoHub -ErrorAction Stop) } catch { }
$wantRun = if ($Startup -ne 'ask') { $Startup -eq 'yes' } elseif ($hasRun) { $true } elseif ($answers.startup) { $answers.startup -eq 'yes' }
  else { Q 'VideoHub can start quietly when you log in (no window), so your agent''s tools and the render queue are always ready.'; YesNo '  Start VideoHub with Windows?' 'ask' $false }
Keep 'startup' $(if ($wantRun) { 'yes' } else { 'no' })
# The entry runs the installed Node.js directly; an older open.vbs entry of this install is re-pointed (same code as
# the Renders page switch: server\platform.js). An entry of another install is left alone.
if ($wantRun) {
  if ($DryRun) { Plan "set the start-up entry $rk\VideoHub = `"$node`" `"$hub\scripts\install.mjs`" open --server" }
  else {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    & node (Join-Path $hub 'scripts\install.mjs') autostart --startup yes | Out-Null; $runCode = $LASTEXITCODE
    $ErrorActionPreference = $old
    if ($runCode -eq 0) { Say $(if ($hasRun) { 'VideoHub starts with Windows (entry checked).' } else { 'VideoHub starts with Windows (server only, no window)' }) Green }
    else { $todo += 'The "start with Windows" entry belongs to another VideoHub folder or could not be set; switch it on the Renders page.' }
  }
}

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
if ($wantLnk) { Say '  Open VideoHub with the VideoHub shortcut on your Desktop.' } else { Say "  Open VideoHub: double-click open.cmd in $hub" }
Say '  Start a NEW agent session (Claude Code or OpenCode; existing sessions do not see new tools).'
if ($wantEx -or $exHave) { Say '  First thing to try: click the "hello-film" card in VideoHub, press Space to play it, click a frame to leave a note.' }
else { Say '  First thing to try: ask your agent "make me a 10-second animated title as a VideoHub film" and watch it appear in VideoHub.' }
if ($DryRun) { Say ''; Say 'Dry run finished: nothing outside this folder was changed.' Yellow }
if ($todo.Count) { Say ''; Say 'Left for you to do:' Yellow; $todo | ForEach-Object { Say " - $_" Yellow } }
