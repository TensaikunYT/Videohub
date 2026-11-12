#!/bin/bash
# Builds guard/VideoHubKeys (the render protection's emergency hotkeys on a Mac) from keys-mac.swift with swiftc.
# Optional: without it the protection works the same, only the hotkeys are missing (the Renders page has the buttons).
# swiftc comes with Xcode or the Command Line Tools (xcode-select --install). Builds for this Mac's processor.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
if ! xcrun --find swiftc >/dev/null 2>&1; then
  echo "swiftc not found (install the Command Line Tools: xcode-select --install). The hotkeys are optional." >&2
  exit 1
fi
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
xcrun swiftc -O -target "$(uname -m)-apple-macos11" -o "$tmp/VideoHubKeys" "$here/keys-mac.swift"
# a running agent keeps the old copy open: replace the file, it picks the new one up when it next starts
mv -f "$tmp/VideoHubKeys" "$here/VideoHubKeys"
echo "Built $here/VideoHubKeys"
