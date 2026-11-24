#!/bin/bash
# Build TaskTrafficLight.app as a universal (arm64 + x86_64) bundle.
set -euo pipefail

cd "$(dirname "$0")"

APP="TaskTrafficLight.app"
BUILD="build"
MIN_MACOS="13.0"

rm -rf "$APP" "$BUILD"
mkdir -p "$BUILD" "$APP/Contents/MacOS" "$APP/Contents/Resources"

slices=()
for arch in arm64 x86_64; do
  out="$BUILD/TaskTrafficLight-$arch"
  swiftc -O -target "${arch}-apple-macos${MIN_MACOS}" \
    Sources/LightView.swift Sources/main.swift \
    -o "$out"
  slices+=("$out")
done

lipo -create "${slices[@]}" -output "$APP/Contents/MacOS/TaskTrafficLight"
cp Info.plist "$APP/Contents/Info.plist"

if [ -f Resources/AppIcon.icns ]; then
  cp Resources/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
fi

codesign --force --sign - "$APP" >/dev/null 2>&1 || true
echo "Built $APP"
lipo -info "$APP/Contents/MacOS/TaskTrafficLight"
