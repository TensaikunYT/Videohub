#!/bin/bash
# VideoHub uninstall for a Mac: undoes what setup.sh did. Your films, their notes (.videohub folders), the outputs
# folder and this VideoHub folder itself are NOT touched; delete the folder yourself afterwards if you want.
# What it removes goes to the Trash (the skill, VideoHub.app), never deleted outright.
#   bash uninstall.sh [--dry-run]
hub="$(cd "$(dirname "$0")" && pwd)"
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1
say() { printf '%s\n' "$1"; }
NODE=''; for c in "$(command -v node 2>/dev/null)" /opt/homebrew/bin/node /usr/local/bin/node /opt/local/bin/node; do [ -n "$c" ] && [ -x "$c" ] && { NODE="$c"; break; }; done
[ -z "$NODE" ] && { say 'Node.js was not found; it is needed to undo the setup cleanly.'; exit 1; }
mi() { "$NODE" "$hub/scripts/mac-install.mjs" "$@"; }
say "== VideoHub uninstall: $hub"

# 1. stop this install's hub and its render protection agent (it continues every render it slowed or paused first)
for pid in $(pgrep -f "$hub/server/hub.js" 2>/dev/null); do
  if [ "$DRY" = 1 ]; then say "  [dry run] would: stop the VideoHub server (pid $pid)"; else kill "$pid" 2>/dev/null && say "VideoHub server stopped (pid $pid)"; fi
done
if [ "$DRY" = 1 ]; then say '  [dry run] would: quit the render protection agent (lifts every CPU limit)'; else "$NODE" "$hub/guard/agent-mac.mjs" --quit; fi

# 2. Claude: MCP server, skill, global rule - only when they belong to THIS install (another VideoHub folder keeps its own)
CLAUDE="$(command -v claude 2>/dev/null || true)"; for c in "$HOME/.local/bin/claude" "$HOME/.claude/local/claude"; do [ -z "$CLAUDE" ] && [ -x "$c" ] && CLAUDE="$c"; done
if grep -qF "$hub/server/mcp.js" "$HOME/.claude.json" 2>/dev/null; then
  if [ "$DRY" = 1 ]; then say '  [dry run] would: remove the MCP server "videohub" (claude mcp remove --scope user videohub)'
  else
    [ -n "$CLAUDE" ] && "$CLAUDE" mcp remove videohub --scope user >/dev/null 2>&1
    mi mcp-json --remove >/dev/null   # without the CLI (or if it left it): straight from ~/.claude.json, backup first
    say 'MCP server "videohub" removed'
  fi
else say 'The registered MCP server "videohub" is not this install (or none is registered): left alone.'; fi
say "skill: $(mi skill --remove $([ "$DRY" = 1 ] && echo --dry-run))"
say "global rule: $(mi rule --remove $([ "$DRY" = 1 ] && echo --dry-run))"

# 3. VideoHub.app and the login item
say "VideoHub.app: $(mi app --remove $([ "$DRY" = 1 ] && echo --dry-run))"
if [ "$(mi login status | grep -o '"on":true')" ]; then
  if [ "$DRY" = 1 ]; then say '  [dry run] would: remove the "open at login" item'; else mi login off >/dev/null && say 'Login item removed (VideoHub no longer starts at login)'; fi
fi

echo
say '== Done. Left in place: this folder (with data/), your films and their .videohub notes, the outputs folder,'
say '   and ~/Library/Application Support/RenderGuard (the agent'"'"'s settings and history). Delete them yourself if you want them gone.'
