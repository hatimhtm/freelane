#!/bin/bash
# Compile the real menu-bar capture parser with a small harness and assert how lines are read.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
DEV="/Applications/Xcode.app/Contents/Developer"
[ -d "$DEV" ] || DEV="/Applications/Xcode-beta.app/Contents/Developer"
DEVELOPER_DIR="$DEV" xcrun swiftc -parse-as-library -o "$T/capturecheck" \
  "$ROOT/scripts/capturecheck/main.swift" "$ROOT/Freelane/Sync/NaturalCapture.swift"
"$T/capturecheck"
