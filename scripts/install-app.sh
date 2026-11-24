#!/bin/sh
# Install TaskTrafficLight.app from the latest GitHub release.
#
#   curl -fsSL https://raw.githubusercontent.com/wunankun/dsh-task-traffic-light/main/scripts/install-app.sh | sh
#
# The app is ad-hoc signed, so the download is de-quarantined after unpacking.
set -eu

REPO="wunankun/dsh-task-traffic-light"
ASSET="TaskTrafficLight.zip"
URL="https://github.com/${REPO}/releases/latest/download/${ASSET}"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This installer only runs on macOS." >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "Downloading ${ASSET}…"
curl -fsSL "$URL" -o "$work/app.zip"

echo "Unpacking…"
ditto -x -k "$work/app.zip" "$work"

if [ ! -d "$work/TaskTrafficLight.app" ]; then
  echo "The release archive did not contain TaskTrafficLight.app." >&2
  exit 1
fi

target="/Applications"
if [ ! -w "$target" ]; then
  target="$HOME/Applications"
  mkdir -p "$target"
fi

echo "Installing to ${target}…"
rm -rf "$target/TaskTrafficLight.app"
ditto "$work/TaskTrafficLight.app" "$target/TaskTrafficLight.app"
xattr -dr com.apple.quarantine "$target/TaskTrafficLight.app" 2>/dev/null || true

echo "Done. Opening the app; look for the lamp at the right edge of the screen."
open "$target/TaskTrafficLight.app"
