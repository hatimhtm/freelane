#!/bin/bash
# Compile the real bill math (Recurring.swift + Spend + PHT) with a small harness and assert what
# "paid through" derives to. The project has no test target; this is the regression check.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
R="$ROOT/Freelane"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
DEV="/Applications/Xcode.app/Contents/Developer"
[ -d "$DEV" ] || DEV="/Applications/Xcode-beta.app/Contents/Developer"
{ echo "import Foundation"; awk '/^enum PHT \{/,/^\}/' "$R/Money/MoneyCore.swift"; } > "$T/pht.swift"
DEVELOPER_DIR="$DEV" xcrun swiftc -parse-as-library -o "$T/billcheck" \
  "$ROOT/scripts/billcheck/main.swift" "$T/pht.swift" "$R/Models/Recurring.swift" "$R/Models/Spending.swift"
"$T/billcheck"
