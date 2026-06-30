# Freelane Web App — Complete Architecture Reference

> A full read-through of the web app (`/src`, `/supabase`), captured to guide the native macOS rebuild.
> The web app is the source of truth for *behavior and data model*. Per design direction, the native
> app should **not** copy the web UI — it reimplements these systems with an Apple-grade Liquid Glass surface.

---

## 0. What Freelane actually is

A **single-user, private** personal-finance + life-OS for one freelancer (Hatim, San Pablo, Philippines)
who invoices clients abroad (CNY/USD/EUR…) and settles into **pesos (PHP, the base currency)**. The core
insight: what matters isn't what you billed, it's the **net pesos that land** after every transfer fee and
FX cut. It has grown far past payments into spending, plans, charity (sadaka), faith, habits, wellbeing,
and a pervasive Gemini AI layer.

- **Stack (web):** Next.js 16 (App Router, RSC, server actions), React 19, TypeScript, Tailwind v4,
  `motion`, `@number-flow/react`, recharts, `@base-ui/react` (Base UI, not Radix), Supabase (Postgres
  `finance` schema + Auth + RLS), `@google/genai` (Gemini 3 Pro + 2.5 Flash-Lite). Hosted on Vercel,
  auto-deploys on push to `main`.
- **Auth:** one hidden Supabase user (`owner@freelane.local`); the only secret is the password. No signups.
- **Timezone:** everything is anchored to **PHT (Asia/Manila, UTC+8, no DST)** — "today", staleness,
  decay dedup, daily snapshots all use PHT day strings, never rolling 24h or the UTC server day.
- **Money invariant:** paid amounts are **frozen in PHP at the moment they land** (FX-locked). Only
  *unpaid* balances re-value with FX. Same rule for spends (`amount_base` locked at log time).

---

## 1. Data model (Postgres `finance` schema, 112 migrations)

RLS everywhere: every user-scoped table has `user_id → auth.users` + an `owner_all` policy
(`auth.uid() = user_id`). Child tables gate via `EXISTS` on the parent (`owner_via_*`). Reference tables
(`currencies`, `islamic_calendar`, `ph_cultural_events`, `wallet_platform_metadata`) are read-all.
Signup triggers seed defaults (notification_settings, sadaka_config/rules, audience + category tags).

### Income / invoicing core
- **`clients`** — identity, contact, billing, bank, `default_currency`, `accent_color`, `notes`,
  `memory_consolidated` jsonb (AI living doc: summary/facts/watch/preferences).
- **`projects`** (= jobs) — `client_id`, `title`, `amount`, `currency`, `status`
  (**unpaid / partially_paid / paid** + archived), `due_date`, `quoted_at`, `flagged_overdue*` (manual).
- **`payments`** — partial-payment log. FX-lock columns: `net_amount_base` (PHP that landed),
  `gross_at_market_base` (no-fee value at landing), `implied_fee_base` (= gross − net), `fx_locked`,
  `fee_unknown` (excludes from fee algorithm).
- **`payment_steps`** — the **chain**: ordered FROM→TO hops (`from_method_id`/`method_id`,
  `amount_in/out`, `currency_in/out`, `is_final`). Bank → exchange → wallet, each hop's fee captured.
- **`payment_methods`** — rails + **holding wallets** (`is_holding`). Opening balance + anchors
  (`opening_balance_base/amount/currency`, `opening_balance_at` date, `opening_balance_set_at` timestamp),
  `overdraft_tolerance_base` (display/alarm only), `monthly_fee_php/_currency`, `brand_key`,
  `custom_brand_glyph/_color`.
- **`payment_project_allocations`** — one payment → many projects (source of truth for status recompute).
- **`withdrawals`** — money out of holding wallets (`from/to_method_id`, `gross/net/fee_base`).
- **`invoices`** + `invoice_projects` — full invoice records (issuer/client snapshots, line items).
- **`exchange_rates`** (`rate_to_base`), **`settings`** (issuer profile, base_currency, `last_seen_version`).

### Money ledger (the load-bearing balance model, migs 0067–0070)
- **`money_ledger`** — unified **append-only signed log**. `kind ∈ income/outflow/transfer/fee/
  sadaka_payment/project_receipt/unaccounted_outflow/adjustment`, `amount_base` signed (+in/−out),
  `wallet_id`, `related_kind`/`related_id` (one live row per source mutation, soft-delete `archived_at`).
