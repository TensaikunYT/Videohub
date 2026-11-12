#!/bin/bash
# VideoHub update for a Mac - copies this folder's code over the VideoHub installed on this Mac (settings and notes stay)
cd "$(dirname "$0")" && /bin/bash ./update.sh "$@"
echo; read -r -n 1 -p "Press any key to close this window." _
