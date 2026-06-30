#!/bin/bash
# Build Freelane into a distributable, AD-HOC-signed .app + .dmg for GitHub Releases.
#
# NOT notarized, tied to no Apple Developer account — like most open-source Mac apps.
# On first launch users approve it once via System Settings → Privacy & Security →
# "Open Anyway". In-app updates still work: Sparkle verifies the EdDSA-signed appcast,
# independent of Apple notarization.
#
# Usage:  scripts/release.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
DEV="/Applications/Xcode.app/Contents/Developer"
DIST="$ROOT/dist"

echo "→ Building Release (universal)…"
DEVELOPER_DIR="$DEV" xcodebuild -project Freelane.xcodeproj -scheme Freelane \
  -configuration Release -derivedDataPath build \
  -clonedSourcePackagesDirPath build/SourcePackages \
  ARCHS="arm64 x86_64" ONLY_ACTIVE_ARCH=NO CODE_SIGNING_ALLOWED=NO build >/dev/null

APP_SRC="build/Build/Products/Release/Freelane.app"
[ -d "$APP_SRC" ] || { echo "error: build product missing" >&2; exit 1; }
rm -rf "$DIST"; mkdir -p "$DIST"
APP="$DIST/Freelane.app"
cp -R "$APP_SRC" "$APP"

echo "→ Ad-hoc signing (inside-out: Sparkle internals, widget, then the app)…"
if [ -d "$APP/Contents/Frameworks" ]; then
  # Sparkle ships XPC services, an Autoupdate tool and a helper app inside its framework.
  find "$APP/Contents/Frameworks" \( -name "*.xpc" -o -name "*.app" -o -name "Autoupdate" -o -name "*.dylib" \) -print0 \
    | while IFS= read -r -d '' n; do codesign --force --sign - "$n"; done
  find "$APP/Contents/Frameworks" -maxdepth 1 -name "*.framework" -print0 \
    | while IFS= read -r -d '' fw; do codesign --force --sign - "$fw"; done
fi
# The bundled WidgetKit extension.
if [ -d "$APP/Contents/PlugIns" ]; then
  find "$APP/Contents/PlugIns" -maxdepth 1 -name "*.appex" -print0 \
    | while IFS= read -r -d '' ax; do codesign --force --sign - "$ax"; done
fi
codesign --force --sign - "$APP"
codesign --verify --deep --strict "$APP" && echo "  ad-hoc signature ok"

VERSION=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP/Contents/Info.plist" 2>/dev/null || echo "1.0")

echo "→ Zipping (Sparkle update artifact)…"
ZIP="$DIST/Freelane.zip"
ditto -c -k --keepParent "$APP" "$ZIP"

echo "→ Building drag-to-Applications DMG…"
DMG="$DIST/Freelane.dmg"
STAGING="$DIST/dmg-staging"; rm -rf "$STAGING"; mkdir -p "$STAGING"
cp -R "$APP" "$STAGING/Freelane.app"
ln -s /Applications "$STAGING/Applications"
hdiutil create -volname "Freelane" -srcfolder "$STAGING" -ov -format UDZO "$DMG" >/dev/null
rm -rf "$STAGING"

# --- Sparkle appcast (EdDSA-signed via the local key file — no Keychain prompt) ---
GENAPPCAST="$ROOT/.sparkle-tools/bin/generate_appcast"
KEYFILE="$ROOT/.sparkle-tools/ed_priv"
APPCAST="$DIST/appcast.xml"
if [ -x "$GENAPPCAST" ] && [ -f "$KEYFILE" ]; then
  echo "→ Generating signed appcast…"
  APPCAST_SRC="$DIST/appcast-src"; rm -rf "$APPCAST_SRC"; mkdir -p "$APPCAST_SRC"
  cp "$ZIP" "$APPCAST_SRC/"
  "$GENAPPCAST" --ed-key-file "$KEYFILE" \
    --download-url-prefix "https://github.com/hatimhtm/freelane/releases/download/v$VERSION/" \
    "$APPCAST_SRC"
  mv "$APPCAST_SRC/appcast.xml" "$APPCAST"
  rm -rf "$APPCAST_SRC"

  # Embed this version's CHANGELOG section as inline release notes (shown in the prompt).
  CHANGELOG="$ROOT/CHANGELOG.md"
  if [ -f "$CHANGELOG" ]; then
    NOTES_MD="$DIST/RELEASE_NOTES.md"
    awk -v ver="$VERSION" '
      $0 ~ ("^## +" ver "([ \t]|$)") { grab=1; next }
      grab && /^## / { grab=0 }
      grab { print }
    ' "$CHANGELOG" | sed '/^[[:space:]]*$/d' > "$NOTES_MD"
    if [ -s "$NOTES_MD" ]; then
      NOTES_HTML="$DIST/relnotes.html"
      {
        echo "<h3 style=\"margin:0 0 8px;font:600 14px -apple-system\">What&rsquo;s new in Freelane $VERSION</h3>"
        echo "<ul style=\"margin:0;padding-left:20px;font:13px -apple-system;line-height:1.5\">"
        sed -E 's/^[[:space:]]*[-*][[:space:]]+//' "$NOTES_MD" \
          | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g' \
          | while IFS= read -r line; do [ -n "$line" ] && echo "  <li>$line</li>"; done
        echo "</ul>"
      } > "$NOTES_HTML"
      TMP="$APPCAST.tmp"
      awk -v notesfile="$NOTES_HTML" '
        /<item>/ && !done {
          print
          print "            <description><![CDATA["
          while ((getline l < notesfile) > 0) print l
          print "            ]]></description>"
          done=1; next
        }
        { print }
      ' "$APPCAST" > "$TMP" && mv "$TMP" "$APPCAST"
      rm -f "$NOTES_HTML"
      echo "  embedded v$VERSION changelog into the appcast"
    fi
  fi
else
  echo "⚠ generate_appcast or key missing — appcast skipped (updates won't work)." >&2
  APPCAST=""
fi

echo "✓ Done."
echo "  DMG (download):       $DMG"
echo "  Zip (Sparkle update): $ZIP"
[ -n "$APPCAST" ] && echo "  Appcast (auto-update): $APPCAST"
echo
echo "Publish (tag MUST be v$VERSION so appcast URLs resolve):"
NOTES_ARG="--notes \"…\""
[ -f "$DIST/RELEASE_NOTES.md" ] && NOTES_ARG="--notes-file \"$DIST/RELEASE_NOTES.md\""
if [ -n "$APPCAST" ]; then
  echo "  gh release create v$VERSION \"$DMG\" \"$ZIP\" \"$APPCAST\" --title \"Freelane v$VERSION\" $NOTES_ARG"
else
  echo "  gh release create v$VERSION \"$DMG\" \"$ZIP\" --title \"Freelane v$VERSION\" $NOTES_ARG"
fi
echo "Bump MARKETING_VERSION + CURRENT_PROJECT_VERSION in Freelane.xcodeproj before each release."
