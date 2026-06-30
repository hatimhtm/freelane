# Freelane LifeOS — Overhaul Roadmap

Goal: turn the current "barely-functioning money tracker" into the best single-user **LifeOS** —
luxurious, refined, interactive, smart. Local-first (no cloud until later). Flagged correctness +
data-safety fixes come FIRST, then friction, then breadth + a full UI/UX overhaul.

Status legend: ✅ done · �doing · ⬜ todo

---

## Phase 0 — Stop the bleeding (data safety + money correctness) — flagged first
- ✅ Install + verify Gemini API key (unblocks all AI features)
- ✅ #1 Disable sample-data seeding (was indistinguishable from real data, survived merge-import → double-counted books). Your real store verified clean.
- ✅ #3 Remove the misleading "Cloud restore" UI (it claimed "replace" but only merged). No cloud for now.
- ✅ #4 FX: every offered/used currency now gets a real rate (USDT/USDC pegged to USD); kills the silent 1:1 conversion.
- ✅ #5 Mixed-currency projects can reach "paid" (unified gross-base ratio).
- ✅ #6 Editing a payment no longer strands zeroed allocations (project↔ledger drift).
- ⬜ #2-tier money nits: `round2` mis-rounds negatives vs JS; withdrawal cash-out "fee" overstates feesMTD; backdated-before-opening-anchor divergence; recurring weekly/yearly `nextDue` ignore anchors.

## Phase 1 — Daily-use friction ("feels like a real app")
- ✅ #8 In-list search on every list (Payments, Spending, Projects, Clients, People, Vendors) via shared `SearchField`.
- ✅ #9 Removed silent truncation (spends / wallet ledger / client history now fully browsable, LazyVStack).
- ✅ #10 Enter-to-save app-wide (`.defaultAction` on the sheet scaffold's Save button).
- ✅ #11 Delete confirmation on Agenda items + fixed the weekly/yearly forecast (yearly bills never appeared before).
- ✅ #12 Edit (not just delete) withdrawals/transfers (`updateWithdrawal` + editable `WithdrawalSheet`).
- ⬜ #13 Inline "+ New project/client/wallet" inside pickers (deferred — nice-to-have).
- ✅ #22 Notification retention: 3-day default + purge sweep on launch.