- **Wallet balance = `opening_balance_base + SUM(amount_base since anchor where archived_at IS NULL)`.**
- RPCs: `replace_money_ledger_row` (atomic archive+insert), `reconcile_user_wallets(threshold=50)`
  (nightly: compares source-table truth vs ledger sum, writes `unaccounted_outflow` on drift).
  `money_ledger_write_failures` table surfaces drift → "data degraded" banner.

### Spending engine (migs 0020, 0027–0030, 0048, 0082–0088, 0096, 0101)
- **`spends`** — `wallet_id`, `spent_at`/`spent_time`, `amount`/`currency`/`amount_base` (locked),
  `for_us`, `is_sadaka`, `is_for_someone_else` + `beneficiary_entity_id`, `non_loan`, `covers_periods`,
  `recurring_spend_id`, `loan_id/loan_installment_id`.
- **`spend_items`** (name/quantity/amount/notes), **`spend_category_links`** (m2m — tags are **pure
  labels**, each spend counts FULL for every tag, no allocation).
- **`spend_categories`** (= tags) — `tag_kind ∈ audience/category/custom`, `kind ∈
  consumption/investment/neutral` (investment-vs-consumption ledger), `pinned`, `created_by_user`.
- **`recurring_spends`** + `recurring_spend_skips`, **`planned_spends`** (plans: `certainty`,
  `status ∈ active/planned/bought/done/cancelled/abandoned`, AI price fields, `target_date`,
  `bought_actual_price`, `satisfaction_rating/note`), **`plan_strategies`** (AI savings strategies,
  one active per plan), **`daily_safe_snapshots`** (`(user_id, pht_date) → initial_safe_base`).

### Vendors (migs 0032, 0078–0095) & Entities/People (migs 0033, 0096–0102, 0107)
- **`vendors`** — `canonical_name`, `slug`, `aliases`, `memory_consolidated`, `is_charity`,
  identification state (`needs_identification`, `confidence`, `brand_key`, `raw_user_typed_name`).
  `vendor_aliases`, `spend_vendor_links`, `vendor_price_history` (generated `unit_amount`, trigger-fed),
  `vendor_icon_cache` (AI glyph/color), `vendor_backfill_progress`.
- **`entities`** — people/pets/places/household/concept/habit/ritual. `relationship`,
  `introduction_status ∈ pending/asked/introduced/silenced`, `confidence`, `sadaka_recipient`,
  loan caches (`outstanding_loan_count/base_cached`, trigger-maintained). `spend_entity_links`,
  `entity_discovery_denylist`, `entity_pattern_baselines` (EWMA cadence/amount), `entity_backfill_progress`.
- Parallel `client_pattern_baselines`.

### Loans (migs 0020, 0106–0112)
- **`loans`** — `direction ∈ borrowed/lent/given/received` (given=lent=I sent out;
  received=borrowed=came in), `status ∈ open/partial/closed/partially_returned/returned/forgiven/
  written_off`, `counterparty_entity_id`, `origin_wallet/spend_id`, `principal_base`.
- `loan_returns` (idempotent via `client_request_id`), `loan_forgivals` (→ sadaka).
- RPCs `forgive_loan` (given→sadaka payment), `record_loan_return` (`FOR UPDATE` lock, over-return guard).

### Sadaka / charity (migs 0071–0076)
- **`sadaka_config`** (`base_contribution_pct`=2.5 zakat, `decay_pct_monthly`=4, `nudge_silence_days`=5,
  `classifier_confidence_threshold`=0.7).
- **`sadaka_ledger`** — append-only signed pool. `kind ∈ contribution(+)/payment(−)/auto_detected(−)/
  decay(−)/adjustment(±)`. **Pool = SUM(live rows), displayed floored at 0.** RPC `sadaka_pool_raw_base`.
- **`sadaka_auto_rules`** (`vendor_pattern/category/note_pattern/denylist_note`).

### AI / chat / memory
- **`ai_brain_cache`** — generalized `(user_id, brain_key) → payload + stale_at + input_fingerprint`.
- **`ai_user_facts`** — structured facts (`subject_kind ∈ user/client/vendor/project/plan/entity`,
  `key`, `value` jsonb, `confidence`, `source`, `evidence`, soft-delete).
- **`ai_open_questions`** (entity-scoped curiosity queue) + legacy **`ai_questions`**.
- **`chat_messages`** (per-page persistent, `session_id`, `page_key`, archived on summarize) +
  **`chat_session_summaries`** (end-of-session digests).
