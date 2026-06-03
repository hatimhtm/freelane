# Changelog

All notable changes to Freelane are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses calendar-versioned releases (`YYYY.MM.X` or semver-ish `1.x.y`).

This file is the single source of truth for the in-app "Updates" surface
(Settings -> Updates) AND for the macOS Swift companion's What's New menu.
The `/api/changelog.json` route serves a parsed JSON version of the same
content. Daily cron at 9 AM PHT polls
`https://raw.githubusercontent.com/hatimhtm/freelane/main/CHANGELOG.md`,
compares against the current build's top entry, and fires an
`app_update_available` notification when a new release lands.

## [Unreleased]

Nothing landed yet for the next cut.

## [1.0.0] - 2026-06-02

The first 1.0 cut. Seventeen design-locked workflows ship together.
Tiers 1 through 5 (the Phase 2 spine) land alongside the post-Today
workflow queue: Notifications, Chatbot, Sadaka, Dashboard, Payments,
Stats, Spendings, Plans, Clients, Vendors, Entities, Letters, Should-I-
Buy, Activity, Settings, Loans, and What's New.

### Added

- **Tier 1 - Foundation + harsh-period spine.** Calm Weather Mode reads
  the whole financial weather and writes one honest line. Pre-Commitment
  Runway Lock parks money for the MacBook before you can spend it. The
  Pre-Mortem on Big Plans walks the 90-day liquidity around every large
  planned spend. The 90-Day Cashflow Atlas charts where the next quarter
  actually goes. Investment vs Consumption tags the difference between
  things that pay back and things that just leave. Tight Mode Coach
  narrows the picture when the numbers do. The Forecast Storyteller
  writes next month's shape in your voice. Time-of-day on every spend.
  Universal notes on items, plans, and AI answers.
- **Tier 2 - Vendors + entities + harsh-period polish.** Vendors get
  canonical names, kinds, and brand glyphs. Entities (people you know)
  get tracked through spend notes and chat. Wife state, Islamic
  calendar, and PH cultural events feed the AI's context. PHT date
  helper + 0/negative wallet fixes.
- **Tier 3 - Editorial letters.** Sunday recaps, end-of-month wrap-ups,
  anniversaries, and quiet-receipt responses. Worth-saying quality gate
  decides whether the brain has anything new to say before generating a
  letter. Editorial typography (Fraunces) for the reading surface.
- **Tier 4 - Body + behavior.** Morning logs, wellbeing check-ins,
  cigarette translator on the spend modal, and the body/behavior set of
  Today cards.
- **Tier 5 - AI conversation surfaces.** Should-I-Buy as a standalone
  page, Tuesday Check-In on Today, Year-Memory Recall. (Should-I-Buy is
  later collapsed into the chatbot - see below.)
- **Notifications workflow.** Web Push with service worker + VAPID. The
  notifications inbox with Unread/Read split. Per-user retention
  defaults (3 days; readable rows only). Interactive multi-choice and
  resizable free-text modals.
- **Chatbot workflow.** Page-aware floating pill on every page. Pro for
  reasoning, Flash Lite for intent classification + answer narration.
  Bidirectional clarifying questions. Per-page persistent chat with
  end-of-session digests. Replaces Today's v1 floating AI.
- **Sadaka workflow.** Pool-ledger algorithm. AI-decided contribution
  rate anchored at the 2.5% zakat base. Four auto-detection mechanisms
  for income contributions. Four external surfaces. Migrations
  0054-0056.
- **Dashboard workflow.** LifeOS hub at `/`. Unified `money_ledger` +
  reconciliation pass (the big architectural change - every money flow
  is now linked). Sectioned widget layout (Money / Commitments / State /
  Body). Inline warning pills + per-card AI dot.
- **Payments workflow.** Wallets pull from `money_ledger`. Brand glyphs
  and colors. Withdrawal AI lives in the chatbot. Methods/withdrawals
  shrunk, history collapsed.
- **Stats workflow.** LifeOS stats view at `/stats/[scope]`. Triggered
  from chips on the dashboard top-right. Apple-widget sparse grid
  organized by Money / Behavior / Journey. About 17 stat widgets,
  including the Recent Letters card.
- **Spendings workflow.** Tag splitting bug fix (tags are labels, not
  amount allocations). Audience / Category / Custom tag kinds. Live
  Daily Safe everywhere with greyed initial. Vendor unknown -> immediate
  AI notification -> chat -> icon. GitHub-style trailing-1y heat map.
- **Plans workflow.** Plans facelift narrowed to big planned purchases
  only. Removed from Dashboard. AI price lookup (range + sources).
  Two-to-three ranked savings strategies user activates. Justification
  capture, decision support, and a plan archive.
