#!/bin/bash
# Double-click to run cedarstalk. The first run installs Bun (one time, from
# bun.sh) and opens the setup page. Leave the window open while you use it.
cd "$(dirname "$0")" || exit 1
printf '\n  cedarstalk\n\n'

BUN="$(command -v bun 2>/dev/null)"
[ -z "$BUN" ] && [ -x "$HOME/.bun/bin/bun" ] && BUN="$HOME/.bun/bin/bun"
if [ -z "$BUN" ]; then
  echo "  Installing Bun (one time, from bun.sh)..."
  if ! curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1; then
    echo "  Couldn't install Bun -- check your internet and double-click this again."
    read -r -p "  Press Return to close." _
    exit 1
  fi
  BUN="$HOME/.bun/bin/bun"
fi

if [ ! -f data/.raycast-asked ]; then
  mkdir -p data && touch data/.raycast-asked
  bash scripts/install-raycast.sh "$BUN" --ask
fi

if [ ! -f data/.shortcut-v2 ]; then
  mkdir -p data && touch data/.shortcut-v2
  bash scripts/make-mac-app.sh || true
fi

CEDARSTALK_OPEN=1 "$BUN" run src/index.ts
read -r -p "  cedarstalk stopped. Press Return to close." _
