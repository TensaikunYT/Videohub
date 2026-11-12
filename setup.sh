#!/bin/bash
# VideoHub setup for a Mac: a short guided install (the counterpart of setup.ps1). Safe to run again: it keeps every
# answer already given and never moves or overwrites your folders or settings. Works from any folder.
#   bash setup.sh [--dry-run] [--yes] [answers...]          (or double-click SETUP.command)
#   --dry-run              ask nothing, assume the recommended answers and print every step; change nothing outside this folder
#   --yes                  accept every recommended answer, ask nothing
# Answers (each question has one; "ask" = ask when needed, the default):
#   --workspace <folder>               where your video work lives (default ~/Movies/VideoHub)
#   --watch-found ask|yes|no           also watch video folders found on the Desktop / in Documents / Movies (recommended: no)
#   --gpu-encoder ask|yes|no           render with the Apple media engine (VideoToolbox) when the Mac has it (recommended: yes)
#   --global-rule ask|yes|no           add the "review before rendering" rule to ~/.claude/CLAUDE.md (recommended: yes)
#   --app ask|yes|no                   VideoHub.app in ~/Applications: Spotlight, Launchpad, the Dock (recommended: yes)
#   --login ask|yes|no                 start VideoHub (server only, no window) when you log in (recommended: no)
#   --example ask|yes|no               add the example film (recommended: yes)
#   --no-keys                          do not build the emergency hotkeys helper (guard/VideoHubKeys)
set -u
hub="$(cd "$(dirname "$0")" && pwd)"
DRY=0; YES=0; WS=''; WATCH=ask; GPU=ask; RULE=ask; APP=ask; LOGIN=ask; EXAMPLE=ask; KEYS=1
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run|-n) DRY=1 ;; --yes|-y) YES=1 ;; --no-keys) KEYS=0 ;;
    --workspace) WS="${2:-}"; shift ;; --watch-found) WATCH="${2:-ask}"; shift ;; --gpu-encoder) GPU="${2:-ask}"; shift ;;
    --global-rule) RULE="${2:-ask}"; shift ;; --app|--shortcut) APP="${2:-ask}"; shift ;; --login|--startup) LOGIN="${2:-ask}"; shift ;;
    --example) EXAMPLE="${2:-ask}"; shift ;;
    -h|--help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (see bash setup.sh --help)"; exit 2 ;;
  esac
  shift
done
QUIET=$(( DRY || YES ))
if [ -t 1 ]; then C0=$'\033[0m'; CY=$'\033[36m'; GR=$'\033[32m'; YE=$'\033[33m'; RE=$'\033[31m'; DI=$'\033[2m'; WH=$'\033[1m'; else C0=; CY=; GR=; YE=; RE=; DI=; WH=; fi
say() { printf '%s%s%s\n' "${2:-}" "$1" "$C0"; }
plan() { say "  [dry run] would: $1" "$CY"; }
q() { echo; say "$1" "$WH"; }
TODO=()
# a yes/no question: a preset (from an option) wins; Enter = the recommended answer
yesno() { # question preset recommended(1/0)
  local question="$1" preset="$2" rec="$3" a hint
  [ "$preset" = yes ] && return 0; [ "$preset" = no ] && return 1
  if [ "$QUIET" = 1 ]; then say "$question -> $([ "$rec" = 1 ] && echo yes || echo no) (recommended)" "$DI"; [ "$rec" = 1 ]; return; fi
  hint='[y/N]'; [ "$rec" = 1 ] && hint='[Y/n]'
  while true; do
    read -r -p "$question $hint " a; a="$(echo "$a" | tr '[:upper:]' '[:lower:]' | xargs)"
    [ -z "$a" ] && { [ "$rec" = 1 ]; return; }
    case "$a" in y|yes) return 0 ;; n|no) return 1 ;; esac
    say '  Please type y (yes) or n (no), or press Enter for the recommended answer.' "$YE"
  done
}
json() { "$NODE" -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j;try{j=JSON.parse(d)}catch{process.exit(1)}for(const k of process.argv[1].split("."))j=j==null?j:j[k];process.stdout.write(j==null?"":typeof j==="object"?JSON.stringify(j):String(j))})' "$1"; }