- `calm_weather_state`, `ai_focus_cache`, `ai_safe_spend_cache` (early single-brain caches).
- `user_memory`/`user_memory_entries`, `client_memory_entries`.

### Life-OS / editorial / wellbeing
- **`letters`** (editorial: `kind ∈ end_of_month/spotlight/sunday/year/anniversary/regret_mark`,
  headline/body/blocks, pinned, reply), `milestones`, `quiet_receipts`, `life_shifts`.
- **`morning_log`** (sleep/mood/mind), **`diary_entries`** (daily, user-written),
  `wellbeing_checkins` (Tuesday), `quiet_channels` (silent-client watcher), `rate_insights`.
- **`wife_state`** (preferences corpus), `islamic_calendar` + `ph_cultural_events` (2026–2030 seed).

### Faith & habits (migs 0108–0109)
- **`faith_settings`** (lat/long, `calculation_method`, `madhab ∈ shafi/hanafi`, `ramadan_enabled`).
- **`habits`** (`cadence ∈ daily/weekly/custom`, `target`) + `habit_entries` (one check-off/day).

### Notifications
- **`notifications_inbox`** (`kind`, `subject/body`, `link_url`, `dedup_key`, `priority`, `read_at`,
  `dismissed_at`, `deliver_at` for scheduled, `payload`/`answer` jsonb for interactive).
- **`notification_settings`** (`retention_days`=3, `retention_forever`, `push_enabled`,
  `per_kind_prefs {kind:{in_app,push,sound}}`), `push_subscriptions` (Web Push), legacy `notification_prefs`.
- RPC `run_notifications_retention` (hard-deletes read rows past retention; never unread).

### Significant schema pivots (history worth knowing)
expenses→spending engine · project_status 7→3 values · single→multi-project payments ·
FX-lock + holding wallets · money ledger unification · per-brain caches → `ai_brain_cache` ·
should-i-buy table → chat_messages · weekly intent_mirror → daily diary · plans redesign (lock dropped,
AI price + strategies + satisfaction) · changelog table → repo `CHANGELOG.md` · loans v1→v2.

---

## 2. App shell, navigation & design system

