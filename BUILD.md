# Building Freelane

**Requirements:** macOS 26 (Tahoe) · full **Xcode 26** (the SDK ships the Liquid
Glass + on-device FoundationModels APIs the app uses).

The Xcode project is committed (`Freelane.xcodeproj`). It uses an Xcode 16+
**synchronized folder group**, so any `.swift` file added under `Freelane/` is
compiled automatically — no project-file edits needed.

## Open in Xcode
```bash
open Freelane.xcodeproj      # select the Freelane scheme → Run
```

## Command-line build/test
`xcode-select` on this machine points at the Command Line Tools, so `xcodebuild`
needs Xcode pointed to explicitly (no sudo required):

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  xcodebuild -project Freelane.xcodeproj -scheme Freelane \
  -configuration Debug -destination 'platform=macOS,arch=arm64' build
```

The first build resolves the **Sparkle** Swift package from
`github.com/sparkle-project/Sparkle` (network needed once; cached after).

## Notes
- **Targets:** `Freelane` (app) + `FreelaneWidgetExtension` (WidgetKit). The app
  embeds the widget and the Sparkle framework.
- Ad-hoc signed (`CODE_SIGN_IDENTITY = "-"`); first launch may need right-click → Open.
- **Not sandboxed** (App Sandbox off) and hardened runtime off — deliberate, so
  ad-hoc local builds run without per-launch Keychain prompts.
- Bundle id `app.freelane.mac`. Deployment target macOS 26.0.
- Storage is local SwiftData at `~/Library/Application Support/Freelane/`.
- The Gemini key (if you opt into cloud AI) lives in a `0600`, backup-excluded
  file — not the Keychain — to avoid a prompt on every ad-hoc launch.

## In-app updates (Sparkle)
- The feed is the EdDSA-signed `appcast.xml` published on GitHub Releases
  (`SUFeedURL` / `SUPublicEDKey` in `Info.plist`).
- The **private** signing key and Sparkle CLI tools live in `.sparkle-tools/`,
  which is git-ignored and **never committed**. To build releases on a new
  machine, copy that folder over (one signing key is reused across all the apps).

## Cutting a release
```bash
# 1. Bump MARKETING_VERSION + CURRENT_PROJECT_VERSION in Freelane.xcodeproj
# 2. Add a "## X.Y.Z" section to CHANGELOG.md
scripts/release.sh           # builds universal, signs, makes .dmg/.zip/appcast
# 3. Run the `gh release create vX.Y.Z …` line it prints (tag MUST be vX.Y.Z)
```