say "== VideoHub setup: $hub" "$CY"
if [ "$DRY" = 1 ]; then say 'Dry run: no questions, the recommended answers, nothing outside this folder is changed.' "$YE"
elif [ "$YES" = 1 ]; then say 'Using the recommended answer for every question.' "$YE"
else say 'A few plain questions follow. Press Enter to take the recommended answer shown in [brackets].'; fi
again='then run this setup again (double-click SETUP.command, or: bash setup.sh).'
macos="$(sw_vers -productVersion 2>/dev/null)"; arch="$(uname -m)"
say "macOS $macos on $([ "$arch" = arm64 ] && echo 'Apple silicon' || echo 'Intel')" "$DI"

# 1. tools: what is missing, why it is needed, the exact command, and what to do next
BREW="$(command -v brew 2>/dev/null || true)"; for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -z "$BREW" ] && [ -x "$b" ] && BREW="$b"; done
NODE=''
for c in "$(command -v node 2>/dev/null)" /opt/homebrew/bin/node /usr/local/bin/node /opt/local/bin/node; do [ -n "$c" ] && [ -x "$c" ] && { NODE="$c"; break; }; done
major=0; [ -n "$NODE" ] && major="$("$NODE" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$major" -lt 22 ]; then
  echo
  if [ -n "$NODE" ]; then say "Node.js is too old here (version $major; VideoHub needs 22 or newer)." "$RE"; else say 'Node.js is missing.' "$RE"; fi
  say 'VideoHub is a small program written for Node.js, so it cannot run without it.' "$RE"
  if [ -n "$BREW" ]; then say 'Install it: paste this into Terminal and press Return:' "$WH"; say '    brew install node' "$CY"
  else say 'Install it: download the "LTS" macOS installer from https://nodejs.org (Node 22 works on macOS 11 Big Sur and newer).' "$WH"; fi
  say "When it has finished, $again" "$WH"
  exit 1
fi
NODE="$("$NODE" "$hub/scripts/mac-install.mjs" node 2>/dev/null || echo "$NODE")"   # a path that survives Node upgrades
say "Node.js $("$NODE" -v): ok ($NODE)" "$GR"
FF="$(command -v ffmpeg 2>/dev/null || true)"; for c in /opt/homebrew/bin/ffmpeg /usr/local/bin/ffmpeg /opt/local/bin/ffmpeg; do [ -z "$FF" ] && [ -x "$c" ] && FF="$c"; done
if [ -n "$FF" ]; then say "ffmpeg: ok ($FF)" "$GR"; else
  say 'ffmpeg is missing. VideoHub still lists your films, but it needs ffmpeg to make videos (renders), previews and frame pictures.' "$YE"
  if [ -n "$BREW" ]; then say '  Install it: paste this into Terminal and press Return:   brew install ffmpeg' "$YE"; TODO+=("Install ffmpeg (renders need it):  brew install ffmpeg   - $again")
  else say '  Install it with Homebrew (https://brew.sh, then: brew install ffmpeg), or put a ready-made ffmpeg and ffprobe in /usr/local/bin (https://ffmpeg.org/download.html#build-mac).' "$YE"; TODO+=("Install ffmpeg (renders need it): https://brew.sh then brew install ffmpeg - $again"); fi
  say "  Then $again" "$YE"
fi
BROWSER=''
for app in 'Google Chrome' 'Microsoft Edge' 'Brave Browser' 'Chromium'; do for d in /Applications "$HOME/Applications"; do [ -z "$BROWSER" ] && [ -x "$d/$app.app/Contents/MacOS/$app" ] && BROWSER="$d/$app.app"; done; done
if [ -n "$BROWSER" ]; then say "Browser for rendering: ok ($BROWSER)" "$GR"; else
  say 'No Google Chrome, Microsoft Edge, Brave or Chromium found. Renders draw every frame in one of them (invisibly), so they need one. (Safari cannot be driven for renders.)' "$YE"
  say "  Install Chrome from https://www.google.com/chrome$([ -n "$BREW" ] && echo ' (or: brew install --cask google-chrome)'), then $again" "$YE"
  TODO+=("Install Google Chrome (renders use it): https://www.google.com/chrome - $again")