- **Clients workflow.** Restyle + entity-scoped AI facts. Notes -> facts
  via Flash Lite on save (30s debounce). Pattern-change detection on
  payment method + project size shift fires
  `client_pattern_change`. Facts panel in detail sheet shows AI memory
  transparently.
- **Vendors workflow.** Vendors removed from top nav, lives as a sub-tab
  in Spending (Spends | Vendors). `createVendor` bug fix. Canonicalize-
  vendor brain always asks. Vendor + item price tracking. Weekly
  price-check brain (internal trend + external market reference).
  Backfill brain over existing vendors.
- **Entities workflow.** Entities removed from top nav, lives as the
  People sub-tab in Clients. `createEntity` bug fix. Two-gate consent
  (the AI never auto-adds; entity_discovery_request asks first, then
  canonicalize-entity asks again). All four pattern detections.
  `beneficiary_entity` tracking ("buying for wife / friends"). All four
  new-element triggers.
- **Letters workflow.** Letters removed from top nav. Archive surfaces
  inside Stats view (Recent Letters card) and `/letters` paginated
  archive. Worth-saying quality-gate brain after each Tier 3 trigger.
  `new_letter` notification opens a center modal with Fraunces editorial
  typography.
- **Should-I-Buy workflow.** The `/should-i-buy` tab is deleted; the
  functionality moves into the chatbot. Intent-classifier (Flash Lite)
  routes the should-i-buy intent to the purchase-decision brain (Pro);
  chat-answer narrates conversationally. Existing conversations
  migrated to `chat_messages`.
- **Activity workflow.** Activity tab stays in the top nav. Virtual feed
  (no migration) unioning every user-action source. Default user-only
  with "Show AI activity" toggle off by default. Per-day collapsible
  groups (today expanded). Category-pinned primary filters + secondary
  dropdown + calendar popover day-selector. Every row clickable -> the
  source detail.
- **Settings workflow.** LifeOS control center with twelve subtabs
  (Profile / Wallets / Cycles / Body & Wellbeing / Faith / Tags / AI /
  Notifications / Privacy & Data / Updates / Advanced / About). Faith
  subtab (prayer times, qibla, Hijri, Ramadan). Habits in Body &
  Wellbeing. Per-subject AI facts viewer (edit/delete). Extended brand
  picker + custom fallback for add-wallet. Cmd+K search settings.
- **Loans workflow.** Both directions (given and received). Partial
  returns supported. Return wallet can differ from origin. Inline in the
  Spending list with badge + Loans filter chip. AI auto-detect ("was
  this a loan?") fires `loan_proposal`. Sadaka conversion on forgive
  writes a sadaka_ledger payment. Per-entity loan history section in
  entity detail. Three notification kinds (`loan_due_soon`,
  `loan_overdue`, `loan_proposal`).
- **What's New workflow.** This very file. Markdown CHANGELOG in the
  repo replaces the SQL `finance.app_changelog` table. `Settings ->
  Updates` renders the parsed entries. A daily cron at 9 AM PHT
  poll-checks the GitHub raw URL and fires `app_update_available`. The
  `/changelog` route redirects to `Settings -> Updates`. Migrations
  0104-0105.

### Changed

- Pack rhythm widget, wallet runway widget, and income strip on the
  dashboard. Widget L/M/S sizes with whole-card-click semantics.
- Polish Pass 1: Today regrouped. Nav grouping across sidebar, mobile,
  and Cmd+K. Tier 5 client-detail surfaces wired (QuietChannel +
  RateInsights).

### Fixed

- Wallet anchor honours timestamp precision + strict date fallback (the
  GCash bug).
- Typing 0 in a wallet saves 0 - explicit value beats initial-state
  equality.
- Wallet balances form is write-only - clears on save and on every load.
- Settings: typing a new wallet amount auto-anchors to today.

### Removed

- `What's New` entry from the top nav. The content moved to `Settings ->
  Updates`.
- `Should I Buy` page from the top nav and `/should-i-buy` route. The
  workflow now lives in the chatbot via intent classification.
- `Letters`, `Vendors`, and `Entities` from the top nav. Each surfaces
  in its parent (`/letters`, `/spending/vendors`, `/clients/people`)
  with redirects from the old paths.

## [0.1.0] - 2026-05-22

### Added

- **Phase 1 spine.** The first habitable build. Migrations 0001-0023
  applied. Today, Dashboard, Payments, Spending, Plans, Settings,
  Notifications. Holding wallets + withdrawals model. Sidebar +
  command palette. Initial AI brains (calm weather, safe-to-spend).
