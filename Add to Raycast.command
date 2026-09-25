#!/bin/bash
# Double-click to (re)install the cedarstalk commands in Raycast.
cd "$(dirname "$0")" || exit 1
BUN="$(command -v bun 2>/dev/null)"
[ -z "$BUN" ] && [ -x "$HOME/.bun/bin/bun" ] && BUN="$HOME/.bun/bin/bun"
if [ -z "$BUN" ]; then
  echo "  Run \"Start cedarstalk\" once first -- it installs what this needs."
else
  bash scripts/install-raycast.sh "$BUN"
fi
read -r -p "  Press Return to close." _
