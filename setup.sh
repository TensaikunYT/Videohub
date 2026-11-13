#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if ! command -v node >/dev/null 2>&1; then
  if [[ "$(uname -s)" == "Darwin" ]]; then
    printf '%s\n' 'Node.js 22 or newer is required. With Homebrew: brew install node ffmpeg. Then run setup.sh again.' >&2
  else
    printf '%s\n' 'Node.js 22 or newer is required. Install it with your distribution package manager, then run setup.sh again.' >&2
  fi
  exit 1
fi
exec node scripts/install.mjs setup "$@"
