# Freelane LifeOS — Master Upgrade Plan

> Planning artifact. No code was changed producing this. Every claim below was checked against the
> actual source (`mac/Freelane/`, 63 Swift files, ~12k LOC) and `mac/ROADMAP.md`. File:line citations
> are from the tree as of 2026-06-10 (branch `main`).

---

## A. Executive Summary

- **Total distinct tasks: 168**, across **13 phases** (Phase 0–11 + an "Ambitious/Optional" bucket P-X).
- **Rough sizing:** Phases 0–2 (correctness + capture + data-safety substrate) ≈ 35 tasks, mostly small-to-medium, ~2–3 focused sessions. Phases 3–4 (AI architecture + design-system substrate) ≈ 30 tasks, large/foundational, ~3–4 sessions. Phases 5–9 (per-area feature breadth) ≈ 70 tasks, ~6–8 sessions. Phases 10–11 (polish/a11y/visual) ≈ 18 tasks, needs-user-eyes, ongoing. P-X (ambitious/optional) ≈ 15 large tasks, open-ended.
- **Honest scale:** the spec is roughly a 6-month full-time roadmap for one engineer. It is NOT a sprint. The high-leverage core (Phases 0–4) is achievable; the "competitor patterns + net-new + AI playbook" sections are a multi-quarter wishlist and are deliberately quarantined into P-X so they cannot block the core.

### Reality-check headline
The reviewer who wrote the spec made **several factual errors** by trusting the prose over the code:
- `.buttonStyle(.glass)` / `.glassProminent` **are real macOS 26 system styles** — they are NOT undefined and do NOT render as plain text. No custom style is needed. **(WRONG-PREMISE)**
- `updatePaymentDetails` (PaymentEngine:287–307) **already re-spreads allocations** when net shrinks. **(ALREADY-DONE — verify only)**
- FXService (53–68) **already guards** `if usdRate > 0` so stablecoins are never pegged to 0. **(ALREADY-DONE)**
- `LoansView` **exists** (Features/LifeViews.swift) and **Wallets is already a sidebar feature** (RootView.swift:17). **(ALREADY-DONE)**
- `ReceiptOCR` is claimed "shipped" by ROADMAP Phase 7b but **does not exist in the codebase** — no Vision/VNRecognizeText anywhere. Roadmap is stale; this is genuinely net-new. **(VALID — and a roadmap correction)**

### Top 10 highest-leverage tasks
1. **P0-T07** Soft-delete (`deletedAt`) is the precondition for Undo + Trash + safe data ops — do the schema add ONCE, additively. *(high(data))*
2. **P0-T01** Recurring `nextDue` weekly/yearly anchor fix + monthly `/30`→actual-days — wrong forecasts mislead every cash-flow surface. *(high(money))*
3. **P1-T01** Undo toast + soft-delete restore on every destructive action — directly answers the user's data-loss trauma.
4. **P2-T01** Menu-bar natural-language capture via `understandSpend` — the #1 friction win; the parser already exists.
5. **P4-T01** Switch/decide `GlassCardModifier` strategy + collapse ~15 corner-radii into a `Radii` enum — unblocks all visual polish.
6. **P3-T01** Tool-call AI architecture (`AITool` protocol + retrieval-over-recall) — the substrate every smart feature depends on.
7. **P3-T05** Stop sending the full ledger; sampled `StateSnapshot` + redaction + cache — cost, privacy, and correctness in one.
8. **P0-T03** Validate/refuse unknown-currency ×1 fallback (MoneyCore:23–25) — silent money corruption guard.
9. **P0-T11** Move `gemini.key` to Keychain (NEEDS-DECISION on the prompt tradeoff) — only real secret on disk in plaintext.
10. **P5-T01** Restore-from-backup sheet over the existing `DataBackup` — the user already has backups on disk with zero UI to use them.

---

## B. Reality-Check Ledger

