# Changelog

All notable changes to the Freelane macOS app. The section matching the app's
version is shown as in-app release notes when you update.

## 0.16

Built for macOS 27 "Golden Gate" — and one brain instead of three.

- **Apple's new on-device model is now the app's main brain.** macOS 27's rebuilt foundation model tested faster (1–3s) and smarter than the local Gemma it replaces — so the whole Ollama/Gemma layer is gone: no separate install, no 10GB model on disk, no RAM governor, one less thing in Settings. Everything — tagging, insights, questions, chat — runs on-device, private, offline. Gemini remains strictly opt-in, as before.
- Two hardenings from actually testing the new model with the app's real prompts: JSON replies that come back malformed are retried once with strict instructions (so insights never silently fail), and the "who is this person?" question can never be triggered by a relationship word — the model once answered "wife" as a person's name; the app now knows better.
- **The app now requires macOS 27** and is built against the new SDK, so it wears Golden Gate's refined Liquid Glass automatically — better content diffusion, the new edge treatment, and it respects the system-wide transparency slider on the nav layer.
- **Dashboard tile reordering is native now** — rebuilt on macOS 27's new reorder API, so dragging tiles gets the system's pickup and settle animations instead of our old hand-rolled drop logic.
- Updates are back: this release is on GitHub again, so "Check for Updates…" works from here on.

## 0.15

The big one — five real money-logic fixes, and the app finally acts on what it knows.

**The number you trust is now honest:**
- **A big purchase no longer wrecks your day.** Safe-to-spend excluded one-offs and investments from your allowance but still counted them against it — log a ₱30k laptop and the app screamed "overspent." Now only everyday spending burns the day down (the "Spent today" tile still shows the real total).
- **Money landing today counts today.** The day's allowance used to freeze at dawn clamped to your morning wallet cash — a ₱50k payment at noon changed nothing. Now the frozen part is only your spending pace; wallet reality applies live, so income lifts the day back up (never above your pace).
- Fixed a silent drift where editing a payment's net didn't update its chain step (would have made the future Android app disagree with the Mac by the corrected amount), a missing sync flag on learned bill amounts, and loans that could read "All settled" while showing an open loan you couldn't close.

**The app now helps you act:**
- **"Acme owes ₱40k · 34 days" on the Dashboard.** The #1 thing a freelancer opens the app for is now a Needs-you signal that opens straight into that client — where the AI nudge-drafter lives.
- **Pay bills where you see them.** Due bills now have a Pay button on the Agenda and right inside the bell notification — no more "go to Spending → Recurring."
- **Budgets.** Give any category a monthly cap: a quiet progress bar in Spending (amber at 80%, red when over) and a Dashboard signal when one blows through.
- **Savings goals are back.** Set a target and a monthly set-aside on the Agenda; the set-aside is reserved out of safe-to-spend like a bill, with months-to-go estimated.
- **A month-end ritual.** On your first open of a new month: "June, closed — landed X, spent Y, net +Z, income +12% vs May, most on food, fees took ₱800."
- **Capture in one keystroke.** ⌃⌥Space (quick spend from anywhere) is now on by default, and ⌘K's "Log a spend / payment" opens the sheet directly instead of just navigating.
- The AI's mind × money read now includes your body check-ins — mood, energy, sleep, and workouts against your spending. Your city is now settable in Settings, so cost-of-living anchoring is actually yours. First launch now leads with "add your first wallet" instead of ₱0 tiles you can't do anything with.

**And the polish:**
- Content centers in wide windows (no more dead right gutter), the cursor becomes a pointer over everything clickable, dashboard tiles dropped the 7-color rainbow for the one amber identity (color now only means something), warning-orange is reserved for actual warnings, heavy shadows and glows are tuned for light mode, key numbers on tiles got bigger, Spending got a real hero ("spent this month" + 6-month shape + delta), and the last stray half-point font sizes are gone.

## 0.14

Structure — a tighter map and real keyboard muscle memory.

