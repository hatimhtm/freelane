# Changelog

All notable changes to the Freelane macOS app. The section matching the app's
version is shown as in-app release notes when you update.

## 1.6

Dead code and dead-end instructions.

- **The bell was asking "who is Got?" again.** A guard in the curiosity engine read *"only guess at names naively when there's no Gemini API key"* — and Gemini was removed in 1.0, which made that condition permanently true. So the naive capitalized-word guesser ran on every sweep even with a good local model loaded: exactly the behaviour the code's own comment claimed it prevented. It now checks whether a brain is actually available.
- **Three places told you to do something impossible** — "add your Gemini API key in Settings → AI" — a key the app no longer uses, in a tab that no longer exists. A dead-end instruction is worse than none.
- Removed the leftover Gemini key store, and the Personal-context explanation no longer names a threat model that isn't there any more.

## 1.5

Wallets, Loans, Projects and every sheet.

- **Wallets is a balance sheet.** It was a grid of equal boxes, which is the worst shape for a page whose only question is "how much is where" — a grid makes you compare figures that aren't aligned. Now one column sorted biggest first, each balance in a tabular figure with a share bar beneath it, led by the total.
- **Loans answers the actual question.** Two figures side by side never told you whether you're up or down overall. The page leads with your **net position**, then splits people into *They owe you* / *You owe them* / *Settled* — three different feelings that one alphabetical list buried.
- **Project columns carry money.** "Unpaid 2" tells you nothing: two unpaid projects could be ₱200 or ₱200,000, and knowing which is the entire reason to look at the board. Each column now shows its total — outstanding for the open columns, earned for Paid.
- **Every sheet got its header rebuilt.** A tinted glyph square, a title, and a filled ✕ on a grey bar was the last of the old visual language and the busiest 60 points in the app — two filled shapes competing before you'd read a word. Now an accent rule, the title in the editorial serif, and a plain close glyph. Field labels dropped a step so a form stops reading as a wall of equal text.

## 1.4

Spending and Insights actually restructured, not restyled.

- **Spending is two columns, and the right one does work.** It was four stacked cards — a hero, a category chart, a budgets card, and an undated list — where the chart and the budgets were both read-only. Now the ledger runs down the left **grouped by day with a running daily total**, and the category breakdown on the right is **interactive: tap a category and the ledger filters to it**. The single most common thing you want after seeing "Food ₱4,080" is to see which food, and there was no way to get there before.
- **Budgets folded into the categories.** A category with a cap now draws that cap into its own bar — ochre as it approaches, oxblood past it — instead of repeating every category name in a second card further down the page.
- **Insights leads with the chart.** Seven full-width cards of equal weight meant nothing was the answer to "how is the business doing". The trend chart now leads with the four supporting figures in a rail beside it, and the tables sit two-up instead of end to end.

## 1.3

Motion, depth, and the last of the badges.

- **The app moves now.** Figures tally up as they arrive rather than appearing fully formed, the balance line traces itself left to right with a soft glow under the stroke, sections rise and settle in sequence, and large panels carry a light that follows your pointer. All of it respects Reduce Motion, and none of it is decoration — a number counts because it's being totalled, a line draws because it's being traced.
- **The Dashboard has a lead, not a header.** The balance is set at 60pt with the chart bleeding across the full width behind it and light falling from the top-left corner, instead of a figure in a flat box with a chart underneath it.
- **The last tinted glyph squares are gone.** The weather banner was the final one — a coloured icon in a rounded square plus a full-card colour wash, sitting directly under the lead panel looking like a different product.
- **Observations stopped being badges.** Four rows each led by a differently-coloured icon turned a card of four sentences into a card of four logos, and every row carried a permanently-visible "⋯". The icons are gone, and pin/dismiss appear on hover.

## 1.2

Menus, copy, and the Dock icon — the details.

- **Menu items had no text.** Every menu built as `Button { … } label: { Label(…) }` rendered inside a macOS menu as a bare icon with no title, so "Add", "Wallet" and "Log payment" opened onto a column of unlabelled glyphs. That form is the culprit; all menu items now use the initializer that actually renders a title.
- **The stray chevron is gone.** `.borderlessButton` draws its own disclosure arrow, so every row's ⋯ was rendering as "⋯⌄" — an ellipsis wearing a second control.
- **The Dock icon finally updates.** The asset catalog was generating an .icns with only four representations, stopping at 256px. A Retina Dock asks for 512 and 1024, found nothing, and fell back to whatever it had cached — which is why the new icon never appeared no matter how many times it shipped. The app now carries a complete ten-representation icon file.
- **Menus say what things are.** "Routed payment (multi-hop)" → "One that passed through several wallets". "Bill or income (recurring)" → "Bill or income". "Loan" → "Money lent or borrowed".
- **Removed what nobody uses.** The card-density picker is gone from Wallets. The Clients "⋯" menu held exactly one item, so it's a button now — a menu with one item is two clicks for one action.
- **Page subtitles say what the page is for** rather than describing the implementation: "Money in and out, ledger-accurate" → "Everything that landed, and everything that left"; "Balances are derived from your ledger" → "Where your money sits right now".

