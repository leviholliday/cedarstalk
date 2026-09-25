#!/bin/bash
# Makes ~/Applications/cedarstalk.app (with the cedarstalk icon) and puts it on
# the Desktop. Called once by "Start cedarstalk.command". If cedarstalk is
# already running it just opens a window; otherwise it starts it in the
# background (no Terminal), logging to data/server.log.
set -e
APPDIR="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE="$HOME/Applications/cedarstalk.app"
rm -rf "$BUNDLE"
mkdir -p "$BUNDLE/Contents/MacOS" "$BUNDLE/Contents/Resources"
cp "$APPDIR/assets/cedarstalk.icns" "$BUNDLE/Contents/Resources/cedarstalk.icns"
cat > "$BUNDLE/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleName</key><string>cedarstalk</string>
  <key>CFBundleExecutable</key><string>cedarstalk</string>
  <key>CFBundleIdentifier</key><string>app.cedarstalk.launcher</string>
  <key>CFBundleIconFile</key><string>cedarstalk</string>
  <key>CFBundleGetInfoString</key><string>Built on cedarengine by Kieran Klukas</string>
</dict></plist>
PLIST
{
  echo '#!/bin/bash'
  printf 'DIR=%q\n' "$APPDIR"
  cat <<'RUN'
for port in $(seq 3000 3009); do
  if curl -s --max-time 1 "http://127.0.0.1:$port/setup/state" | grep -qF "\"installDir\":\"$DIR\""; then
    curl -s -X POST -H "content-type: application/json" -d "{}" "http://127.0.0.1:$port/setup/open" >/dev/null
    exit 0
  fi
done
# Opened from Finder, PATH is bare -- look where Bun actually installs.
for BUN in "$HOME/.bun/bin/bun" /opt/homebrew/bin/bun /usr/local/bin/bun; do [ -x "$BUN" ] && break; done
[ -x "$BUN" ] || { open -a Terminal "$DIR/Start cedarstalk.command"; exit 0; }
cd "$DIR" && mkdir -p data
CEDARSTALK_OPEN=1 nohup "$BUN" run src/index.ts >> data/server.log 2>&1 &
RUN
} > "$BUNDLE/Contents/MacOS/cedarstalk"
chmod +x "$BUNDLE/Contents/MacOS/cedarstalk"
touch "$BUNDLE"
ln -sfn "$BUNDLE" "$HOME/Desktop/cedarstalk"
echo "  Added cedarstalk to your Desktop and Applications -- use it next time."
