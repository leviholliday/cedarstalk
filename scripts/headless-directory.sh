#!/bin/bash
#
# A directory sweep with no browser window and nobody watching.
#
# Self-Service needs a logged-in session, which normally means a browser being
# open. The Raycast extension already solved that for its own use: it ships a
# tiny WebKit app (`auth-browser`) holding a persistent SSO session, and that
# app can mint a fresh session cookie silently, without showing a window. This
# borrows it. The SSO session lasts months; the cookie it mints lasts hours,
# so this refreshes one every time it runs.
#
# Exit codes:
#   0  swept
#   2  the SSO session needs a human (password or MFA) -- open the Raycast
#      command once and sign in, and this starts working again on its own
#   3  the auth-browser has not been built yet (run the Raycast command once)

set -uo pipefail

ENGINE_DIR="${ENGINE_DIR:-$HOME/Coding Projects/2026/cedarengine}"
SUPPORT="$HOME/Library/Application Support/com.raycast.macos/extensions/cedarville-people-search"
BINARY="$SUPPORT/auth-browser"
JAR="$SUPPORT/sso-jar.json"
BUNDLE="$SUPPORT/CedarvilleAuth.app"
COOKIE="$SUPPORT/headless-cookie.txt"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S')  $*"; }

if [ ! -x "$BINARY" ]; then
  log "no auth-browser at $BINARY -- open the Raycast command once to build it"
  exit 3
fi

# macOS only grants window-server access to something Launch Services regards
# as an app, so the binary is wrapped in a minimal bundle. Rebuilt every run:
# it is a symlink and a plist, and a stale one is harder to debug than a fresh
# one is to make.
rm -rf "$BUNDLE"
mkdir -p "$BUNDLE/Contents/MacOS"
ln -sf "$BINARY" "$BUNDLE/Contents/MacOS/auth-browser"
cat > "$BUNDLE/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundlePackageType</key><string>APPL</string>
	<key>CFBundleExecutable</key><string>auth-browser</string>
	<key>CFBundleIdentifier</key><string>sh.dunkirk.cedarville-people-search.auth</string>
	<key>CFBundleName</key><string>Cedarville Auth</string>
	<key>NSPrincipalClass</key><string>NSApplication</string>
	<key>NSHighResolutionCapable</key><true/>
	<key>LSMinimumSystemVersion</key><string>13.0</string>
	<key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

# Owner-only from the moment it exists: this is a live session cookie, and a
# world-readable one would be worth more to a passer-by than the database is.
rm -f "$COOKIE"
install -m 600 /dev/null "$COOKIE"

log "refreshing the session cookie"
open -n -W "$BUNDLE" --args "$COOKIE" --jar "$JAR" --silent

if [ ! -s "$COOKIE" ]; then
  log "silent refresh produced no cookie -- SSO needs a human; sign in from Raycast once"
  rm -f "$COOKIE"
  exit 2
fi

log "cookie refreshed ($(wc -c < "$COOKIE" | tr -d ' ') bytes); sweeping the directory"
cd "$ENGINE_DIR" || { log "no engine at $ENGINE_DIR"; exit 1; }

# `bun` is not on launchd's PATH, so it is resolved rather than assumed.
BUN="$(command -v bun || echo "$HOME/.bun/bin/bun")"
# Depth 1, deliberately. Measured: ~6,300 requests over ~18 minutes, finding
# 24 new people on a first unattended run. The default depth of 4 searches far
# more name permutations for the same population -- many times the load on
# Self-Service, every six hours, to find the same newcomers. A partial sweep
# cannot retire people who have left; for that, run this by hand occasionally:
#   bun run src/cli.ts collect directory --cookie <file> --refresh
"$BUN" run src/cli.ts collect directory --cookie "$COOKIE" --depth 1
STATUS=$?

# The cookie is good for hours and is not needed between runs; leaving it on
# disk only widens the window in which it could be read.
rm -f "$COOKIE"

log "sweep finished with status $STATUS"
exit $STATUS