## Phase 2 — Remove cruft + fix half-built
- ✅ #16 Removed **Plans** entirely — UI, sidebar, decoupled from `SafeToSpend` (all 7 call sites), Agenda, Dashboard, AI snapshot, `Brain.planPriceEstimate/planStrategy`.
- ✅ #19 Removed **Habits** entirely (UI, sidebar, Dashboard tile).
- ✅ Killed the "On-device AI" toggle; AI is always Gemini now (stale `.local` prefs coerced).
- ✅ Dead-code purge: `ComingSoon`/`isReady`/`blurb`, `LogPaymentSheet`/`showLog`, `SyncManager.wipe/wipeAny`, `Brain.maybeAskQuestion`, `ChartTip`.
- ⬜ Desktop **widget** removal deferred (removing the target from the hand-written pbxproj is build-risky; it's harmless/unused for now) — menu-bar beef-up folded into Phase 8 native integrations.
- 📝 Plan/Habit/HabitEntry `@Model` classes kept in the schema (dormant) so the existing local store opens without a destructive SwiftData migration. No UI references them.

## Phase 3 — AI that's actually smart (recognition + curiosity)
- ✅ #20/#21 `Brain.understandSpend` — ONE structured LLM pass returns category + merchant + merchant_type + beneficiary + person_name + confidence; confidence-gated (only asks below ~0.45 / no key).
- ✅ Natural-phrase parsing: "Got pizza for my wife" → beneficiary=wife (verb "Got" is not a name); the naive capitalized-token discovery is disabled when a key is present, so it can't ask "who is Got".
- ✅ "is Greenwich a family member?" fixed: merchant classified + stored as a vendor fact; both `candidateEntities` and `topUnidentifiedVendor` now cross-check `VendorBrand` (not just `Brand`).
- ✅ Beneficiary/person → `ensurePerson` quietly links/creates the entity (then the curiosity ladder ENRICHES them — relationship/likes/birthday — instead of guessing from raw text).
- ✅ `isVague` relaxed so "Mom"/"Rex"/"May" are accepted; answered questions now stay visible in the Read tab with the recorded answer ("You answered: …") instead of vanishing.
- ✅ Per-entity money matching is word-boundary ("Ana" no longer matches "banana").
- ⬜ **Contacts integration** to resolve real beneficiaries to your address book (moved to Phase 8 integrations).
- 📝 Validate prompt behavior in-app with live spends (build is green; LLM output not runtime-tested here).

## Phase 4 — Real vendor & wallet logos ✅
- ✅ Curated **~55-brand registry** (`VendorBrand`) with color + SF fallback + **domain** (food chains, retail, pharmacy, transport, fuel, utilities, telecom, streaming, grocery…).
- ✅ Real logos via the keyless Google favicon-by-domain service (same proven path as wallet logos), rendered as white rounded tiles with graceful fallback.
- ✅ **AI assigns the domain** in `understandSpend` (corrects typos → infers the official site, e.g. "jolibee" → jollibee.com.ph), cached per-spelling in `VendorLogo` so the real logo shows even when you typed the name oddly.
- ✅ `VendorMark` (Spending rows + Vendors page) now renders real logos.
- 📝 Optional upgrade: swap the favicon service for **Logo.dev** (higher-res) if you grab a free publishable token — `VendorLogo.url` is the single seam.

## Phase 5 — Faith, properly tracked ✅
- ✅ #18 Mark each prayer **prayed** (tappable check, per prayer per day) — new `PrayerLog` model; shows **X/5 today + day streak** (all-five consecutive).
- ✅ **Ramadan fasting** tracker — new `FastLog`; "mark today fasted", days-this-month count, X/30 + "Ramadan Mubarak" emphasis when the Hijri month is Ramadan.
- ✅ **Prayer-time notifications** — daily `UNCalendarNotificationTrigger` per prayer ("prayer-*" ids, coexist with the digest); toggle requests auth + schedules on load.
- ✅ Fixed the silent "—": prayer times are cached per location/method, fall back to last-known offline, with an "Offline — couldn't refresh" note + Retry.
- ✅ Bonus: "Prayers today X/5" tile added to the Dashboard (replaces the removed habits tile), deep-links to Faith.

## Phase 6 — Body / health, personalized ✅
- ✅ #19 Form now loads today's already-saved values on appear (no more "stuck on 3/3 defaults / stale input") + a "Saved ✓" confirmation.
- ✅ Body fed into the AI snapshot — a "BODY (14-day avg): energy/mood/sleep + latest note" section, so the assistant actually sees how you've been.
- ✅ **Trends** card: 7-day energy/mood/sleep averages, a 14-day mood-vs-energy line chart (Swift Charts), and a **mood × money** insight ("you tend to spend more on low-mood days").
- ⬜ (Later) Apple Health import (steps/sleep/workouts) — Phase 8.

## Phase 7 — Finance depth (table-stakes from competitor research)
Shipped the three highest-value pieces for a single freelancer; heavier items queued as 7b.
- ✅ **Budgets with rollover** — new `Budget` model + `BudgetMath` (leftover carries forward, overspend tightens next month); Spending → "Budgets" subtab with progress bars + `AddBudgetSheet`.
- ✅ **Cash-flow "Look Ahead"** — `CashFlowForecast` simulates 60 days (holdings + recurring income/bills on real due dates − daily pace); Agenda card shows projected balance, lowest point + date, runway warning, and an area chart with a zero line.
- ✅ **CSV export** — `DataExport` → payments/spends/transfers to CSV via a Save panel (Settings → Storage → "Export CSV").

### Phase 7b — partially shipped
- ✅ **Invoices (PDF)** — `InvoiceService` (ImageRenderer→PDF) + `InvoiceDoc` (light document layout) + `InvoiceSheet` (pick projects, invoice #, from-info, note); "Invoice" button on the client detail → exports a PDF via Save panel.
- ✅ **Receipt scan (Vision OCR)** — `ReceiptOCR` (NSOpenPanel → copy to storage → `VNRecognizeTextRequest` → best-guess total + vendor); "Scan receipt" in Add Spend pre-fills amount/vendor and attaches the image (`Spend.receiptPath`).
- ⬜ **Reconciliation** (clear/cleared), **CSV/OFX import**, **Smart Folders / bulk edit** — still queued.
- ⬜ **Split transactions** — low priority (spends are pure-label multi-tag by design; amount never splits).

## Phase 10 — Polish, performance, QA
- ✅ Ran a full QA correctness review of all 9 phases of changes. Fixed: cash-flow forecast double-counting future-dated ledger (start is now "as of today"); `ensurePerson` merging two different people who shared a relationship word (now name-only dedup); `BudgetMath` rollover look-back capped to 24 months.
- 📝 Reviewed-and-kept-as-correct: gross-based "paid" (a fee edit shouldn't un-pay a project); the archived-project recompute guard (archived is a status — don't resurrect); FX ×1 fallback only affects codes the ECB feed lacks (none of ours).
- ⬜ **The big remaining item: run the app and validate end-to-end** — AI parsing quality, vendor logos, prayer notifications, EventKit/Contacts permission prompts, budgets/forecast/invoices/OCR. None of this is runtime-tested.

## Phase 8 — LifeOS breadth (local) ✅ + integrations (8b queued)
- ✅ **Tasks** — new `TodoItem` model + full `TasksView` (Active/Done subtabs, Overdue/Today/Upcoming/No-date groups, search, due dates, important ★, focus-today, edit/delete with confirm).
- ✅ **Daily ritual** — "Today's focus" card on Today (tasks due today/overdue/focused, one-tap done).
- ✅ Tasks integrated everywhere: **Agenda** timeline (due tasks), **Dashboard** "Tasks due" tile, **AI snapshot** ("OPEN TASKS" section).
- ✅ **App Intents** expanded — `LogTaskIntent` ("Add a task to Freelane" via Siri/Shortcuts/Spotlight).

### Phase 8b — OS integrations ✅ (opt-in, all off until enabled in Settings → Integrations)
- ✅ Added the three usage strings via `INFOPLIST_KEY_*` to both app build configs (pbxproj validated with `plutil -lint`; backup at /tmp/pbxproj.phase8b.bak).
- ✅ `EventBridge` (shared `EKEventStore`) + `ContactsBridge` in `Sync/Integrations.swift`; opt-in toggles request access.
- ✅ **Calendar** events show on **Today** ("On your calendar today") and on the **Agenda** timeline.
- ✅ **Reminders** appear in **Tasks** ("From Apple Reminders") and can be completed (writes back to EventKit).
- ✅ **Contacts** canonicalizes an AI-spotted person name ("Ahmed" → "Ahmed Rahmani") in `understandSpend`.
- ⬜ **Global quick-capture hotkey** (needs Accessibility; menu bar covers most of this today).
- ⬜ Optional **journaling / daily notes**; WeatherKit/Maps context.
- 📝 Permission/TCC flows can't be runtime-tested here — validate the prompts + data in-app.

## Phase 9 — Luxury UI/UX overhaul (structural pass ✅; visual fine-tuning needs eyes-on)
- ✅ #15 Compact **widget-grid density**: Wallets (260→188 grid, 140→104 cards) and Clients (300→232 grid, 120→96 cards) now match the Dashboard MiniWidget density; Projects cards narrower (300→264 columns).
- ✅ #14 Kanban **native drag** (`.draggable`/`.dropDestination`) — clicks open the editor, drags move the card; removed the fragile coordinate-space + preference-key machinery and the tap-vs-drag conflict.
- ✅ **Press micro-interaction** — `PressableCard` button style (spring scale on press) on Wallet/Client/Project cards.
- 🔄 Iterative (needs you running it + screenshots): exact typography scale, Liquid-Glass refinement per Tahoe Control Center, per-screen empty-state polish, motion timing, color. I can't evaluate "luxury" blind — best refined from screenshots.
- 📝 Settings is now 6 tabs incl. Integrations; the broader "LifeOS control panel" (profile/tags/privacy domains) can grow as needed.

## Phase 10 — Polish, performance, QA
- ⬜ Full edge-case + accessibility + reduce-motion pass; final money-math audit; perf; in-app validation of everything built (AI parsing, logos, prayer notifications, integrations permissions).

## Phase 10 — Polish, performance, QA
- ⬜ Full edge-case + accessibility + reduce-motion pass; final money-math audit; perf.

---

### Research inputs (saved 2026-06-08)
Studied Debit & Credit, iCash, Money Pro, iCompta, CheckBook Pro, Invoices, Receipts Space; LifeOS apps
(Sunsama, Akiflow, Daylio, Reflect, Things); Liquid Glass HIG; AI merchant/entity recognition; Logo.dev /
Brandfetch. Key takeaways drive Phases 3, 4, 7, 8, 9. (Clearbit Logo API shut down Dec 2025 — use Logo.dev.)