fi
CLAUDE="$(command -v claude 2>/dev/null || true)"; for c in "$HOME/.local/bin/claude" "$HOME/.claude/local/claude" /opt/homebrew/bin/claude /usr/local/bin/claude; do [ -z "$CLAUDE" ] && [ -x "$c" ] && CLAUDE="$c"; done
if [ -n "$CLAUDE" ]; then say "Claude Code: ok ($CLAUDE)" "$GR"; else say 'Claude Code was not found. VideoHub works without it, but Claude Code is what writes the films: https://claude.com/claude-code (the Claude tools are registered anyway).' "$YE"; fi

# 2. packages (inside this folder)
if [ "$DRY" = 1 ]; then plan "npm install in $hub"
else
  NPM="$(dirname "$NODE")/npm"; [ -x "$NPM" ] || NPM="$(command -v npm)"
  ( cd "$hub" && PATH="$(dirname "$NODE"):$PATH" "$NPM" install --no-audit --no-fund --loglevel=error ) || { say 'npm install failed (see the lines above).' "$RE"; exit 1; }
  say 'Packages: ok' "$GR"
fi
# a browser-uploaded repo (or some ZIP tools) loses the executable bit: double-clicking SETUP.command needs it back
[ "$DRY" = 0 ] && chmod +x "$hub"/*.command "$hub"/*.sh "$hub/guard/build-mac.sh" 2>/dev/null
# a git clone of a browser-uploaded repo has no .gitignore: keep this Mac's files out of git in the clone itself
if [ -d "$hub/.git/info" ] && [ ! -f "$hub/.gitignore" ] && [ "$DRY" = 0 ]; then
  for l in 'node_modules/' 'data/' 'guard/*.exe' 'guard/app.ico' 'guard/VideoHubKeys' '*.log' '.test-tmp/' 'examples/*/render/' 'examples/*/.videohub/' 'examples/*/node_modules/' '.DS_Store'; do
    grep -qxF "$l" "$hub/.git/info/exclude" 2>/dev/null || echo "$l" >> "$hub/.git/info/exclude"
  done
fi

# 3. render protection. The agent itself is Node (guard/agent-mac.mjs: nothing to build). Its emergency hotkeys
#    (⌃⌥⌘P pause, ⌃⌥⌘R resume) need a tiny helper built with swiftc; optional.
if [ "$KEYS" = 1 ]; then
  if ! xcrun --find swiftc >/dev/null 2>&1; then say "The emergency hotkeys need Apple's Command Line Tools (to build guard/VideoHubKeys). Render protection works without them; the Renders page has Pause all / Resume all. To add them later: xcode-select --install, then run setup again." "$YE"; TODO+=('Optional: emergency hotkeys not built (xcode-select --install, then run setup again)')
  elif [ -x "$hub/guard/VideoHubKeys" ] && [ "$hub/guard/VideoHubKeys" -nt "$hub/guard/keys-mac.swift" ]; then say 'Emergency hotkeys: ok (guard/VideoHubKeys)' "$GR"
  elif [ "$DRY" = 1 ]; then plan 'build guard/VideoHubKeys (guard/build-mac.sh)'
  elif bash "$hub/guard/build-mac.sh" >/dev/null 2>&1; then say 'Emergency hotkeys built (guard/VideoHubKeys: ⌃⌥⌘P pauses every render, ⌃⌥⌘R resumes)' "$GR"
  else say 'The emergency hotkeys could not be built (bash guard/build-mac.sh shows why). Render protection works without them.' "$YE"; TODO+=('Optional: emergency hotkeys not built (bash guard/build-mac.sh)'); fi
fi

# 4. the workspace, folders found on this Mac and render speed: asked here, decided and written by scripts/init-config.mjs
init="$hub/scripts/init-config.mjs"
st="$("$NODE" "$init" --state)"; err="$(echo "$st" | json error)"; [ -n "$err" ] && { say "$err" "$RE"; exit 1; }
ws=''; WATCHES=(); enc=''
if [ "$(echo "$st" | json installed)" = true ]; then
  echo; say "Your video work lives in: $(echo "$st" | json workspace)  (already set; change single folders in VideoHub > Settings)" "$GR"
