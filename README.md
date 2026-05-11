<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/hero-banner-dark.svg" />
    <img src="assets/hero-banner.svg" alt="Freelane" width="100%" />
  </picture>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/PERSONAL_TOOL-SHOWCASE-1A1A1A?style=for-the-badge&labelColor=1A1A1A&color=CCFF00" alt="Personal tool — showcase" />
  <img src="https://img.shields.io/badge/Next.js-16-1A1A1A?style=for-the-badge&logo=nextdotjs&logoColor=CCFF00" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/React-19-1A1A1A?style=for-the-badge&logo=react&logoColor=CCFF00" alt="React 19" />
  <img src="https://img.shields.io/badge/Supabase-1A1A1A?style=for-the-badge&logo=supabase&logoColor=CCFF00" alt="Supabase" />
  <img src="https://img.shields.io/badge/Tailwind-4-1A1A1A?style=for-the-badge&logo=tailwindcss&logoColor=CCFF00" alt="Tailwind 4" />
</p>

<p align="center">
  <em><strong>My personal freelance ledger.</strong> A single-user Next.js 16 dashboard for tracking clients, projects, payments, expenses, and invoices across 5 currencies. ~10k LOC of source, all auth gated behind one password against a hidden Supabase user. The repo is here for inspection (and as part of my portfolio) — not as a product. There's no signup, no public deployment URL in this repo, and no roadmap for general use.</em>
</p>

---

### `/// WHAT'S IN THE BOX`

```
┌──────────────────────────────────────────────────────────────────┐
│ Dashboard (the part you open every morning)                      │
│ ├ Outstanding hero (every unpaid balance, converted to base FX)  │
│ ├ Earned this month + MoM delta                                  │
│ ├ Overdue · Due in 30 days                                       │
│ ├ Insights strip: avg days-to-payment · biggest debtor · YTD     │
│ ├ 6-month revenue chart · top-client pie · recent payments       │
│ └ Reminders widget for stale invoices                            │
├──────────────────────────────────────────────────────────────────┤
│ Pipeline (kanban)            │ Invoices                          │
│ ├ 3 columns: unpaid /        │ ├ Auto-numbered (YYYY-NNN)        │
│ │   partially paid / paid    │ ├ Snapshots issuer + client       │
│ ├ Drag a card → status flips │ │   at issue time                 │
│ ├ "Days open" badge on each  │ ├ React-PDF renderer (fr/en)      │
│ └ Per-project payment log    │ └ "Send reminder" with throttle   │
├──────────────────────────────────────────────────────────────────┤
│ Expenses (new in 2.0)        │ Settings                          │
│ ├ Date · vendor · category   │ ├ Issuer profile                  │
│ ├ Multi-currency             │ ├ FX rates (manual or auto from   │
│ ├ Subtotals + monthly        │ │   frankfurter.app — free, ECB)  │
│ └ Subtracted from MTD on the │ ├ Invoice defaults (TVA note,     │
│   dashboard                  │ │   accent, footer, reminder days)│
│                              │ ├ Backup download (JSON dump)     │
│                              │ └ Appearance (theme, locale)      │
└──────────────────────────────────────────────────────────────────┘
```

---

### `/// 2.0 — WHY THIS REWRITE`

1.x focused on **annual income** as the hero metric. As a freelancer that's the wrong cadence — cashflow happens monthly. 2.0 promotes **monthly earned** to the top, adds a **month-over-month delta** (rendered green/red), and demotes YTD to a smaller insights strip below.

Also new:

