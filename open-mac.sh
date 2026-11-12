#!/bin/bash
# Opens VideoHub on a Mac: starts the server if it is not running, then an app window (Chrome, else Edge, Brave or
# Chromium as a window without tabs; else the default browser). VideoHub.app (made by setup.sh) runs this.
#   --server   only the server, no window. The server starts the render protection agent itself.
hub="$(cd "$(dirname "$0")" && pwd)"
logs="$HOME/Library/Logs/VideoHub"; mkdir -p "$logs"
# node: the one setup chose (VideoHub.app passes it), else the usual places (an app does not get the shell's PATH)
node="${VIDEOHUB_NODE:-}"
if [ -z "$node" ] || [ ! -x "$node" ]; then
  for c in "$(command -v node 2>/dev/null)" /opt/homebrew/bin/node /usr/local/bin/node /opt/local/bin/node "$HOME"/.nvm/versions/node/*/bin/node "$HOME"/.volta/bin/node; do
    if [ -n "$c" ] && [ -x "$c" ]; then node="$c"; break; fi
  done
fi
if [ -z "$node" ]; then
  osascript -e 'display alert "VideoHub needs Node.js" message "Node.js was not found. Run setup.sh (or SETUP.command) in the VideoHub folder; it says how to install it."' >/dev/null 2>&1
  exit 1
fi
port="$("$node" -e 'try{const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(c.port||7788))}catch{process.stdout.write("7788")}' "$hub/data/config.json")"
url="http://127.0.0.1:$port"
alive() { curl -fs -m 1 "$url/api/ping" >/dev/null 2>&1; }
if ! alive; then
  ( cd "$hub" && nohup "$node" "$hub/server/hub.js" >>"$logs/hub.log" 2>&1 & )
  for _ in $(seq 1 40); do alive && break; sleep 0.25; done
fi
[ "$1" = "--server" ] && exit 0
for app in "Google Chrome" "Microsoft Edge" "Brave Browser" "Chromium"; do
  for dir in /Applications "$HOME/Applications"; do
    exe="$dir/$app.app/Contents/MacOS/$app"
    if [ -x "$exe" ]; then ( "$exe" --app="$url/" >/dev/null 2>&1 & ); exit 0; fi
  done
done
open "$url/"