- **Routing:** `(auth)/login` (password gate) and `(app)/*` (everything). `/` → `/dashboard`
  (preserving `?notification=` from push). `proxy.ts` (Next 16's middleware) refreshes the Supabase
  session; `(app)/layout.tsx` re-checks auth server-side.
- **Three Supabase clients:** browser (anon), server (cookie SSR), service (service-role, `server-only`,
  bypasses RLS — only crons + push use it).
- **Primary nav** (sidebar + mobile sheet, identical): **Now** (Dashboard, Today, Notifications) ·
  **Money** (Projects, Payments, Spending, Plans, Sadaka) · **People** (Clients) · **Log** (Activity,
  Settings). Legacy routes redirect (Vendors→/spending/vendors, Entities→/clients/people).
- **Subtabs** (rendered in the top-bar center slot): Dashboard (Money/Commitments/State/Body),
  Spending (Spends/Trends/Vendors), Payments (Wallets/Withdrawals/History), Stats
  (Money/Behavior/Journey/Letters), Clients (Clients/People).
- **⌘K command palette** — Now/Money/People/Stories/Log/Settings(12 subtabs)/Quick-actions
  (log spend, ask AI, new client/project/payment, refresh rates). Search lives only here.
- **App shell wraps:** NotificationModalHost → ChatbotContextProvider → StatsLettersVisibility →
  BackgroundOrbs + FxAutoRefresh + ServiceWorkerRegistrar + NotificationLinkInterceptor + Sidebar +
  TopBar + PageTransition(children) + ChatbotPill + CommandPalette.
- **PWA:** manifest `start_url:/today`, standalone. **The service worker is currently neutralized** —
  `ServiceWorkerRegistrar` *unregisters* any SW (a navigation fetch handler caused "This page couldn't
  load" hangs). `public/sw.js` keeps push + click-routing logic (no fetch handler) for safe reintro.

### Design language (`globals.css`, `lib/design/tokens.ts`)
- "Editorial paper" aesthetic. **Six OKLCH themes** (Graphite default-dark, Midnight, Slate, Arctic,
  Paper, Carbon) via `next-themes` class attribute. `--brand` = one **acid-lime** accent used **once per
  screen**; `--overdue` = terracotta; `--rose` = alarm; `--success` = green.
- Fonts: **Geist** (sans), Geist Mono, **Fraunces** (`--font-display`, serif — reserved for hero numbers
  & headlines via `.display-headline`/`.display-numeric`). `.tabular` (tnum) on all money figures.
- Radius scale 4/6/10/12/16/20/28 (**never 8px**). `.paper-grain` texture, `.lift` hover, spring
  physics on nav/subtab indicators, draw-in-on-scroll for charts, full `prefers-reduced-motion` reset.

### UI primitives & widgets
- **Primitives** (`components/ui/*`): shadcn-nova wrappers over **`@base-ui/react`** (+ `cmdk`, `sonner`,
  `@number-flow/react`). Key custom: **CenterModal** (the canonical form shell — centered, not a side
  sheet, with Body/Footer slots + `titleAdornment` for an inline AI dot), Sheet, **MoneyFlow** (animated
  currency, PHP default), Input (rewrites `,`→`.` for decimals).
- **Widget system** (`components/widgets/*`) — the core visual vocabulary to port:
  - **SWidget** (~160² icon + ONE hero number, label in tooltip), **MWidget** (hero + lines + trailing
    slot), **LWidget** (hero + chart region). Tone = **ring color**, never background flood.
  - **Shapes** (SVG): DayStrip, FillBar, PhaseMoon, StackBar, **Stamp** (Fraunces state label:
    ROUGH/STEADY/OVERDRAWN), TrailLine. **NumberHero** (animated non-currency), **AiDot** (per-card,
    opens card-scoped chatbot), **WarningPill** (rose inline).
  - Conventions: **relevance gating** (widgets return null when no signal), one hero per S card,
    **cache-first + async-regen** for AI widgets (first paint never blocks Gemini), `live` breathing dot
    only on genuinely live widgets (safe-to-spend, today-spend).

---

## 3. The money math (most important to get right)

### Payment chain & fees
- A payment = one `payments` row + N ordered `payment_steps`. At mark-paid: `gross_at_market_base`
  (hop-1 input at today's rate), `net_amount_base` (final hop output in PHP), `implied_fee_base =
  max(0, gross−net)`, `fx_locked=true`. **Fee is always gross−net, never a guessed %.**
- **Method/route leaderboard** ("cheapest way to get paid"): group payments by `chainSignature`
  (e.g. "Wise → coin.ph"), `effectivePct = Σfee/Σvolume` (volume-weighted), plus distinct rails'
  monthly fees. `fee_unknown` rows excluded.
- Multi-project: net split pro-rata, last share absorbs rounding remainder (so allocations sum exactly).
- Side effects of landing: money_ledger income row, sadaka on-income hook, client-memory re-consolidate,
  client-pattern detection, safe-spend cache invalidation, revalidate.

### Wallet balances & reconciliation
- **Ledger-first:** `computeWalletBalancesFromLedger` is trusted when present; source-table math
  (`opening + received − withdrawn − spent`, after-anchor) is the backfill-window fallback.
- Anchor = `opening_balance_set_at` (exact instant) else `opening_balance_at` at PHT-midnight.
- Tri-state: positive / within_tolerance / over_overdraft (tolerance is display/alarm only, never folded
  into safe-to-spend). Runway = balance ÷ daily-burn. Nightly reconcile catches drift.

### Safe-to-spend (`lib/safe-to-spend.ts`) — continuous 30-day rolling horizon
1. Trailing 30d income/spend + 90d stability → `stabilityMultiplier ∈ [0.7,1.2]`.
2. **Recovery mode:** overspend spread gently over 60 days (`recoveryDailyTax`).
3. **Committed pool** = recurring-forward + loan-installments-forward + fee-floor(≥₱500) + planned-spends
   in horizon.
4. `discretionaryPool = max(0, wallets + forwardIncomeProjection − committedPool − recoveryTax×horizon)`.
5. `dailyAllowanceRaw = pool/30`; **COL floor ₱400/day** (PH food+transport) never breached.
   `surplus = max(0, raw − floor)`; `adjustedSurplus = surplus × stabilityMultiplier − plan-strategy
   reductions(Σ monthly_save/30)`; **`safeToday = floor + adjustedSurplus`**.
6. **Two-number live contract:** `initialForToday` (PHT-day-stable snapshot, stored in
   `daily_safe_snapshots`) and `liveRemaining = max(0, initial − today's spends)`; overshoot shows
   "₱X past safe". `confidenceTag`: <14d rough / <21d calibrating / steady.

### Sadaka pool
- Income hook contributes a Gemini-decided % (anchored 2.5%, lifts on windfall) into the pool.
- 4 auto-detect mechanisms on each spend (first match wins): flagged entity → charity vendor →
  pattern rules → AI classifier (tentative). Explicit `is_sadaka` toggle short-circuits all.
- Daily decay (PHT-month-length aware, idempotent per PHT day). Nightly nudge when pool sizeable +
  user silent ≥ N days + liquidity present. "Mark sadaka given" writes payment row + money_ledger mirror.

---

## 4. The AI layer (Gemini, server-side only)

- **Two model tiers:** `HEAVY` = `gemini-3.1-pro-preview` (reasoning/narration/PH canonicalization),
  `FAST` = `gemini-2.5-flash-lite` (classification/extraction). Key never reaches the browser
  (`server-only` + `"use server"`). Every brain checks `hasGemini()` and has a deterministic fallback;
  **brains never throw and never block the parent mutation** (fire-and-forget, best-effort).
- **Output pattern:** `responseMimeType:"application/json"` + `responseSchema` (from `Type.*`), parsed
  defensively (clamp confidences, validate keys against known IDs, length caps). Free-text brains
  (chat-answer, ask-your-money, draft-nudge) read raw text; all user-facing strings run through
  **`voice-scrub`** (strips "you should / consider / great job / save more" coaching phrases).
- **Brain cache** (`ai_brain_cache` via `withBrainCache`): 4 regen triggers — PHT-day rollover, TTL/
  `stale_at`, explicit `invalidateBrainCache`, input-fingerprint mismatch. `scopedBrainKey` gives
  per-subject slots. Financial mutations bust all keys except `FINANCIAL_INVALIDATION_EXEMPT`;
  spends < ₱200 don't bust.
- **Chatbot** (per-page, persistent): a context registry maps the pathname → page context
  (primary question + relevant data slice); the brain always sees the full **`freelane-state-snapshot`**
  (≤8000 chars, byte-stable for prefix caching). Flow: intent-classifier (Flash) → optionally route to a
  specialist (should-i-buy/purchase-decision, clarify-vendor/entity) → chat-answer (Pro) narrates →
  followup chips. Sessions persist to `chat_messages`, summarized to digests on end (30-min idle).
  AI dots on widgets open the chatbot scoped to that card.
- **Facts/memory:** notes → `extract-facts-from-notes` (Flash) → `ai_user_facts` (Facts panel) is a
  **separate path** from consolidation brains → `*_consolidated` jsonb (memory card). Two curiosity
  queues: `ai_open_questions` (entity-scoped, AI-dot loop) and legacy `ai_questions` (curiosity-sweep).

### The full brain catalog (~47 modules, by domain)
- **Cashflow/forecast:** Calm Weather (band by math, Gemini narrates — "soul of the OS"), Forecast
  Storyteller, Forecast Summary, Safe-to-Spend overlay, Tight Mode Coach.
- **Wellbeing/body:** Pack Rhythm (cigarettes), Late-Night Cluster, Sleep×Spend Echo, Post-Payday Surge,
  Tuesday Check-In, Year Memory Recall (pure-math), First-Visit Pulse.
- **Spending/price:** Should-I-Buy, Price Drift / Intel / Sanity (pure-math), Weekly Price Check (cron),
  Spending Anomalies, Tag Suggest (local Markov + AI fallback).
- **Vendors:** Canonicalize Vendor, Identify Vendor (+from-chat), Vendor Absence/Heartbeat (math).
- **Entities:** Propose-from-Signal (Gate 1), Canonicalize Entity (Gate 2), Entity Pattern Change.
- **Sadaka:** Rhythm, Contribution Rate, Suggested Today, Spend→Sadaka Classifier.
- **Plans:** Price Lookup, Strategy Proposals, Purchase Decision Support, Satisfaction Check.
- **Editorial:** Editorial Letter (6 kinds), Worth-Saying Gate, Life Shift Writer, Milestone Namer,
  Quiet Receipt Writer.
- **Clients:** Quiet Channel Watcher, Project-Note Rate Insight, Wife Preferences, Client Memory
  consolidation, Client Pattern Change.
- **Guards (pure-math):** Wallet Sanity, Price Sanity; Loan Proposal (Flash, PH/Taglish keyword-aware).

---

## 5. Surfaces (what each screen shows)

- **Today** (ritual screen, `start_url`): Calm Weather banner → Safe-to-Spend (live) + Outstanding +
  Today's Focus → Today Spend + Sleep Echo + Cigarettes → Diary → ≤3 contextual cards (money rhythm /
  cultural / editorial). All AI widgets cache-first + async-regen; PHT-midnight auto-refresh.
- **Dashboard** (4 subtabs): **Money** (total wallets, 30d net, live daily safe, forecast, wallet stack,
  runway, income strip, spend trend, pack rhythm + alerts band + jump-to), **Commitments** (active
  projects, open payments, sadaka pool, last client), **State** (period/recovery, mostly null-gated),
  **Body** (sleep, cigarettes, diary, night-spends remark).
- **Payments** (Wallets/Withdrawals/History): drag-orderable wallet S-cards, chain modal (multi-hop),
  bulk modal, withdrawal modal, wallet-detail sheet (ledger list + 30d sparkline + re-anchor).
- **Spending** (Spends/Trends/Vendors): spend modal (items/qty/tags/vendor/beneficiary/sadaka/loan),
  year heatmap, filters; trends charts (heatmap, anomalies, cashflow atlas, small multiples,
  investment-vs-consumption, vendor intelligence); category/vendor detail pages.
- **Plans:** 4-field create (name/price/target/why), AI price lookup, savings strategies (activate one),
  purchase-decision modal (wallet impact), +14d satisfaction check.
- **Sadaka:** pool hero + "mark given", activity (with "Not sadaka"), rhythm sparkline, auto-rules, config.
- **Clients / People:** client cards ranked by lifetime value (landed/outstanding/warnings), detail with
  living memory (composer + facts panel), draft-a-nudge, pattern history, quiet-channel, rate insights.
  People = entities (person/pet/place/…) with discovery → canonicalize → introduce flow, loan totals.
- **Projects:** kanban (drag to Paid → forces logging a payment) + list (blocked money by urgency).
- **Letters:** editorial archive (paginated, year/theme filters), chromeless reader, reply→memory.
- **Stats `/stats/[scope]`:** scope = lifetime/year/client/time-window; subtabs Money/Behavior/Journey/
  Letters; ~20 stats widgets. `/year/[year]` = legacy projects/payments recap.
- **Activity:** read-only feed unioning ~16 source tables (money/intent/chat/body/ai/system), PHT-day
  grouped, cursor-paginated.
- **Notifications:** inbox (26 kinds), interactive (choices/free-text/specialist modals), Web Push,
  retention. **Settings:** 12 subpages (profile/issuer, wallets/methods/currencies/opening-balance,
  cycles=recurring, body+habits, faith, tags, AI facts viewer, notifications prefs, privacy/export,
  appearance/theme, advanced, about, updates/changelog).

---

## 6. Background jobs (Vercel cron, `CRON_SECRET` / `x-vercel-cron` auth, service-role)

reconcile (01:00 PHT) → sadaka-daily (01:30: decay + nudge) → vendors-backfill (03:00) ·
loans-sweep (08:00: due-soon/overdue + push) · check-updates (09:00) · notifications-retention (11:00) ·
surface-question (00:00: curiosity loop) · letters-time-keyed (07:00: Sunday/month-end) ·
weekly-price-check (Sun 06:00). `entities-backfill` route exists but isn't scheduled.

---

## 7. Conventions to carry into the native rebuild

1. **PHT everywhere** for day boundaries, staleness, snapshots, decay.
2. **FX-lock on settle** — paid/spent amounts frozen in PHP; only open balances re-value.
3. **Money ledger is canonical** — derive balances from the signed log; reconcile catches drift.
4. **Fee = gross − net**, volume-weighted route leaderboard, `fee_unknown` excluded.
5. **AI is best-effort, cache-first, never blocks, always has a deterministic fallback**, voice-scrubbed.
6. **Relevance gating** — surfaces show nothing rather than stub zeros.
7. **Tone = accent ring, one acid-lime per screen**, Fraunces only for hero numbers, never 8px radius.
8. **Two memory paths** per subject (raw notes→facts vs consolidated doc) kept honestly separate.
9. **Single-user** — the logged-in user is always the owner; no multi-tenancy logic needed natively
   beyond the Supabase RLS already in place.

*(Generated from a full read of `/src` and `/supabase/migrations`. The web app remains the behavioral
source of truth; reconfirm any specific calc against the named module before porting.)*