## 1.1

Every screen, gone through one at a time.

- **One ledger, everywhere.** Payments, spends, bills, loans, sadaka and the agenda timeline now share a single row: a hairline mark in the semantic colour, the label, and the figure in tabular type at the end. Each screen used to draw its own — usually a 34pt filled colour circle in front and the amount set at the same size as its label, so the least informative thing on the row was the loudest and columns of numbers didn't line up.
- **Vendor logos stay.** They're the one mark that was actually information; the invented badges around them are gone.
- **Tiles lead with the number.** The tinted rounded-square icon in the corner of every tile is retired — a grid of a dozen of them is what made the app read as a template. The label is now a small-caps line and the figure is set in the editorial serif at nearly twice its old size. Values that are words rather than numbers drop to sans, so a vendor name stops arriving as a headline.
- **Client cards say one thing.** Earned, Outstanding and Projects were three equal columns shouting at the same volume. Now what they owe you leads, and the rest is one quiet line.
- **Project cards stopped repeating themselves.** Client colour was a spine AND a dot; overdue was a badge NEXT TO the status badge. One spine, one badge.
- **Primary buttons are one colour.** Nine different tints across nine screens read as nine apps.
- **Charts joined the palette** — the teal that predated this palette is gone from the cash-flow and income graphs.
- **The assistant button stopped covering things.** A 54pt orb was parked over the bottom-right corner of every page, on top of the Set budgets button and the income chart. It's a small capsule now that names itself on hover.
- **Body no longer looks like a warning.** The check-in card was washed in oxblood; the same applied to Sadaka's suggestion card. Depth comes from elevation, not a colour wash.
- Truncated tile labels fixed ("Landed this mo…", "Top client sha…"), and observations now de-duplicate on what they're ABOUT rather than their wording, so a rephrasing stops appearing as a second finding.

## 1.0

The first version I'd call finished. The intelligence was rebuilt from the ground up, the app has a new identity, and the parts that were quietly making things up have been taken out.

### The AI no longer invents things about you

- **Observations are computed, not written.** Everything in "What Freelane noticed" is now arithmetic over your own rows — a comparison you could check by hand. No language model decides what's true about your money or your life any more. It used to, and it produced sentences like *"your gifting pattern is designed to preemptively manage relationship friction, not genuine generosity"* — fluent, confident, and entirely invented. Two rounds of stricter instructions didn't stop it, so the model lost the job. The 84 fabricated ones already in your app are cleared on update.
- **It can't leak internal ids into questions.** "What would make the next step feel good, like the 1000 euro contract from journal_1784966887??" happened because memories were keyed by timestamp and the key was being shown to the model. Nothing outside the memory layer ever sees a key now, and no question ships without passing a single strict gate — the old lenient fallback path is gone, which is how the double question mark got through.
- **Corrections actually correct.** Telling it "I never sold a motorbike" used to file that sentence as one more belief beside the claim it was refuting, so it held both and kept asking. A correction now deletes what it contradicts, including an older correction on the same subject. Your 253 stored beliefs were rebuilt: guesses retired, what you confirmed kept, your corrections replayed oldest-first so the most recent thing you said wins.
- **You can see and delete everything it believes.** Settings → Intelligence lists every belief, where it came from, and a bin next to each one.
- **Questions can't come back malformed.** Every structured AI call now decodes against a fixed schema, so a wrong category or a truncated reply is impossible rather than merely discouraged. That class of bug — where a bad reply silently rendered an empty box — is what "things don't load and it breaks" was.
- **Questions are written one at a time.** The old batch prompt carried your entire history and blew the context window, which is why "New questions" failed most of the time. Each question now gets its own small prompt, and a failure costs one question instead of all of them. When nothing can be added, it tells you why and which brain was asked.

### A local model that's actually yours

- **Qwen3-8B runs inside Freelane, on your Mac.** About 4.6 GB, downloaded once from Settings → Intelligence, loaded straight onto the GPU. No Ollama, no server, no second app. Once it's down, the AI works with the internet off.
- **Apple's Private Cloud Compute is off.** It's wired up, but on this macOS build it reports itself available and then fails every call — four attempts, four errors, zero successes. A new circuit breaker drops any brain that fails repeatedly without ever succeeding, so a dead one can't sit at the head of the queue burning every request or spam you about it.
- **Superseded weights are deleted automatically.** Changing models never leaves two multi-gigabyte copies on disk.
- **Interrupted downloads resume** on next launch instead of leaving the app brainless with half a file.

