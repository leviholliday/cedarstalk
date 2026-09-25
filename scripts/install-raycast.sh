#!/bin/bash
# Installs the cedarstalk Raycast commands -- and Raycast itself if it's missing.
# Needs only Bun: a "node" shim pointing at Bun covers Raycast's own tooling.
#   install-raycast.sh <bun> [--ask]   --ask: the launcher's one-time question
BUN="${1:-bun}"
ASK="${2:-}"
DIR="$HOME/.cedarstalk/raycast"
SHIM="$HOME/.cedarstalk/shim"
RAYCAST_TEAM="SY64MV22J9"   # Raycast Technologies Inc

raycast_app() {
  for a in /Applications/Raycast.app "$HOME/Applications/Raycast.app"; do
    [ -d "$a" ] && { echo "$a"; return 0; }
  done
  return 1
}

install_raycast_app() {
  local url tmp app dest
  if [ "$(uname -m)" = arm64 ]; then
    url="https://x.raycast-releases.com/download/web?platform=macos&architecture=arm64"
  else
    url="https://api.raycast.app/v2/download"   # Intel: Raycast's universal build
  fi
  tmp="$(mktemp -d)"
  echo "  Downloading Raycast from raycast.com..."
  curl -fsSL -o "$tmp/Raycast.dmg" "$url" || { echo "  Couldn't download Raycast."; rm -rf "$tmp"; return 1; }
  hdiutil attach -nobrowse -quiet -readonly -mountpoint "$tmp/mnt" "$tmp/Raycast.dmg" || { rm -rf "$tmp"; return 1; }
  app="$tmp/mnt/Raycast.app"
  # Only ever install the real thing: Raycast's own signature, notarized by Apple.
  if ! codesign -dv "$app" 2>&1 | grep -q "TeamIdentifier=$RAYCAST_TEAM" || ! spctl -a "$app" 2>/dev/null; then
    echo "  That download isn't signed by Raycast -- not installing it."
    hdiutil detach -quiet "$tmp/mnt"; rm -rf "$tmp"; return 1
  fi
  dest=/Applications
  [ -w /Applications ] || { dest="$HOME/Applications"; mkdir -p "$dest"; }
  ditto "$app" "$dest/Raycast.app"
  hdiutil detach -quiet "$tmp/mnt"; rm -rf "$tmp"
  echo "  Raycast installed in $dest."
  open "$dest/Raycast.app"
  echo
  read -r -p "  Raycast just opened -- click through its welcome screens, then press Return here. " _
}

if app="$(raycast_app)"; then
  if [ "$ASK" = --ask ]; then
    read -r -p "  Add the cedarstalk commands to Raycast? [Y/n] " answer
    case "$answer" in [nN]*) exit 0 ;; esac
  fi
else
  if [ "$ASK" = --ask ]; then
    read -r -p "  Want Raycast too? It's a free launcher app, and cedarstalk adds its commands to it. [y/N] " answer
    case "$answer" in [yY]*) ;; *) exit 0 ;; esac
  fi
  install_raycast_app || { echo "  Skipping Raycast -- cedarstalk itself still works."; exit 0; }
fi

echo "  Downloading the cedarstalk Raycast commands..."
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