- **Average days to payment** — quote-to-first-payment latency, paid projects only. Single most useful cashflow signal.
- **Biggest debtor** — the one client to chase first.
- **Auto-FX refresh** — pulls mid-market rates from [frankfurter.app](https://www.frankfurter.app) (free, ECB, no API key) instead of relying on hand-edited numbers that go stale.
- **Expenses tracking** — the tagline says "every freelance coin" but 1.x only tracked income. Now it tracks both.
- **Mobile drawer** — sidebar was desktop-only; added a hamburger + Sheet-based mobile nav.

---

### `/// STACK`

```
Next.js 16  · React 19  · TypeScript
Tailwind 4  · motion    · @number-flow/react
Supabase (Postgres + Auth + RLS) · @supabase/ssr
recharts    · react-hook-form    · zod
@dnd-kit    · @react-pdf/renderer
shadcn/ui   · cmdk     · sonner
```

Hosted on Vercel. Single-user auth via a hidden Supabase user; the password gate on `/` calls `signInWithPassword` with a fixed email constant (`HIDDEN_OWNER_EMAIL`).

---

### `/// PROJECT LAYOUT`

```
src/
├── app/
│   ├── (auth)/login/                     password gate (single-user)
│   └── (app)/                            authenticated routes
│       ├── dashboard/                    hero stats + charts + insights
│       ├── projects/                     kanban + project dialog
│       ├── payments/                     payments hub
│       ├── expenses/                     expenses page (new in 2.0)
│       ├── invoices/                     invoice list + editor + PDF
│       ├── clients/                      clients CRUD
│       ├── activity/                     event log
│       └── settings/                     issuer, currencies, defaults
├── components/
│   ├── app/                              sidebar, top-bar, mobile-nav, command palette
│   └── ui/                               shadcn primitives
├── lib/
│   ├── data/{queries,actions,events}.ts  server-side data layer
│   ├── supabase/{server,client,types}.ts ssr clients + TS types
│   ├── money.ts                          format / convert / toBase
│   ├── invoice-number.ts                 auto-numbering
│   ├── constants.ts                      app-wide constants
│   └── auth.ts                           cached getAuthUser
└── proxy.ts                              middleware for auth refresh

supabase/migrations/                      0001 .. 0009 (numbered, append-only)
```

---

### `/// SETUP (for forking your own copy)`

If you actually want to run this — it's source-available, but you'll be setting up your own everything.

1. **Supabase**: create a new project. Run the migrations in `supabase/migrations/0001..0009` in order via the SQL editor. Edit `0003_seed_owner.sql` first to set `:'owner_uuid'` to your Supabase auth user UUID.
2. **Create the hidden user** in Supabase Auth: email `owner@freelane.local`, password is whatever you'll type on the unlock screen.
3. **Env**:
   ```bash
   cp .env.example .env.local
   # fill in NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY
   ```
4. **Run**:
   ```bash
   pnpm install
   pnpm dev
   ```

---

### `/// WHY YOU PROBABLY DON'T WANT TO USE THIS`

- **Single-user by design.** The login is a password gate against a hardcoded email constant. No signups, no multi-tenancy, no team support. Adding any of that is a non-trivial rewrite.
- **No tests.** This is a tool I open every morning. I notice when it breaks. That's "the test plan." For a real product you'd want at minimum Playwright on the critical flows.
- **No issues being accepted.** If you find a bug while reading the code, by all means open a discussion — but feature requests will be closed.
- **Pure personal opinions** baked in: invoice template is French-first, base currency defaults to PHP, exchange rates assume you're somewhere with multiple income currencies. Configurable but unapologetically defaulted to my situation.

---

<p align="center">
  <a href="https://hatimelhassak.is-a.dev"><img src="https://img.shields.io/badge/PORTFOLIO-1A1A1A?style=for-the-badge&logo=vercel&logoColor=CCFF00" alt="Portfolio" /></a>
  <a href="https://cal.com/hatimelhassak/engineering-discovery"><img src="https://img.shields.io/badge/BOOK_A_CALL-CCFF00?style=for-the-badge&logo=googlecalendar&logoColor=1A1A1A" alt="Book a call" /></a>
  <a href="https://www.linkedin.com/in/hatim-elhassak/"><img src="https://img.shields.io/badge/LINKEDIN-1A1A1A?style=for-the-badge&logo=linkedin&logoColor=CCFF00" alt="LinkedIn" /></a>
  <a href="mailto:hatimelhassak.official@gmail.com"><img src="https://img.shields.io/badge/EMAIL-1A1A1A?style=for-the-badge&logo=gmail&logoColor=CCFF00" alt="Email" /></a>
</p>

<p align="center">
  <code>///&nbsp;&nbsp;OPEN FOR NEW WORK&nbsp;&nbsp;///&nbsp;&nbsp;CONTRACT &amp; FREELANCE&nbsp;&nbsp;///&nbsp;&nbsp;REMOTE WORLDWIDE&nbsp;&nbsp;///</code>
</p>