else
  def="$(echo "$st" | json defaultWorkspace)"
  q 'Where should your video work live?'
  say '  One folder holds everything VideoHub makes: your films, every finished video (outputs), sounds, thumbnails' "$DI"
  say "  and an archive for old versions. Recommended: $def" "$DI"
  say '  (Movies is not synced to iCloud, so renders are not uploaded while they are made.)' "$DI"
  if [ -n "$WS" ]; then ws="$WS"; elif [ "$QUIET" = 1 ]; then ws="$def"; fi
  while true; do
    if [ -z "$ws" ]; then read -r -p '  Press Return for the recommended folder, or type another full path (you can drag a folder in here): ' a; a="$(echo "$a" | sed -e "s/^[\"']//" -e "s/[\"']$//" -e 's/\\ / /g' -e 's/[[:space:]]*$//')"; ws="${a:-$def}"; fi
    chk="$("$NODE" "$init" --check "$ws")"
    [ "$(echo "$chk" | json ok)" = true ] && { ws="$(echo "$chk" | json path)"; break; }
    say "  $(echo "$chk" | json why)" "$YE"
    { [ -n "$WS" ] || [ "$QUIET" = 1 ]; } && exit 1
    ws=''
  done
  say "  Workspace: $ws" "$GR"
  found="$(echo "$st" | "$NODE" -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{for(const r of JSON.parse(d).discovered||[])console.log(r.path)})')"
  if [ -n "$found" ]; then
    q 'VideoHub found folders that look like video work:'
    echo "$found" | sed 's/^/  - /'
    say '  It can list the films in them too (it never moves or changes them). You can also turn them on later in' "$DI"
    say '  VideoHub > Settings > Watched folders.' "$DI"
    if yesno '  Watch these folders as well?' "$WATCH" 0; then while IFS= read -r l; do [ -n "$l" ] && WATCHES+=("$l"); done <<< "$found"; fi
  fi
fi
if [ -n "$(echo "$st" | json encoder)" ]; then say "Render speed: $(echo "$st" | json encoder) (already set; change it in VideoHub > Settings > Render speed)" "$GR"
elif [ -z "$FF" ]; then enc=auto; say 'Render speed: decided once ffmpeg is installed (run setup again then).' "$YE"
else
  if [ "$DRY" = 1 ]; then det="$("$NODE" "$init" --detect --ffmpeg "$FF" --dry-run)"; else det="$("$NODE" "$init" --detect --ffmpeg "$FF")"; fi
  if echo "$det" | grep -q '"vt"'; then
    gpu="$(echo "$det" | "$NODE" -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const g=JSON.parse(d).gpus||[];process.stdout.write(g[0]||"this Mac")})')"
    q "Your Mac ($gpu) can encode video in its media engine."
    if yesno '  Use it for renders? Same picture quality, and the processor stays free for drawing frames.' "$GPU" 1; then enc=auto; else enc=x264; fi
  else enc=auto; echo; say 'Renders will use the processor (x264): this Mac has no constant-quality hardware encoder (Intel Macs).' "$DI"; fi
fi
args=(); [ -n "$ws" ] && args+=(--workspace "$ws"); for w in ${WATCHES[@]+"${WATCHES[@]}"}; do args+=(--watch "$w"); done; [ -n "$enc" ] && args+=(--encoder "$enc"); [ "$DRY" = 1 ] && args+=(--dry-run)
res="$("$NODE" "$init" ${args[@]+"${args[@]}"})"; err="$(echo "$res" | json error)"; [ -n "$err" ] && { say "$err" "$RE"; exit 1; }
echo "$res" | "$NODE" -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{for(const l of JSON.parse(d).actions||[])console.log(l)})' | while IFS= read -r l; do case "$l" in would\ *) plan "${l#would }" ;; *) say "  $l" "$DI" ;; esac; done
wsNow="$(echo "$res" | json workspace)"
ANS="$("$NODE" "$hub/scripts/mac-install.mjs" answers)"; ans() { echo "$ANS" | json "$1"; }; SETS=()

