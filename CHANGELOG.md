# Changelog

All notable changes to the Freelane macOS app. The section matching the app's
version is shown as in-app release notes when you update.

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
