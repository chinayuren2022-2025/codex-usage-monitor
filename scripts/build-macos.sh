#!/bin/sh
# Build a macOS .dmg containing CodexMonitor.app — end users need NO Node.js.
#
#   ./scripts/build-macos.sh        → dist/CodexMonitor.dmg
#
# RUN THIS ON A MAC. It was written on a Windows box and could not be tested
# there, so it echoes every step and fails loud. Node.js is needed to BUILD
# (esbuild bundles the app), but not to RUN the produced app.
set -eu
cd "$(dirname "$0")/.."

APPNAME="Codex Usage Monitor"
APP="dist/CodexMonitor.app"
DMG="dist/CodexMonitor.dmg"

echo "[1/5] checking node (build-time only)…"
command -v node >/dev/null 2>&1 || { echo "ERROR: Node.js is required to BUILD. Install: https://nodejs.org"; exit 1; }
node -v

echo "[2/5] installing build-only deps (esbuild, postject)…"
npm install

echo "[3/5] building the self-contained binary via Node SEA…"
node scripts/build-sea.mjs
test -f dist/CodexMonitor || { echo "ERROR: dist/CodexMonitor was not produced — check the step above."; exit 1; }

echo "[4/5] assembling ${APP}…"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp dist/CodexMonitor "$APP/Contents/MacOS/CodexMonitor"
chmod +x "$APP/Contents/MacOS/CodexMonitor"

# Build AppIcon.icns from assets/icon.png (sips + iconutil are stock macOS tools).
if [ -f assets/icon.png ] && command -v iconutil >/dev/null 2>&1; then
  echo "      generating AppIcon.icns from assets/icon.png"
  ICONSET="$(mktemp -d)/AppIcon.iconset"
  mkdir -p "$ICONSET"
  for sz in 16 32 128 256 512; do
    sips -z $sz $sz assets/icon.png --out "$ICONSET/icon_${sz}x${sz}.png" >/dev/null
    sips -z $((sz*2)) $((sz*2)) assets/icon.png --out "$ICONSET/icon_${sz}x${sz}@2x.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns" || echo "WARN: iconutil failed; app will use default icon"
else
  echo "WARN: assets/icon.png or iconutil missing; app will use default icon"
fi

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Codex Usage Monitor</string>
  <key>CFBundleDisplayName</key><string>Codex Usage Monitor</string>
  <key>CFBundleIdentifier</key><string>com.codexusage.monitor</string>
  <key>CFBundleVersion</key><string>0.1.0</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>CodexMonitor</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
</dict></plist>
PLIST
# Ad-hoc sign so Gatekeeper will run it locally (not notarized — see note below).
codesign --force --deep --sign - "$APP" || echo "WARN: codesign failed; app may need right-click → Open."

echo "[5/5] creating ${DMG}…"
rm -f "$DMG"
hdiutil create -volname "$APPNAME" -srcfolder "$APP" -ov -format UDZO "$DMG"

echo ""
echo "Done -> $DMG"
echo "It bundles the Node runtime; teammates need NO Node.js install."
echo "Unsigned/ad-hoc: first launch, right-click the app → Open → Open (once)."