# 5. MCP server "videohub" for every Claude Code session (user scope). The node path is absolute: Claude Code started
#    from the Dock does not have Homebrew on its PATH.
mcp="$hub/server/mcp.js"
if [ "$DRY" = 1 ]; then plan "register the MCP server: claude mcp add --scope user videohub -- \"$NODE\" \"$mcp\"  (or write it into ~/.claude.json)"
else
  ok=1
  if [ -n "$CLAUDE" ]; then "$CLAUDE" mcp remove videohub --scope user >/dev/null 2>&1; "$CLAUDE" mcp add --scope user videohub -- "$NODE" "$mcp" >/dev/null 2>&1 || ok=0; else ok=0; fi
  if [ "$ok" = 0 ]; then "$NODE" "$hub/scripts/mac-install.mjs" mcp-json >/dev/null && ok=1; fi
  if [ "$ok" = 1 ]; then say 'Claude tools (MCP server "videohub") registered; new Claude Code sessions will see the hub_* tools' "$GR"
  else TODO+=("The MCP server could not be registered: claude mcp add --scope user videohub -- \"$NODE\" \"$mcp\""); fi
fi

# 6. the skill Claude reads (~/.claude/skills/videohub), with this install's path filled in
if [ "$DRY" = 1 ]; then plan "copy skill/videohub to ~/.claude/skills/videohub (with {{VIDEOHUB_DIR}} = $hub)"
else "$NODE" "$hub/scripts/mac-install.mjs" skill >/dev/null && say "Skill installed: ~/.claude/skills/videohub" "$GR"; fi

# 7. the global rule: every Claude Code session on this Mac reviews films in VideoHub before rendering
want="$RULE"
if [ "$want" = ask ] && [ "$("$NODE" "$hub/scripts/mac-install.mjs" has-rule | json has)" = true ]; then want=yes      # added on an earlier run: refreshed
elif [ "$want" = ask ] && [ "$(ans globalRule)" = no ]; then want=no; fi                                                    # declined on an earlier run
if [ "$want" = ask ]; then
  q 'Should Claude show you every new film in VideoHub before it renders?'
  say '  This adds a short rule to your Claude instructions (~/.claude/CLAUDE.md): Claude opens each new film in' "$DI"
  say "  VideoHub's live preview and waits for your notes before making the video. uninstall.sh removes it again." "$DI"
  if yesno '  Add the rule?' ask 1; then want=yes; else want=no; fi
fi
SETS+=(--set "globalRule=$want")
if [ "$want" = yes ]; then
  if [ "$DRY" = 1 ]; then plan 'write the VideoHub block into ~/.claude/CLAUDE.md (replacing an older VideoHub block if there is one)'
  else "$NODE" "$hub/scripts/mac-install.mjs" rule >/dev/null && say 'Global rule added to ~/.claude/CLAUDE.md (backup: CLAUDE.md.videohub-backup)' "$GR"; fi
else say 'Global rule skipped (run setup again with --global-rule yes to add it later).'; fi

# 8. VideoHub.app in ~/Applications (the Mac's "Desktop shortcut": Spotlight, Launchpad, drag it to the Dock)
appPath="$HOME/Applications/VideoHub.app"
if [ "$APP" != ask ]; then wantApp="$APP"; elif [ -d "$appPath" ]; then wantApp=yes; elif [ "$(ans app)" = no ]; then wantApp=no
else q 'VideoHub can be added to your Applications folder: open it from Spotlight (⌘ Space, "VideoHub"), Launchpad or the Dock.'; if yesno '  Add VideoHub.app?' ask 1; then wantApp=yes; else wantApp=no; fi; fi
SETS+=(--set "app=$wantApp")
if [ "$wantApp" = yes ]; then
  if [ "$DRY" = 1 ]; then plan "create $appPath (runs open-mac.sh in this folder)"
  else r="$("$NODE" "$hub/scripts/mac-install.mjs" app)"; if [ "$(echo "$r" | json action)" = created ]; then say "VideoHub.app: $appPath" "$GR"; else say "VideoHub.app: $(echo "$r" | json action) ($(echo "$r" | json why))" "$YE"; fi; fi
