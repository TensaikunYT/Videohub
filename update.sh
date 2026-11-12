#!/bin/bash
# VideoHub update for a Mac: copies this folder's code over an existing VideoHub install on this Mac. Keeps the Mac's
# own data (data/: settings, render queue, caches) and every project's notes; nothing is deleted.
#   bash update.sh [--target <VideoHub folder>] [--no-keys] [--no-skill] [--dry-run]     (or double-click UPDATE.command)
# (With git you can simply `git pull` inside the install instead, then run setup.sh again.)
src="$(cd "$(dirname "$0")" && pwd)"
TARGET=''; DRY=0; KEYS=1; SKILL=1
while [ $# -gt 0 ]; do case "$1" in --target) TARGET="${2:-}"; shift ;; --dry-run) DRY=1 ;; --no-keys) KEYS=0 ;; --no-skill) SKILL=0 ;; *) echo "Unknown option: $1"; exit 2 ;; esac; shift; done
say() { printf '%s\n' "$1"; }
plan() { say "  [dry run] would: $1"; }
NODE=''; for c in "$(command -v node 2>/dev/null)" /opt/homebrew/bin/node /usr/local/bin/node /opt/local/bin/node; do [ -n "$c" ] && [ -x "$c" ] && { NODE="$c"; break; }; done
[ -z "$NODE" ] && { say 'Node.js was not found. Install it first (see README.md), then run this again.'; exit 1; }
say '== VideoHub update'

# 1. the installed VideoHub: given, or the one VideoHub.app opens
if [ -z "$TARGET" ]; then
  launcher="$HOME/Applications/VideoHub.app/Contents/MacOS/VideoHub"
  [ -f "$launcher" ] && TARGET="$(sed -n "s|^exec /bin/bash '\(.*\)/open-mac.sh'.*|\1|p" "$launcher" | sed "s/'\\\\''/'/g")"
fi
if [ -z "$TARGET" ] || [ ! -f "$TARGET/server/hub.js" ]; then say 'No installed VideoHub found. For a first install use SETUP.command (or: bash update.sh --target <VideoHub folder>).'; exit 1; fi
TARGET="$(cd "$TARGET" && pwd)"
[ "$TARGET" = "$src" ] && { say 'This folder is the installed VideoHub; nothing to update.'; exit 0; }
say "Installed VideoHub: $TARGET"

# 2. not while something renders or cleans (the hub would be stopped under it)
port="$("$NODE" -e 'try{process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).port||7788))}catch{process.stdout.write("7788")}' "$TARGET/data/config.json")"
if curl -fs -m 3 "http://127.0.0.1:$port/api/ping" >/dev/null 2>&1; then
  busy="$(curl -fs -m 5 "http://127.0.0.1:$port/api/jobs" | "$NODE" -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write(String(JSON.parse(d).filter(j=>["running","queued"].includes(j.state)).length))}catch{process.stdout.write("0")}})')"
  [ "${busy:-0}" != 0 ] && { say "$busy render(s) running or queued. Run this again when they are done; nothing was changed."; exit 2; }
  cl="$(curl -fs -m 5 "http://127.0.0.1:$port/api/disk/clean" 2>/dev/null)"; echo "$cl" | grep -q '"state":"running"' && { say 'A cleanup is running. Run this again when it is done; nothing was changed.'; exit 2; }
fi

# 3. stop this install's hub (only node processes running <target>/server/hub.js)
for pid in $(pgrep -f "$TARGET/server/hub.js" 2>/dev/null); do if [ "$DRY" = 1 ]; then plan "stop the VideoHub server (pid $pid)"; else kill "$pid" 2>/dev/null && say "VideoHub server stopped (pid $pid)"; fi; done

# 4. backup of the code being replaced (data/update-backup/<time>), then copy
items=(server ui templates skill claude examples engine-hooks docs scripts CLAUDE.md README.md LICENSE SETUP.cmd UPDATE.cmd update.ps1 setup.ps1 uninstall.ps1 open.ps1 open.vbs
  SETUP.command UPDATE.command setup.sh update.sh uninstall.sh open-mac.sh package.json package-lock.json guard/RenderGuard.cs guard/build.ps1 guard/tests guard/agent-mac.mjs guard/agent-mac.test.js guard/keys-mac.swift guard/build-mac.sh)
bak="$TARGET/data/update-backup/$(date +%Y%m%d-%H%M%S)"
lockOld="$(shasum "$TARGET/package-lock.json" 2>/dev/null | cut -d' ' -f1)"; keysOld="$(shasum "$TARGET/guard/keys-mac.swift" 2>/dev/null | cut -d' ' -f1)"
if [ "$DRY" = 1 ]; then plan "back up the replaced code to $bak and copy: ${items[*]}"; say 'Dry run finished: nothing was changed.'; exit 0; fi
mkdir -p "$bak"; n=0
for it in "${items[@]}"; do
  [ -e "$src/$it" ] || continue
  if [ -e "$TARGET/$it" ]; then mkdir -p "$(dirname "$bak/$it")"; cp -Rp "$TARGET/$it" "$bak/$it"; fi
  mkdir -p "$(dirname "$TARGET/$it")"
  if [ -d "$src/$it" ]; then mkdir -p "$TARGET/$it"; cp -Rp "$src/$it/." "$TARGET/$it/"; else cp -p "$src/$it" "$TARGET/$it"; fi   # adds and replaces; files only the old version had stay
  n=$((n + 1))
done
say "$n items copied (the old code is in $bak)"

# 5. packages only when they changed
if [ "$(shasum "$TARGET/package-lock.json" 2>/dev/null | cut -d' ' -f1)" != "$lockOld" ] || [ ! -d "$TARGET/node_modules" ]; then
  ( cd "$TARGET" && PATH="$(dirname "$NODE"):$PATH" npm install --no-audit --no-fund --loglevel=error ) && say 'Packages updated' || say 'npm install failed (see above)'
else say 'Packages unchanged'; fi

# 6. the emergency hotkeys helper only when its source changed or it is missing
if [ "$KEYS" = 1 ] && xcrun --find swiftc >/dev/null 2>&1; then
  if [ "$(shasum "$TARGET/guard/keys-mac.swift" | cut -d' ' -f1)" != "$keysOld" ] || [ ! -x "$TARGET/guard/VideoHubKeys" ]; then
    bash "$TARGET/guard/build-mac.sh" >/dev/null 2>&1 && say 'Emergency hotkeys helper rebuilt' || say 'The hotkeys helper could not be built (bash guard/build-mac.sh shows why)'
  else say 'Emergency hotkeys helper unchanged'; fi
fi

# 7. the skill Claude reads, and VideoHub.app (with the install's path filled in)
[ "$SKILL" = 1 ] && "$NODE" "$TARGET/scripts/mac-install.mjs" skill >/dev/null && say 'Skill updated: ~/.claude/skills/videohub'
[ -d "$HOME/Applications/VideoHub.app" ] && "$NODE" "$TARGET/scripts/mac-install.mjs" app >/dev/null && say 'VideoHub.app updated'

echo
say '== Done. Open VideoHub (Spotlight: VideoHub); the server starts again with the new code.'
say 'Claude sessions that are already open see the new hub_* tools after they restart them.'
