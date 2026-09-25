#!/bin/bash
# Builds dist/cedarstalk.zip: a tidy folder with the few files a person needs
# at the top and everything else under app/. Uses `git archive`, so only
# committed files go in -- never .env, data/ or a token.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=dist/package
PKG="$OUT/cedarstalk"
rm -rf "$OUT" dist/cedarstalk.zip
mkdir -p "$PKG/app"
git archive --format=tar HEAD | tar -x -C "$PKG/app"
rm -rf "$PKG/app/test" "$PKG/app/PLAN.md" "$PKG/app/PLAN2.md" "$PKG/app/.github"

cp -R "$PKG/app/extension" "$PKG/Browser extension"
cp "$PKG/app/LICENSE.md" "$PKG/License.md"

crlf() { sed 's/$/\r/'; }

printf '#!/bin/bash\nexec bash "$(dirname "$0")/app/Start cedarstalk.command"\n' > "$PKG/Start on Mac.command"
printf '#!/bin/bash\nexec bash "$(dirname "$0")/app/Add to Raycast.command"\n' > "$PKG/Add to Raycast (Mac).command"
chmod +x "$PKG/Start on Mac.command" "$PKG/Add to Raycast (Mac).command"
printf '@echo off\ncall "%%~dp0app\\Start cedarstalk.cmd"\n' | crlf > "$PKG/Start on Windows.cmd"
printf '@echo off\ncall "%%~dp0app\\Add to Raycast.cmd"\n' | crlf > "$PKG/Add to Raycast (Windows).cmd"

crlf > "$PKG/READ ME.txt" <<'TXT'
cedarstalk -- built on cedarengine by Kieran Klukas (https://dunkirk.sh).
All the credit is his; see License.md.

TO START
  Mac:      double-click "Start on Mac"
  Windows:  double-click "Start on Windows"

THE FIRST TIME your computer warns it's from an unidentified developer:
  Mac:      System Settings > Privacy & Security > Open Anyway,
            then double-click "Start on Mac" again.
  Windows:  More info > Run anyway.

Then paste your token (from https://cedarstalk.netlify.app) into the page
that opens. It walks you through the "Browser extension" folder and Raycast.

Keep the window that opens running while you use cedarstalk.
TXT

(cd "$OUT" && zip -qry ../cedarstalk.zip cedarstalk)
rm -rf "$OUT"
echo "built dist/cedarstalk.zip ($(du -h dist/cedarstalk.zip | cut -f1))"