fi

# 9. open at login: off unless chosen (it can also be switched on later on VideoHub's Renders page)
hasLogin="$("$NODE" "$hub/scripts/mac-install.mjs" login status | json on)"
if [ "$LOGIN" != ask ]; then wantLogin="$LOGIN"; elif [ "$hasLogin" = true ]; then wantLogin=yes; elif [ -n "$(ans startup)" ]; then wantLogin="$(ans startup)"
else q "VideoHub can start quietly when you log in (no window), so Claude's tools and the render queue are always ready."; if yesno '  Start VideoHub at login?' ask 0; then wantLogin=yes; else wantLogin=no; fi; fi
SETS+=(--set "startup=$wantLogin")
if [ "$wantLogin" = yes ] && [ "$hasLogin" != true ]; then
  if [ "$DRY" = 1 ]; then plan 'add the login item ~/Library/LaunchAgents/local.videohub.hub.plist'
  else "$NODE" "$hub/scripts/mac-install.mjs" login on >/dev/null && say 'VideoHub starts at login (server only, no window). macOS may show "Background item added": that is this.' "$GR"; fi
elif [ "$wantLogin" = yes ]; then say 'VideoHub starts at login (already set).' "$GR"; fi

# 10. the example film: a 10-second film that shows the whole loop (the same copy as the Welcome panel's button)
exHave=0; [ -f "$wsNow/films/hello-film/index.html" ] && exHave=1
if [ "$EXAMPLE" != ask ]; then wantEx="$EXAMPLE"; elif [ "$exHave" = 1 ] || [ -n "$(ans example)" ]; then wantEx=no
else q 'Add the example film so you can try VideoHub right away? (a 10-second film; delete it whenever you like)'; if yesno '  Add it?' ask 1; then wantEx=yes; else wantEx=no; fi; fi
[ -z "$(ans example)" ] && SETS+=(--set "example=$([ "$wantEx" = yes ] || [ "$exHave" = 1 ] && echo yes || echo no)")
if [ "$wantEx" = yes ]; then
  if [ "$DRY" = 1 ]; then plan "copy examples/hello-film into $wsNow/films (unless it is there already)"
  else
    ex="$("$NODE" "$init" --example 2>/dev/null)"
    if [ -n "$(echo "$ex" | json error)" ]; then say "The example film could not be added: $(echo "$ex" | json error)  (the Welcome panel in VideoHub offers it too)" "$YE"
    elif [ "$(echo "$ex" | json kept)" = true ]; then say "The example film is already there: $(echo "$ex" | json target)" "$GR"
    else say "Example film added: $(echo "$ex" | json path)" "$GR"; fi
  fi
fi

# remember the answers (a second run shows them instead of asking)
if [ "$DRY" = 1 ]; then plan "remember the answers in $hub/data/setup-answers.json"; else "$NODE" "$hub/scripts/mac-install.mjs" answers "${SETS[@]}" >/dev/null; fi

echo
say '== Done. What now:' "$CY"
say "  Your video work lives in  $wsNow  (films, outputs, sounds, thumbnails, archive; README.txt says what each is)."
if [ "$wantApp" = yes ]; then say '  Open VideoHub from Spotlight (⌘ Space, type VideoHub), Launchpad, or ~/Applications. Drag it to the Dock to keep it there.'
else say "  Open VideoHub: bash \"$hub/open-mac.sh\""; fi
say "  Start a NEW Claude Code session (sessions already open do not see VideoHub's tools)."
if [ "$wantEx" = yes ] || [ "$exHave" = 1 ]; then say '  First thing to try: click the "hello-film" card in VideoHub, press Space to play it, click a frame to leave a note.'
else say '  First thing to try: ask Claude Code "make me a 10-second animated title as a VideoHub film" and watch it appear in VideoHub.'; fi
[ "$DRY" = 1 ] && { echo; say 'Dry run finished: nothing outside this folder was changed.' "$YE"; }
if [ ${#TODO[@]} -gt 0 ]; then echo; say 'Left for you to do:' "$YE"; for t in "${TODO[@]}"; do say " - $t" "$YE"; done; fi
exit 0
