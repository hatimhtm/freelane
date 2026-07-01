# Changelog

All notable changes to the Freelane macOS app. The section matching the app's
version is shown as in-app release notes when you update.

## 0.9

A leaner sidebar — only the things you actually use.

- **Removed the clutter:** People, Vendors, Faith, and the standalone Today page are gone from the sidebar (their data is kept, nothing is deleted). Today's useful parts — safe-to-spend and runway — already live on the Dashboard.
- **Clients moved into Money**, where it belongs.
- Search and ⌘K no longer surface the removed pages; a vendor search now takes you to Spending.

Next: a much easier way to record loan returns, and a physics-based drag for Projects.

## 0.8

Light mode — and a calmer, grounded look with less glass.

- **Warm light mode.** A proper warm-paper light theme to go with the warm dark. Switch it in Settings → General → Appearance: **Light / Dark / System** — it flips instantly, no relaunch.
- **Less glass, more grounded.** Content cards are now solid matte panels with a hairline edge and a soft shadow, instead of glossy glass boxes. Real Liquid Glass is kept where Apple uses it — the floating nav, the bell, the assistant pill — not on every card.

## 0.7

A warmer look with real depth — and the app icon finally matches.

- **Warm dark.** Out with the cold slate-and-blue, in with cozy warm-charcoal surfaces, warm-cream text, and a single amber signature. Dark, but inviting instead of clinical.
- **Depth, not flatness.** Cards now sit on a solid surface that lifts off the background with a stronger edge and shadow, so the screen stops reading as one flat sheet of same-colored panels.
- **The icon matches now.** The app icon and the in-app logo were redrawn to the new warm-amber identity (they were still the old design).
- **Fixed a nonsense alert.** "Wise is ₱0 overdrawn" is gone — a wallet only flags as overdrawn when it's *meaningfully* in the red, and it shows the real amount.

Next: a proper light/white mode you can toggle.

## 0.6

- Cloud sync stays off for now. The offline-first sync foundation is built and ready, but it's dormant until the companion app exists — so Freelane is purely local again: everything lives on this Mac, nothing touches the network, and there's no cloud setup to think about.

## 0.5

Smarter spending — your vendors now show you where the money's moving.

- **Vendor trends.** Each vendor in the Vendors list now shows a month-over-month pill — ↑ in coral when you're spending more there than last month, ↓ in mint when less (only real moves of 10%+ show, so it stays quiet).
- **Biggest mover on the home screen.** The Dashboard surfaces your single biggest vendor swing as a tile ("Spending up at Jollibee · 40% vs last month") that taps straight through to Vendors — the first of several screens that now talk to each other.

## 0.4

Offline-first cloud sync — your data, on this Mac and in your own private cloud.

- **Works fully offline.** Everything lives on this Mac first, so you can log spends and payments with no connection; changes queue up and sync automatically the moment you're back online.
- **Automatic sync.** Freelane now restores your cloud session on launch and syncs on its own — when the app opens, when it comes to the foreground, and the instant the network returns — instead of only when you ask.
- **Spends now sync up.** A spend you log offline (or on another device) now actually reaches the cloud — previously spends only came down, never went up.
- **A real Cloud tab in Settings.** Connect to your private Supabase, see live sync status and last-synced time, sync on demand, or disconnect. Your password is never stored — only a Keychain refresh token.
- **Live sync status in the sidebar.** The corner chip now shows whether you're synced, offline (saved locally), or local-only — tap it to jump to cloud settings.

This is the groundwork for a future companion app: one private cloud, with each device working offline and reconciling when online.

## 0.3

The start of a v2 rethink — a brand-new look and a smarter home.

- **New identity: Nordic slate + electric.** The whole app moves off espresso-and-gold to a cool graphite/slate palette with a single electric-blue signature, crisp near-white text, and clean sans headers. Sharp, modern, calmer to live in.
- **Section identity.** Each sidebar area now owns an accent — Money is mint, People periwinkle, Life orchid, Insights ice, Overview electric — with a colored dot per group, so you always know where you are at a glance.
- **A home that pulls the right thing forward.** The Dashboard now leads with a "Needs you" surface that surfaces only what actually wants a tap (an overdrawn wallet, overdue projects, overspending, an evening prayer nudge), ranked by urgency. When nothing needs you, it steps aside for a calm overview.
- **Smoother.** Page navigation is one consistent motion everywhere (it used to mix three), the old double-animation jank on page swaps is gone, and hovering the cash-flow chart no longer re-runs the money engine — so the busiest screen stays fluid.
- Hardened the app's data-folder lookup so launch can't crash on an edge case.

## 0.2

- A first tiny update to try out in-app updating — the About screen now notes that updates come straight from GitHub.

## 0.1

First public build of the native macOS app.

- Money core: payments as fee-aware chains, wallets/withdrawals on a single ledger, projects, spending, loans, stats, activity, dashboard, today.
- People: clients, entities, vendors with price memory. Life: journal, prayer times + qibla + Quran, body, sadaka. Intelligence: grounded AI chat + curiosity engine.
- In-app updates via Sparkle — check from Settings → About or Freelane ▸ Check for Updates….
- Fixes: zero / near-zero wallet balances no longer render as negative (red); a spend stays on the wallet you picked instead of flipping to Cash on save; loans are grouped into one card per person with the full lend/repay history; the AI stops re-asking questions you've dismissed (and no longer treats a tricycle as a person); AI insights are much shorter.
