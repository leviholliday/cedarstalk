#!/bin/bash
# Installs the cedarstalk Raycast commands. Called by "Start cedarstalk.command";
# needs only Bun -- a "node" shim pointing at Bun covers Raycast's own tooling.
BUN="${1:-bun}"
DIR="$HOME/.cedarstalk/raycast"
SHIM="$HOME/.cedarstalk/shim"

echo "  Downloading the Raycast commands..."
rm -rf "$DIR.tmp" && mkdir -p "$DIR.tmp" "$SHIM"
if ! curl -fsSL https://github.com/leviholliday/cedarstalk-raycast/archive/refs/heads/main.tar.gz \
  | tar -xz -C "$DIR.tmp" --strip-components=1; then
  echo "  Couldn't download them -- skipping Raycast for now."
  exit 0
fi
rm -rf "$DIR" && mv "$DIR.tmp" "$DIR"
ln -sf "$BUN" "$SHIM/node"
export PATH="$SHIM:$PATH"

cd "$DIR" || exit 0
"$BUN" install >/dev/null 2>&1

echo "  Adding them to Raycast (takes about 20 seconds)..."
open -a Raycast
./node_modules/.bin/ray develop >/dev/null 2>&1 &
DEV=$!
sleep 25
kill "$DEV" 2>/dev/null
wait "$DEV" 2>/dev/null
echo "  Done -- open Raycast and type \"cedarstalk\". It asks for your token the first time."
echo