### A new look, and one less thing to feel bad about

- **New palette and new icon.** Warm-neutral ink instead of the muddy brown, one forest-green accent, and a serif for headlines and hero figures so the app reads like a page rather than a dashboard. The mark no longer inverts with the theme — a logo is a constant. There's a light theme in Settings, retuned to warm grey rather than the paper white that was genuinely painful to look at.
- **The journal streak is gone.** The whole system — streaks, coins, freezes, recovery, and the calendar marking every day you missed in red. It turned journalling into a daily obligation and made a busy day feel like a failure, which is the opposite of the point. Days you wrote still show; days you didn't are simply blank.
- **Open questions read like invitations.** Larger serif type, room to breathe, and the housekeeping controls stay out of the way until you're on a question.
- **The page stopped shimmering.** The animated background was re-rendering continuously for the whole life of the app to make glass refract against something. The cards aren't glass any more, so it bought nothing but heat.

## 0.20

Talk back to it — your answers now teach it directly.

- **Say "don't ask about this again" inside an answer and it listens.** Writing "stop asking", "I'm not interested in this", or "I never did this" in a journal answer now burns that topic exactly like the ✕/👎 buttons — the explicit phrases are matched directly (never left to the model's judgment), and softer pushback is picked up by the analysis.
- **Correct it, and its memory updates.** Write "actually, I live in Manila now" or "I never had a motorbike" in any answer and the corrected fact is stored in your own words at near-certainty — while old inferred beliefs it contradicts are archived. Your words always outrank what it guessed.

## 0.19

Questions that are actually about you — two real bugs, fixed at the root.

- **Why "New questions" kept failing:** the app was feeding the model your entire ask-history — over a hundred past questions — plus everything else, which blew past the on-device model's context limit, so generation simply died. The prompt now carries only the recent history (deep-archive repetition was already blocked mechanically), and if a batch still fails, a slimmer retry runs before the button ever gives up. When nothing can be added, the button now says *why* instead of doing nothing.
- **Why it invented things like a "singing contest":** the personal-context digest treated things you'd *read about* in Safari as things you *do* — one stray article became "practicing for a singing competition." The digest was rebuilt: what you did (messages, calendar, reminders) and what you merely looked at are now separate, browsing can never be asserted as your life, junk "search terms" from non-search sites are ignored (that's where the phantom topics came from), and garbage contact fragments can't be recorded as people.
- **You can now see what it thinks.** Settings → Integrations → Personal context shows the current digest — life threads, reading topics, people — with a "Refresh now" button. If a question ever feels off, you can see exactly where it came from.
- The old bad digest is discarded automatically on update.

## 0.18

The AI now knows your life, and Siri now knows Freelane.

- **Personal context (opt-in).** Settings → Integrations grew a "Personal context" card: let the AI read your **Messages**, **Safari history & searches**, and **Calendar** (plus Reminders if already on). Once a day, the on-device model digests them into themes — "apartment hunting", "in touch with Sarah a lot", "flight on the 24th" — and journal questions, insights, and chat quietly become aware of your actual life. Signals, not quotes: message text is never stored and never quoted back at you.
- **Privacy, hard-gated.** Every source is off by default. The digest is produced by the on-device model directly and can only ever ride on-device prompts — even if you enable the Gemini cloud fallback, this content is excluded from anything that could leave the Mac. Messages and Safari need Full Disk Access (the card walks you there).
- **Siri can drive the app.** Freelane's projects, clients, and wallets are now registered in the system's semantic index, so the new Siri can find and open them by name — "open Acme in Freelane" lands directly on that client — alongside the existing voice actions (log a spend, safe-to-spend, log a payment, and more).

## 0.17

Journal questions, fixed and rethought.

- **The "…" questions are gone — and can't come back.** The new on-device model copied the example format from our instructions literally, so three questions whose entire text was "…" reached your Journal. Every AI reply that gets stored now passes a real-content check, the instruction templates no longer contain copyable placeholders, and the app cleans out any junk that slipped in (your "…" rows disappear on first launch).
- **Questions are simple and human now.** The generator was rebuilt: every question is under 15 words, one idea, plain spoken language — "What's been weighing on your wallet this month?" instead of a two-clause poem about what your kitchen says about your soul. Poetic or double-barreled output is rejected before you ever see it.
- **Less repetition, by design.** Each batch draws from different territories (feelings, work, money, people, faith, the future, body, small joys) than the last batch — rotation is enforced in code, so it can't keep circling the same two topics no matter what you wrote about. Follow-up questions obey the same style rules.

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