| Spec claim | Classification | Evidence (file:line) | Note |
|---|---|---|---|
| `.buttonStyle(.glass)` / `.glassProminent` "never defined → plain text" | **WRONG-PREMISE** | Used 51×/22× app-wide; **no** custom `GlassButtonStyle` exists (only `PressableCard`, FormComponents.swift:182). | These are OS-26 system styles. They render correctly. Do NOT define replacements. A `DestructiveButtonStyle` convenience is still mildly useful (VALID, small). |
| `GlassCardModifier` is fake frost, not real `.glassEffect` | **VALID but NEEDS-DECISION** | Theme.swift:116–146 uses `.ultraThinMaterial`+gradients **by deliberate design** (comment 125–128: the real `.glassEffect` morph/flow caused "two glass pieces" bug). `navGlass` (157–163) uses real `glassEffect`. | The reviewer is right about the *mechanism* but wrong that it's an oversight. Switching back reintroduces a known bug. Decision needed (see C-5). |
| Mesh tints + tinted glass = "brown sludge"; drop tints to 6–8% | **VALID** (needs-user-eyes) | Theme.swift:133 `tint.opacity(0.14)`; mesh stops 33–36; Palette tints. | Plausible; cannot judge blind. Tunable. |
| PaymentEngine:186 rounding remainder dumped invisibly into last allocation | **VALID** | PaymentEngine.swift:186 `rounded.append(round2(netRounded - running))`. | Add an audit line / surface the remainder. Low risk. |
| PaymentEngine:287–307 doesn't re-spread allocations when net shrinks | **ALREADY-DONE** | PaymentEngine.swift:288–307 explicitly re-spreads with weight fallbacks; comment 289–293 documents the exact fix. ROADMAP Phase 0 #6. | Verify only. |
| EditPaymentSheet:25 blank net silently defaults to gross | **VALID (partial)** | EditSheets.swift:14/26/51 — `Double(net)` is `nil` when blank; engine computes `fee = gross − net`. Hardening the validation (net ≤ gross, non-blank) is worthwhile. | Low risk, add inline error. |
| EditWalletSheet:186–189 opening-balance change double-counts | **VALID** | WalletsView.swift:216–217 sets `openingBalanceBase`/`openingBalanceSetAt` but does NOT archive ledger before the new anchor; Metrics.swift:14 sums `opening + Σledger since anchor`. | Archive/rebase prior ledger on opening-balance edit. high(money). |
| MoneyCore:23–25 unknown currency falls back to ×1 silently | **VALID** | MoneyCore.swift:23–25 `amount * (table[currency] ?? 1)`. | Warn/refuse on unknown code. FXService prunes/maintains rates well, but `toBase` is the last-mile silent hole. |
| FXService:53–68 if USD fails, stablecoins peg to 0 | **ALREADY-DONE** | FXService.swift:67–68 `let usdRate = … ; if usdRate > 0 { for code in pegged … }`; rate update at 74 also `guard r > 0`. | The 0-peg cannot happen. Verify only. |
| Recurring:45–58 weekly/yearly `nextDue` ignore anchors | **VALID** | Recurring.swift:55 `weekly: today+7`, :56 `yearly: today+1yr` — no `dayOfMonth`/anchor respected (only monthly honors anchor). ROADMAP Phase 0 #2 (open). | high(money) on forecasts. |
| Recurring:65 monthly expected uses hardcoded 30 | **VALID** | Recurring.swift:66 `monthly: Double(days)/30`. | Use actual days in month. Low risk. |
| Signals:14 once-per-day gate blocks recompute on focus/mutation | **VALID** | Signals.swift:13–14 day-gate via `Brain.cached(... "signals_sweep")`. | Drop the gate; recompute on focus + mutation (idempotent, dedup already exists). |
| `Client.memoryJSON` (Models:118) is dead | **VALID** | Models.swift:118 declares `var memoryJSON: String?`; **zero** reads/writes in Features/Sync/Money. | Field is dormant. Removing it is a SwiftData schema change (data-risk) — prefer leaving dormant or migrate carefully. (NEEDS-DECISION, see C-7.) |
| `Entity.importantDate`/`importantDateLabel` "never written" | **WRONG-PREMISE (read side)** | Entities.swift:39–40 declared; **read** in AgendaView.swift:88–91 (birthday agenda). But there is **no write path** (no picker in EditEntitySheet). | So: wired for *display*, not for *input*. Add the date picker (VALID) — do NOT remove (it's used). |
| `gemini.key` stored plaintext | **VALID, NEEDS-DECISION** | Keychain.swift:5–22 `KeyStore` = plaintext file in Application Support; AIProvider.swift:155 comment "local file — no keychain prompt" (intentional, ad-hoc-signed build). A real `Keychain` wrapper exists (Keychain.swift:29+) used for Supabase tokens. | Moving to Keychain reintroduces a prompt on a locally-built app. Decision needed (C-6). |
| `.preferredColorScheme(.dark)` hardcoded in FreelaneApp, DashboardView, MenuBar | **VALID (partial WRONG)** | Present in FreelaneApp.swift:48, MenuBar.swift:72, and the sheet scaffold/many sheets (FormComponents.swift:21/76, 12 sheet sites). **NOT** in DashboardView (no match). | Guard behind a setting if light mode is in scope (C-8). The DashboardView citation is wrong. |
| `LoansView` doesn't exist — build it | **WRONG-PREMISE** | `LoansView` exists in LifeViews.swift; routed in RootView.swift:17/211-ish; `Loan` model (Life.swift), `LoanEngine` (Money/LoanEngine.swift). | It EXISTS. Re-scope to "audit LoansView for the spec's sub-features (Lent/Borrowed tabs, amortization, forgive→sadaka, post-as-Payment, partial)" — some may be missing. Verify, then fill gaps. |
| Wallets should be promoted to sidebar | **ALREADY-DONE** | RootView.swift:17 `case … wallets …`, :211 `case .wallets: WalletsView()`. (A stale comment at :239 says "Wallets live inside Payments now" and filters it out of one nav list.) | It's already a `Feature`. Reconcile the contradictory nav filtering (RootView.swift:240) — small. |
| ReceiptOCR wired to AddSpendSheet (ROADMAP says shipped) | **VALID (roadmap is wrong)** | No `ReceiptOCR`, `VNRecognizeText`, `Vision`, or `receiptPath` anywhere in the tree. | Net-new. Also `InvoiceService`/`InvoiceDoc`/`InvoiceSheet` (ROADMAP 7b) **do not exist** either — roadmap Phase 7b overstates what shipped. |
| Brain JSON parsed by regex (162–172) → use Codable + schema | **VALID** | Brain.swift:354–370 `jsonString`/`jsonNumber` use `range(of:)` string scanning, not `JSONDecoder`. | Real fragility. Move to Codable + Gemini JSON-schema response. |
| Brain.cached `.first` without `fetchLimit` (line 44) | **VALID (minor)** | Brain.swift:43–44 `FetchDescriptor … (try? context.fetch(d))?.first`. | Add `fetchLimit:1`. Trivial perf. |
| Curiosity `.prefix(250)` arbitrary (line ~69) | **VALID** | Curiosity.swift candidateEntities scans all spends then trims. | Bound the fetch. |
| Apple FoundationModels local fallback exists | **WRONG-PREMISE** | AIProvider.swift:130–133 `LocalModelProvider` is a placeholder that **throws** `.notConfigured`; comment 129 "Not active". | FoundationModels integration is fully net-new (P3). |
| Fraunces serif for display titles | **NEEDS-DECISION** | Typography.swift:8–9 already uses `design: .serif` → **New York** (system serif), with "Fraunces-like" tracking (comment :20). | New York already gives an editorial serif with zero bundling. Fraunces requires bundling a font file + license. Decide if the upgrade is worth it (C-9). |
| ~10 coexisting corner radii; enforce `Radii` enum | **VALID** | ≥15 distinct literals across the tree (12×18, plus 22,18,9,16,14,13,20,6,2,11,10,99,8,24). No `Radii` enum. | Real inconsistency. Introduce enum, migrate call sites. |
| Soft-delete / Trash / restore-from-backup UI | **VALID (net-new)** | No `deletedAt`/`softDelete`/`Trash`/`ChangeRecord` anywhere. `DataBackup` (Sync/DataBackup.swift) writes backups but has **no restore UI** (only `reveal()` opens Finder). | All net-new; high-leverage and data-safety-aligned. |

---

## C. Decisions Needed From the User (these block work)

1. **AI provider strategy.** Spec wants three things at once: keep Gemini, add Apple **FoundationModels** on-device first (intent/JSON/classification), and a "Claude/local" picker. Pick the primary: (a) Gemini-only, hardened; (b) FoundationModels-first with Gemini fallback (privacy + cost win, but macOS 26 device-gated and lower quality); (c) add Claude. This sets the whole P3 architecture. *Recommendation: (b) — on-device for classification/extraction, Gemini for reasoning.*
2. **iCloud sync + Touch ID app-lock + "whole app unlocks only with fingerprint + iCloud-linked."** This contradicts the current **local-first, no-cloud** stance and the data-safety posture. Do we (a) stay fully local + optional Touch ID lock only, (b) add iCloud (CloudKit) sync, (c) defer both? *Recommendation: (a) now; (b) is a major P-X effort.*
3. **Quran in-app reading format.** PDF page images vs. structured text (Surah→Ayah JSON, e.g. Tanzil/Quran.com data) vs. link-out. Structured text enables the tracker + daily-ayah card cleanly; PDF is heavy and unsearchable. *Recommendation: bundled structured text (public-domain Uthmani + a translation).*
4. **Remove dormant `@Model`s (Plan/Habit/HabitEntry) and dead fields (`Client.memoryJSON`)?** Removing them is a SwiftData schema change against a live store the user has lost data from before. *Recommendation: leave dormant; do NOT migrate purely for tidiness. Only `memoryJSON` could be dropped if we accept a versioned migration with a verified backup first.*
5. **GlassCardModifier strategy.** The current frost is a deliberate workaround for the real `.glassEffect` morph/flow bug. Options: (a) keep frost, just tune tints (safe, recommended for breadth surfaces); (b) re-adopt real `.glassEffect` on ~5 hero surfaces only and accept/solve the morph behavior; (c) full switch (risky). *Recommendation: (a)+(b) — flat frost everywhere, real glass on a handful of hero tiles.*
6. **`gemini.key` → Keychain?** Keychain adds a permission prompt on every locally-built run (why it was avoided). Options: (a) keep file but encrypt-at-rest, (b) Keychain with a stable signing identity, (c) leave as-is. *Recommendation: (b) once the app has a stable code-signing identity; otherwise (c).*
7. **Light mode scope.** Full light theme, or dark-only with a one-off "respect system" toggle? Full light mode means auditing every hand-tuned dark color (Palette) and every `.preferredColorScheme(.dark)` site (~14). *Recommendation: defer full light mode to P-X; ship the accent-picker + density toggle first.*
8. **AI proactive-nudge aggressiveness + quiet hours.** How pushy should unprompted insights/notifications be (Sunday card, Monday briefing, anomaly whispers)? Define default cadence + quiet-hours window before building the cron.
9. **Fraunces vs New York serif.** Bundle Fraunces (license + file) or keep system New York? *Recommendation: keep New York unless you have a specific Fraunces look in mind.*
10. **Capture hotkey vs sandbox.** Global hotkey + screenshot-OCR chip need Accessibility/Screen-Recording TCC and likely disabling App Sandbox. Confirm we may drop the sandbox for these (affects future notarization/distribution). *Recommendation: menu-bar NL capture (no extra entitlement) first; global hotkey only if you accept the entitlement cost.*

---

## D. The Phased Plan

Risk legend: `low` · `med` · `high(data)` (schema/migration/store) · `high(money)` (money math).
Verify legend: `compile` · `code-review` · `needs-user-eyes` · `needs-runtime` (permissions/LLM/EventKit).

---

### Phase 0 — Stop the bleeding: money correctness + data-safety substrate (do FIRST)

| ID | Title | Target file(s) | Risk | Verify | Deps | Class |
|---|---|---|---|---|---|---|
| P0-T01 | Recurring weekly/yearly `nextDue` respect anchors (dayOfWeek / month+day) | Models/Recurring.swift:55–56 | high(money) | code-review | — | VALID |
| P0-T02 | Monthly `expectedBase` uses actual days-in-month not `/30` | Models/Recurring.swift:66 | med | code-review | — | VALID |
| P0-T03 | `Rates.toBase` warns/refuses on unknown currency instead of ×1 | Money/MoneyCore.swift:23–25 (+ callers) | high(money) | code-review | — | VALID |
| P0-T04 | Surface PaymentEngine rounding remainder as an audit line | Money/PaymentEngine.swift:186 (+ UI) | low | compile | — | VALID |
| P0-T05 | EditPayment: validate net ≤ gross, non-blank; inline red error | Features/EditSheets.swift:14/26/51 | med | code-review | — | VALID |
| P0-T06 | EditWallet opening-balance change archives/rebases prior ledger | Features/WalletsView.swift:216–217; Money/Metrics.swift | high(money) | code-review | — | VALID |
| P0-T07 | Add `deletedAt: Date?` to every user model (additive, no destructive migration) | Models/*.swift; Models.swift schema list:400–414 | high(data) | compile | — | VALID (net-new) |
| P0-T08 | Filter all `@Query`/fetch sites to exclude `deletedAt != nil` | all Features/*.swift, engines | high(data) | code-review | P0-T07 | VALID |
| P0-T09 | Signals: drop once-per-day gate; recompute on focus + mutation (dedup already exists) | Sync/Signals.swift:13–14 | low | code-review | — | VALID |
| P0-T10 | `fetchLimit:1` on all `.first` fetches; bound Curiosity scan | Sync/Brain.swift:44; Sync/Curiosity.swift:69; Brain:518 | low | code-review | — | VALID |
| P0-T11 | Move `gemini.key` off plaintext file (per C-6 decision) | Sync/Keychain.swift:5–22; AIProvider.swift:143/155 | med | needs-runtime | C-6 | VALID/DECISION |
| P0-T12 | Verify-only: confirm `updatePaymentDetails` re-spread + FX 0-peg guard still hold (regression test) | PaymentEngine:287–307; FXService:67–68 | low | code-review | — | ALREADY-DONE |
| P0-T13 | Reconcile contradictory Wallets nav filtering (sidebar vs "lives in Payments") | Features/RootView.swift:17/211/240 | low | compile | — | ALREADY-DONE |

---

### Phase 1 — Data-safety UX: Undo, Trash, Restore (the user's #1 fear)

| ID | Title | Target file(s) | Risk | Verify | Deps | Class |
|---|---|---|---|---|---|---|
| P1-T01 | 10s Undo toast component, queued per destructive action | DesignSystem/ (new), RootView | low | needs-user-eyes | — | VALID |
| P1-T02 | Route every delete through soft-delete (`deletedAt = .now`) + Undo | all delete sites | high(data) | code-review | P0-T07/T08 | VALID |
| P1-T03 | 30-day Trash view (list, restore, permanent-delete, auto-purge sweep) | Features/ (new) | high(data) | code-review | P1-T02 | VALID |
| P1-T04 | Restore-from-backup sheet over existing `DataBackup` (list w/ timestamps + preview) | Sync/DataBackup.swift (add restore), Features/SettingsView.swift | high(data) | needs-runtime | — | VALID (net-new) |
| P1-T05 | `ChangeRecord` audit-log model + write on every mutation | Models/ (new), engines | high(data) | code-review | P0-T07 | VALID (net-new) |
| P1-T06 | Standard empty-state pattern component, applied app-wide (only PeopleView has one) | DesignSystem/ (new) + all lists | low | needs-user-eyes | — | VALID |

---

### Phase 2 — Frictionless capture (sub-second logging)

| ID | Title | Target file(s) | Risk | Verify | Deps | Class |
|---|---|---|---|---|---|---|
| P2-T01 | Menu-bar single-line NL capture parsed via `understandSpend` ("450 jollibee") | Features/MenuBar.swift; Sync/Brain.swift | med | needs-runtime | — | VALID |
| P2-T02 | Menu-bar: log payment too, wallet/category defaults from last, "last 5 captures" row, tab-between-fields, widen 300→380 | Features/MenuBar.swift | low | needs-user-eyes | P2-T01 | VALID |
| P2-T03 | "Log spend" Siri Shortcut donated with last vendor/category defaults | Sync/Intents.swift | med | needs-runtime | — | VALID |
| P2-T04 | Reminders interception ("remind me to log my haircut" → spend chip) | Sync/Integrations.swift | med | needs-runtime | — | VALID |
| P2-T05 | ReceiptOCR (Vision) — build it and wire into AddSpend (ROADMAP wrongly says shipped) | Features/SpendingView.swift; new Sync/ReceiptOCR.swift | med | needs-runtime | — | VALID (net-new) |
| P2-T06 | Global hotkey single-line capture bar (per C-10 entitlement decision) | new | high(data)=no; med | needs-runtime | C-10 | VALID |
| P2-T07 | Widget interactive: tap → tiny capture sheet; force-refresh on mutation | FreelaneWidget/; Sync/WidgetBridge.swift | med | needs-runtime | — | VALID |

---

### Phase 3 — AI architecture substrate (everything smart depends on this)

| ID | Title | Target file(s) | Risk | Verify | Deps | Class |
|---|---|---|---|---|---|---|
| P3-T01 | `AITool` protocol + tool-call loop (searchSpends/getWalletBalance/runProjection/categorizeVendor) | Sync/Brain.swift, new Sync/AITools.swift | med | needs-runtime | C-1 | VALID (net-new) |
| P3-T02 | Replace regex JSON parsing with Codable + Gemini JSON-schema-locked output | Sync/Brain.swift:354–370 | med | code-review | — | VALID |
| P3-T03 | Apple FoundationModels provider (replace dead `LocalModelProvider`) for intent/JSON/classification (per C-1) | Sync/AIProvider.swift:130–133 | med | needs-runtime | C-1 | VALID (net-new) |
| P3-T04 | Confidence routing: high→silent commit, med→inbox preview, low→batched Maintenance ask | Sync/Brain.swift, Sync/Curiosity.swift | med | needs-runtime | P3-T01 | VALID |
| P3-T05 | Slim sampled context (last 50 spends, top 5 vendors/clients, wallets, month aggregates) — stop sending full ledger | Money/StateSnapshot.swift | med | code-review | — | VALID |
| P3-T06 | Pre-prompt redaction (psychiatrist/therapy/doctor → `<sensitive>`, toggle per category) | Money/StateSnapshot.swift, Brain | low | code-review | P3-T05 | VALID |
| P3-T07 | StateSnapshot fingerprint cache (diff-hash, 10-min TTL) + understandSpend cache by hash(text+amount+ccy) | Money/StateSnapshot.swift; Sync/Brain.swift | low | code-review | P3-T05 | VALID |
| P3-T08 | Curiosity: cap 1 retry/fact; Filipino/Spanish vague detection; stop capitalized-token leaks | Sync/Curiosity.swift | low | needs-runtime | — | VALID |
| P3-T09 | Conversational memory (5-turn ring buffer) + streaming responses | Features/AIAssistant.swift; Sync/Brain.swift | med | needs-runtime | P3-T01 | VALID |
| P3-T10 | Token/cost meter in Settings (tokens by feature this week) | Features/SettingsView.swift; Brain | low | code-review | — | VALID |
| P3-T11 | On-device vector index (CoreML embeddings per spend/letter/note → cosine search as a tool) | new Sync/VectorIndex.swift | med | needs-runtime | P3-T01 | VALID (net-new, large) |
| P3-T12 | Learning loop: recategorize → few-shot example injected next prompt | Sync/Brain.swift | med | needs-runtime | P3-T02 | VALID |

---

### Phase 4 — Design-system substrate (unblocks all later visual work)

| ID | Title | Target file(s) | Risk | Verify | Deps | Class |
|---|---|---|---|---|---|---|
| P4-T01 | `Radii` enum; migrate ~15 scattered corner radii | DesignSystem/Theme.swift + all call sites | low | compile | — | VALID |
| P4-T02 | GlassCard strategy per C-5: flat frost on breadth surfaces, real `.glassEffect` on ~5 hero tiles; tints 6–8% | DesignSystem/Theme.swift:116–163 | med | needs-user-eyes | C-5 | VALID/DECISION |
| P4-T03 | `DestructiveButtonStyle` convenience (NOT GlassButtonStyle — those are OS-26 system styles) | DesignSystem/FormComponents.swift | low | compile | — | VALID (scoped down from WRONG-PREMISE) |
| P4-T04 | Field bg opacity .05→.10–.12 + 1.5px teal focus ring + inline red error text | DesignSystem/FormComponents.swift | low | needs-user-eyes | — | VALID |
| P4-T05 | `.preferredColorScheme(.dark)` guarded behind a setting (per C-7 / C-8) | FreelaneApp:48; MenuBar:72; FormComponents:21/76; ~10 sheets | med | needs-user-eyes | C-8 | VALID (Dashboard citation was wrong) |
| P4-T06 | Right-click context menus on every row; tooltips w/ shortcut on toolbar buttons | all list views | low | needs-user-eyes | — | VALID |
| P4-T07 | Drag-to-reorder for tiles/wallets/projects (Dashboard tile reorder is net-new) | DashboardView, WalletsView, ProjectsView | med | needs-runtime | — | VALID |
| P4-T08 | Accessibility: VoiceOver labels on icon buttons; textTertiary #737577→~#909295 (AA); focus rings; dynamic type | Theme.swift:25; all icon buttons | low | needs-runtime | — | VALID |
| P4-T09 | Skeleton loaders + shimmer; chart draw-in; button loading spinners; spring-curve set | DesignSystem/ | low | needs-user-eyes | — | VALID |

---

### Phase 5 — Faith (the area with the most genuine net-new scope)

| ID | Title | Target file(s) | Risk | Verify | Deps | Class |
|---|---|---|---|---|---|---|
| P5-T01 | Sunnah/Tahajjud/Witr/Duha tracking (extend PrayerLog) | Models/Life.swift; Features/LifeViews.swift; Sync/FaithService.swift | med | code-review | P0-T07 | VALID |
| P5-T02 | Qadā tracking (missed prayers/fasts) + Qibla live CoreLocation compass | LifeViews, FaithService | med | needs-runtime | — | VALID |
| P5-T03 | Quran reading tracker (Surah→Ayah) + in-app reader (per C-3 format) | new Models + view + bundled content | high(data)=no; med | needs-user-eyes | C-3 | VALID (large) |
| P5-T04 | Daily ayah+hadith card on Today; Tasbih counter | TodayView; new | low | needs-user-eyes | C-3 | VALID |
| P5-T05 | Per-prayer notification customization (athan audio Fajr only); congregation flag+location; Hijri date everywhere; method picker shows names | FaithService; NotificationManager | med | needs-runtime | — | VALID |
| P5-T06 | Ramadan: Iftar/Suhoor live countdown; last-10-nights card | LifeViews, FaithService | low | needs-user-eyes | — | VALID |

---

### Phase 6 — Money depth: Payments, Wallets, Projects, Spending, Loans

| ID | Title | Target file(s) | Risk | Verify | Deps | Class |
|---|---|---|---|---|---|---|
| P6-T01 | Audit LoansView for spec gaps (Lent/Borrowed tabs, amortization, forgive→sadaka, post-as-Payment, partial, overdue badge) and fill missing | Features/LifeViews.swift; Money/LoanEngine.swift | med | code-review | — | re-scoped (view EXISTS) |
| P6-T02 | Multi-hop chain story (3 hops, per-step fee, per-route effective fees) — PaymentStep already exists | Models/Models.swift:262; PaymentsView; PaymentEngine | high(money) | code-review | — | VALID |
| P6-T03 | Fee leaderboard page (ranked by effective fee % over time) | Features/StatsView.swift or PaymentsView | low | code-review | P6-T02 | VALID |
| P6-T04 | Multi-currency wallets (per-currency balances); reconcile button (actual→balancing entry); paginate ledger; wire `monthlyFeeBase` auto-deduct | WalletsView; Models.swift:188+; Metrics | high(money) | code-review | P0-T06 | VALID |
| P6-T05 | Projects: milestones/phases; refuse drag-to-Paid w/o payment → pre-filled payment sheet; render `flaggedOverdue`; per-client color; cache `outstandingNative`; Kanban swim lanes by client | ProjectsView; ProjectMath | med | needs-user-eyes | — | VALID |
| P6-T06 | Spending: tag normalization fuzzy-match; recurring next-due shows real date; heatmap 8→10pt + tooltip; splits (record-only) | SpendingView; SpendEngine | low | code-review | P0-T01 | VALID |
| P6-T07 | Agenda: cash-flow waterfall line (60d, mark lowest); quick-Pay inline `payRecurring`; per-calendar coloring; horizon setting 45/90/180; snooze | AgendaView; Recurring | med | needs-user-eyes | P0-T01 | VALID |
| P6-T08 | Dashboard: deltas not absolutes; clickable+draggable tiles; per-tile AI rationale; unify spark timescales; "what changed" strip; overdue tile in warning color; Life vs financial clusters | DashboardView | med | needs-user-eyes | P4-T07 | VALID |
| P6-T09 | Today: logging streak; time-of-day "left for tonight"; reminder check+fade; "yesterday's win"; inline next-prayer mark; bigger activity ribbon w/ higher-quality vendor logos + AI-assigned logo for vague names | TodayView | med | needs-user-eyes | — | VALID |

---

### Phase 7 — People, Clients, Vendors, Sadaka

| ID | Title | Target file(s) | Risk | Verify | Deps | Class |
|---|---|---|---|---|---|---|
| P7-T01 | People: add date picker for `importantDate` (it's READ in AgendaView:88 but never written); photo drag-drop; family-tree linking; money-flow regex word-boundary + ≥2 spend-hits | PeopleView; EditEntitySheet; Entities.swift:39 | med | code-review | — | VALID (don't remove field) |
| P7-T02 | Clients: per-client timeline (payments+notes+signals); timezone field + "12:47am there"; debounce notes (saves per keystroke now); editable nudge tone; retainer flag+balance | ClientsView | med | code-review | — | VALID |
| P7-T03 | Clients: remove dead `memoryJSON` (per C-4 — only if versioned migration + verified backup) | Models.swift:118 | high(data) | code-review | C-4 | VALID/DECISION |
| P7-T04 | Vendors: editable + merge (Jollibee/JolliBee); category per vendor; monthly baseline+variance alert; "stop using" flag→"things I've quit" page; "needs identifying" card | VendorsView; VendorBrand | med | code-review | — | VALID |
| P7-T05 | Sadaka: Zakat tab (nisab×hawl + zakatable-asset calc); recipient categories; "why I gave"; anonymous-vs-named; Ramadan last-10-nights card | SadakaView; Money/Sadaka.swift | med | code-review | — | VALID |

---

### Phase 8 — Body, Letters/Journal, Stats, Activity, Notifications

| ID | Title | Target file(s) | Risk | Verify | Deps | Class |
|---|---|---|---|---|---|---|
| P8-T01 | Body: sleep stepper (free-text→numeric); label 1–5 scale; add water+workout+weight; stacked weekly trends (mood/energy/sleep/spending/prayer); daily check-in nudge | LifeViews; Models/Life.swift | med | needs-user-eyes | P0-T07 | VALID |
| P8-T02 | Letters → Apple-Journal-style journal (no title, newest-first, timestamps, edit/delete, works without AI, own streak, daily prompt, pin/reorder) | LifeViews | med | needs-user-eyes | — | VALID |
| P8-T03 | Letters AI: chunk-in on finish to build user memory; sentiment+3 themes; "what would future-you say"; AI memory folder | LifeViews; Sync/Brain.swift | med | needs-runtime | P3-T01 | VALID |
| P8-T04 | Stats: YoY panel; payment latency per client; top-fee routes; hours-per-peso; mood-correlation panel; click bar→drill | StatsView | med | code-review | — | VALID |
| P8-T05 | Activity: search/date/amount/vendor/category filters + bulk select; full audit log view; restore-from-trash; inline edit | ActivityView | med | code-review | P1-T05 | VALID |
| P8-T06 | Notifications: snooze (tomorrow/next-week/at-desk); per-category mute; banner action buttons (Pay/Snooze/Open); read/unread accent; timestamps | NotificationsUI; NotificationManager | med | needs-runtime | P0-T09 | VALID |

---

### Phase 9 — Command palette, Search, Settings, AI proactivity

| ID | Title | Target file(s) | Risk | Verify | Deps | Class |
|---|---|---|---|---|---|---|
| P9-T01 | Command palette ↑↓ nav + ⏎ act (currently runs first hit only); recent/pinned; search descriptions+notes; AI mode in ⌘K; single full-screen palette | CommandPalette; SearchPalette | med | needs-runtime | — | VALID |
| P9-T02 | Settings: expand currency list beyond 6 hardcoded; configurable notification times; snooze/DND hours; density toggle; accent picker; optional light mode (per C-7) | SettingsView; MoneyCore symbols | low | needs-user-eyes | C-7 | VALID |
| P9-T03 | Proactive AI: Sunday insight card + Monday anomaly briefing (cron + prompts, quiet hours per C-8) | new Sync/ + Brain | med | needs-runtime | P3-T01, C-8 | VALID |
| P9-T04 | Anomaly whisper as Activity row; "explain this number" long-press; weekly+monthly AI review page | ActivityView; StatsView; Sync/WeeklyReview.swift | med | needs-runtime | P3-T01 | VALID |
| P9-T05 | More App Intents (LogPayment/GiveSadaka/MarkPrayer/MarkFast/QueryRunway/QueryProject) + two-way Calendar/Reminders push | Sync/Intents.swift; Integrations.swift | med | needs-runtime | — | VALID |

---

### Phase 10 — Polish & motion (needs-user-eyes; after structure is right)

| ID | Title | Target file(s) | Risk | Verify | Deps | Class |
|---|---|---|---|---|---|---|
| P10-T01 | Hover-scrub charts w/ crosshair+tooltip; sparkline morph; chart annotation overlays | StatsView, charts | low | needs-user-eyes | — | VALID |
| P10-T02 | Confetti/haptic on milestones (loan paid, streak); custom cursors on draggables; ⌘? hotkey HUD | various | low | needs-user-eyes | — | VALID |
| P10-T03 | Wallet card-stack (Apple Wallet shape); configurable card density (64/88/116) | WalletsView; density setting | low | needs-user-eyes | P9-T02 | VALID |
| P10-T04 | Tune mesh tints / glass opacity from screenshots (iterative) | Theme.swift | low | needs-user-eyes | P4-T02 | VALID |

---

### Phase 11 — QA, accessibility, end-to-end validation (final gate)

| ID | Title | Target file(s) | Risk | Verify | Deps | Class |
|---|---|---|---|---|---|---|
| P11-T01 | Full money-math audit (re-run after P0/P6) | engines | high(money) | code-review | P0,P6 | VALID |
| P11-T02 | Reduce-motion + dynamic-type + keyboard-only nav pass | app-wide | low | needs-runtime | P4-T08 | VALID |
| P11-T03 | Runtime validation: AI parsing, vendor logos, prayer notifications, EventKit/Contacts TCC, OCR, backups/restore | app-wide | high(data) | needs-runtime | most phases | VALID (ROADMAP's standing gap) |

---

### Phase X — Ambitious / Optional (quarantined; must NOT block core)

These are the "competitor patterns", "net-new features", and "AI playbook deeper" sections. Each is large
and/or speculative. Sequence only after Phases 0–9 land. Grouped, not individually ID'd, to avoid false precision.

- **PX-A Transaction inbox + rules engine** (Copilot/Lunch Money): approval queue (↵ accept / c recategorize / r make-rule), categorization rules engine, Reviewed checkmark, AI-suggested rules. *(large, depends P3)*
- **PX-B Money Watchtower page** (1Password-style): unused subs, expiring trials, fees above baseline, stale FX, overdue backup, prayer-streak slipping, wallet below buffer. *(med, depends Signals P0-T09)*
- **PX-C Forecasting & analysis**: net-worth waterfall by month (Monarch), Trends overlays, age-of-money (YNAB), forecast confidence bands P10/P50/P90, project burndown w/ hours, income heatmap. *(large)*
- **PX-D Decision tools**: cost-of-thing calculator, big-purchase 24h cooling debate, wishlist regret timer, salary-smoothing sim, buffer earmark rule, vendor comparison, currency-converter HUD ⌘⌥C, quitting tracker w/ projected savings. *(med, mostly self-contained)*
- **PX-E Knowledge/entity layer** (Reflect/Tana/Notion): inline @mentions linking entities, backlinks panel per entity, multi-view Table/Board/Calendar/Timeline/Gallery toggle, saved views/live queries, smart placeholders `{{wallet.gcash.balance}}`, templates. *(very large — a second product)*
- **PX-F OS-grade integrations**: CoreSpotlight indexing, Live Activities (next prayer), dynamic menu-bar title (NSStatusItem bitmap), Finder Quick Actions (CSV import), drag PDF onto Project card, window-state restoration, Spotlight/Shortcuts plugin, AppleScript. *(med-large, several need entitlement decisions)*
- **PX-G AI playbook deeper**: AI personas (Coach/Auditor/Therapist/Mentor/Imam), AI data-viz ("chart of fees by client" → inline Swift Chart), duplicate-merge suggestions, vendor enrichment, invoice draft from allocations, fee-route optimizer, translation, persistent per-persona chat threads, Arabic dua suggestion, gratitude reflector, replay scrubber. *(very large, depends P3 tool architecture)*
- **PX-H Privacy/distribution**: per-entity Touch ID lock, streamer mode ⌥⌘P (blur amounts), iCloud sync, CSV/OFX import, Splitwise-style IOU graph, Spotify-Wrapped annual review. *(large, several blocked on C-2)*
- **PX-I Invoices (PDF)**: ROADMAP claims shipped but `InvoiceService`/`InvoiceDoc`/`InvoiceSheet` do NOT exist — genuinely net-new if wanted. *(med)*

---

## E. Suggested Execution Order (multi-session)

1. **Session 1–2 — Phase 0.** Money correctness + add `deletedAt` additively. Nothing else until the store is provably safe and the math is right. Compile + regression-check after every schema touch; verified backup before any field removal.
2. **Session 3 — Phase 1.** Undo/Trash/Restore-from-backup/audit-log. Directly retires the user's data-loss fear; everything destructive afterward is reversible.
3. **Session 4 — Phase 2.** Capture friction (menu-bar NL, OCR, Siri). High daily-use payoff, low schema risk.
4. **Sessions 5–6 — Phase 3.** AI architecture substrate (needs decision C-1 first). Do NOT build smart features before the tool/sample/cache/redaction substrate exists.
5. **Session 7 — Phase 4.** Design-system substrate (needs C-5, C-8). Unblocks all later visual work; mechanical and safe.
6. **Sessions 8–12 — Phases 5–9.** Feature breadth, area by area, in any order the user prioritizes (Faith → Money depth → People/Sadaka → Body/Journal/Stats → Palette/Settings/Proactive AI). Each phase is independently shippable.
7. **Sessions 13+ — Phases 10–11.** Visual polish (screenshot-driven, needs the user's eyes) and the final QA/accessibility/runtime-validation gate.
8. **Later / opt-in — Phase X.** Pick individual PX items as appetite allows. Treat PX-E and PX-G as potential "v2" efforts, not commitments.

**Blocking dependencies to resolve before coding:** C-1 (AI provider) blocks all of P3 and most of P9/PX-G. C-3 (Quran format) blocks P5-T03/04. C-5 (glass) blocks P4-T02 and P10-T04. C-8 (light mode / nudge cadence) blocks P4-T05, P9-T02, P9-T03. Everything in Phase 0 blocks Phases 1 and 6.