- **Stats and Activity are now one page: Insights.** The month/year/lifetime business read and the day-by-day activity trail were both "look back at what happened" — now they're subtabs of a single sidebar destination (Activity's filters, search, and Trash all came along). One less sidebar row.
- **⌘1…⌘9 jump straight to any sidebar page** in order, and **⌘, opens Settings** like every Mac app. The ⌘? cheat sheet now tells the whole truth — it gained ⌘N (log spend), ⌘⇧N (log payment), and the new jumps, and stopped claiming things that didn't work.
- **Wallets finally greets you.** With no wallets it now explains what wallets are and offers the add button — instead of a lonely ₱0 over a blank grid.
- **The Qur'an reader matches the app now** — the warm backdrop, entrance animation, click-outside and Esc to close, instead of the flat dark panel it's been since v0.1.

## 0.13

Feel — the app responds to your hand now.

- **Transaction rows are alive.** Spends, payments, transfers, and loan people now highlight under the cursor and open with a **click anywhere on the row** — no more hunting for the hidden ⋯ menu (it's still there for delete).
- **Kanban that never drops the ball.** Miss a column and the card **springs back to its slot** instead of vanishing mid-air; a gentle pickup spring when the drag starts; dragging near the board's edge **auto-scrolls** toward off-screen columns; and the whole board no longer re-renders on every mouse move while dragging (only the floating card does).
- **Sheets respond instantly.** The first field focuses the moment a sheet opens (there was a 0.3-second dead zone where typing went nowhere), and adding/removing payment rows and the "arrived together" panel now slide in instead of popping.
- **Search (⌘F) got arrow keys.** ↑↓ move the highlight, ⏎ opens it — same as ⌘K, at last.
- **One motion language.** Every animation in the app now comes from the same six named springs — page turns, card entrances, presses, toasts. Nothing bounces one way on one screen and another way on the next.
- Tappable cards (wallets, clients) now lift slightly on hover, like the dashboard tiles always did.

## 0.12

Coherence — the whole app now speaks one visual language.

- **Light mode actually works everywhere now.** Text fields, sheet headers and footers, the selected tab pill, chart crosshairs, the heatmap, the qibla dial — dozens of controls were still painted for a dark room and went nearly invisible on the warm-paper theme. All of them now adapt properly to light and dark.
- **One selected-state look.** The in-page tab bar now uses the same amber pill as every other segmented control, instead of its own washed-out white one.
- **Machined corners.** Cards shipped at seven different corner radii (13–24). Now there are exactly two — compact tiles at 16, section cards at 20 — so screens read as one machined surface instead of assembled parts.
- **Calmer cards.** The glowing colored dot on every card title is gone (Stats alone flashed five different colors), and icon-chip glows are toned down. Color now means something: money states and the amber signature — section identity stays in the sidebar where it belongs.
- **The last glass box is gone.** The cash-flow hover tooltip was the one remaining frosted-glass element in the content layer; it's now a solid grounded card like everything else.
- Evened out type drift (a dozen controls used odd half-point sizes).

## 0.11

Projects drag-and-drop, now with real physics.

- **A card that feels physical.** Dragging a project card now lifts it into a floating ghost that **tilts with your drag speed**, scales and casts a deeper shadow the faster you move, and springs to follow the cursor — instead of the flat native drag.
- **Columns react.** The column under your card lights up and lifts as you hover it, so it's obvious where the card will land. Drop it and it settles into place.
- Tap a card to edit, drag it to move — the two never get confused.

## 0.10

Loans that finally make sense — record a return in one tap.

- **One "Record return" button per person.** Enter how much they paid you back and it's applied to your **oldest loan first** (even partially), spilling across loans as needed. You never pick which specific loan — a person's debt is treated as one pool, the way you actually think about it.
- **A persistent history.** Every lend and every repayment for a person now lives in one unified timeline that always stays visible, instead of being scattered across separate loan cards.
- Individual loans are still there for edits, forgiving, or corrections — just tucked below the history.

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
