#!/bin/bash
# VideoHub setup for a Mac - double-click to install (see README.md). The first time, macOS may ask whether to open
# a file downloaded from the internet: right-click SETUP.command > Open, or run in Terminal: bash setup.sh
cd "$(dirname "$0")" && /bin/bash ./setup.sh "$@"
echo; read -r -n 1 -p "Press any key to close this window." _
