#!/usr/bin/env bash
set -euo pipefail
SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  DIR="$(cd -- "$(dirname -- "$SOURCE")" && pwd)"
  SOURCE="$(readlink -- "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
ROOT="$(cd -- "$(dirname -- "$SOURCE")" && pwd)"
for d in "${HOME:+$HOME/.local/share/mise/shims}" "${HOME:+$HOME/.local/bin}" "${HOME:+$HOME/.local/share/omarchy/bin}" "${HOME:+$HOME/.opencode/bin}" "${HOME:+$HOME/.nvm/current/bin}" "${HOME:+$HOME/.fnm/aliases/default/bin}" "${HOME:+$HOME/.volta/bin}" "${HOME:+$HOME/.asdf/shims}" /opt/homebrew/bin /usr/local/bin; do
  [ -n "$d" ] && [ -d "$d" ] && case ":${PATH:-}:" in *":$d:"*) ;; *) PATH="${PATH:+$PATH:}$d" ;; esac
done
export PATH
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)" -lt 22 ]; then
  printf 'Node.js 22+ is required. Install it (Arch/Omarchy: mise use -g node@lts or sudo pacman -S --needed nodejs npm; macOS: brew install node; or https://nodejs.org/) and run this again.\n' >&2
  exit 1
fi
exec node "$ROOT/scripts/install.mjs" setup "$@"
