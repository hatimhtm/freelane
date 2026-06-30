# Freelane Money Engine — Canonical Specification

This is the **authoritative, platform-independent definition** of Freelane's money math.
The macOS app (Swift), the web app (TypeScript), and any future companion (e.g. Android/Kotlin)
must all implement these rules identically and pass the same golden vectors in
[`money-vectors.json`](./money-vectors.json). When the code and this document disagree, that is a
bug in one of them — fix it, don't let them drift.

> Why this exists: the money spine is real accounting. If two platforms compute "₱42,300" and
> "₱42,280" for the same data, that's the worst possible bug in a money app. This spec + the golden
> vectors make drift impossible to ship silently.

Source of truth in code (macOS): `Freelane/Money/` — `MoneyCore.swift`, `PaymentEngine.swift`,
`Metrics.swift`, `SpendEngine.swift`, `SafeToSpend.swift`.

---

## 0. Conventions

- All monetary values are stored and compared in the user's **base currency** at **2 decimal
  places**. Native amounts (USD, MAD, USDT…) are converted to base via FX before any arithmetic.
- Every stored monetary value is the result of `round2(...)` — never a raw float.
- Sign convention on the ledger: **positive = money in, negative = money out** (pre-signed).

---

## 1. Rounding — `round2`

```
round2(x) = roundHalfAwayFromZero(x * 100) / 100
```

macOS (`MoneyCore.swift`): `(x * 100).rounded() / 100`. Swift's `Double.rounded()` uses
**`.toNearestOrAwayFromZero`** — ties round *away from zero* (`2.5 → 3`, `-2.5 → -3`).

> ⚠️ **Cross-platform hazard.** JavaScript `Math.round(x*100)/100` rounds ties **toward +∞**
> (`2.5 → 3` but `-2.5 → -2`). It agrees with Swift for non-negative values but **disagrees on
> negative half-way ties**. The canonical rule is **half-away-from-zero** (the Swift behaviour).
> Any TS/Kotlin port must round half-away-from-zero, NOT use a naive `Math.round`, or it will drift
> by a cent on negative ties. Prefer rounding the **magnitude** then applying the sign.

Because IEEE-754 can't represent most 2-dp decimals exactly (e.g. `1.005`), the golden vectors
deliberately avoid exact half-way inputs; the rule above governs intent, but reproducible tests use
values that don't sit on a representational knife-edge.

---

## 2. FX conversion — `toBase`

```
toBase(amount, currency) = amount * rate[currency]      // rate[base] == 1.0
```

`rate[currency]` is `ExchangeRate.rateToBase` such that `nativeAmount * rateToBase = baseAmount`.
A missing rate falls back to `1:1` and logs a warning (never throws). Base currency is always 1.0.

---

## 3. Payments as fee-aware chains

A payment is a **chain of hops** (`PaymentStep`), ordered by `stepOrder` (1-based). Each step:

| field | meaning |
|------|---------|
| `fromMethodId` | source wallet (optional — e.g. cash origin has none) |
| `methodId` | destination wallet of this hop |
| `amountIn` / `currencyIn` | what entered this hop |
| `amountOut` / `currencyOut` | what came out (already FX-converted for this hop) |
| `isFinal` | true on the **last** hop only |

A payment must have ≥ 1 step. Define `first` = step with lowest `stepOrder`, `final` = the
`isFinal` step (the last one).

### 3.1 Net, gross, fee

```
grossBase = round2( toBase(first.amountIn,  first.currencyIn) )
netBase   = round2( toBase(final.amountOut, final.currencyOut) )
feeBase   = max(0, round2(grossBase - netBase))
```

- **`netBase`** (`payment.netAmountBase`) — what actually *landed* (final hop output, in base). This
  is the money that hits a wallet and counts as income.
- **`grossBase`** (`payment.grossAtMarketBase`) — what *left* the payer (first hop input, in base).
- **`feeBase`** (`payment.impliedFeeBase`) — the chain's total cost. Always `≥ 0`; intermediate hop
  fees are **not** stored, only the end-to-end difference.

Invariant: `grossBase = netBase + feeBase` (in base, at 2 dp).

### 3.2 `feeUnknown`

When the user doesn't know how much actually arrived, `feeUnknown = true` ⇒ treat as no fee:

```
net = gross ;  fee = 0
```

---

## 4. The ledger (`money_ledger` / `LedgerEntry`)

Append-only, pre-signed entries. Each carries `amountBase` (signed), `walletId`, `eventAt`,
`relatedKind` + `relatedId` (link to the source row), and `archivedAt` (nil = live). Kinds:
`income, outflow, transfer, fee, sadaka_payment, project_receipt, unaccounted_outflow, adjustment`.

Entries are created from sources as follows:

| Source | Entries created | Kind | `amountBase` |
|--------|-----------------|------|--------------|
| **Payment** (net > 0) | one, on the landing wallet | `income` | `+netBase` |
| **Spend** | one, on the spend's wallet | `outflow` (or `sadaka_payment` if `isSadaka`) | `-amountBase` |
| **Withdrawal** | source leg (if `fromMethodId`) | `transfer` if to-wallet set, else `outflow` | `-grossBase` |
| **Withdrawal** | dest leg (if `toMethodId` and `net > 0`) | `transfer` | `+netBase` |
| **Loan given** | one, on the wallet | `outflow` | `-principalBase` |
| **Loan borrowed** | one, on the wallet | `income` | `+principalBase` |

The ledger is the **single source of wallet balances**. It is a derived cache on the cloud side
(rebuilt locally on import); it is not pushed to the server.

---

## 5. Wallet balance

```
anchor(w)  = w.openingBalanceSetAt ?? w.openingBalanceAt      // may be nil
balance(w) = (w.openingBalanceBase ?? 0)
           + Σ e.amountBase  for every ledger entry e where
                 e.walletId == w.id
             AND e.archivedAt == nil
             AND (anchor == nil OR e.eventAt >= anchor)
```

- The **anchor** is the moment the opening balance is true from. Entries before it are excluded
  (they're already baked into `openingBalanceBase`). `openingBalanceSetAt` (a manual re-set) takes
  priority over `openingBalanceAt` (creation anchor).
- Only **live** entries (`archivedAt == nil`) count.
- "Available" = Σ balances of wallets that are `isHolding && !archived && !excludedFromTotals`.

---

## 6. Multi-project allocation split

A payment's `netBase` is split across N projects by their relative `allocationAmount`
(each converted to base). Proportional, with the **last** project absorbing the rounding remainder
so the split always reconciles to `round2(netBase)` exactly.

```
shareRaw[i] = toBase(project[i].allocationAmount, project[i].currency)
totalShare  = Σ shareRaw
netRounded  = round2(netBase)

for i in 0 ..< N-1:
    alloc[i] = round2( totalShare > 0 ? (shareRaw[i] / totalShare) * netBase : 0 )
running    = Σ alloc[0 ..< N-1]
alloc[N-1] = round2( netRounded - running )     // last absorbs the remainder
```

Invariant: `Σ alloc[i] == round2(netBase)`. If every share rounds to 0, the whole net lands on the
last project.

---

## 7. Withdrawals

```
g   = round2(grossBase)
net = round2( clamp(netBase, 0, grossBase) )     // can't receive more than what left
fee = max(0, g - net)
```

Ledger: source leg `-g` (`transfer` if a destination wallet is set, else `outflow`); destination
leg `+net` (`transfer`) only when `toMethodId` is set and `net > 0`. Both legs share the
withdrawal's id as `relatedId`. The fee is implicit (`g - net`), not a separate entry.

---

## 8. Project paid / outstanding / status

```
projectBase   = toBase(project.amount, project.currency)
paidGrossBase = Σ toBase(a.allocationAmount, a.allocationCurrency)  for a in allocations(project)
paidRatio     = projectBase > 0 ? paidGrossBase / projectBase : 0

status = paidRatio >= 1 - 1e-9 ? paid
       : paidRatio > 0         ? partiallyPaid
       :                          unpaid

outstandingBase = max(0, projectBase - paidGrossBase)
```

`allocationAmount` is the **gross** the client paid (before fees). A project is "paid" when the
gross allocated ≥ gross quoted, regardless of fees deducted in transit.

---

## 9. Safe-to-spend (summary)

A daily allowance anchored on **what you actually spend** vs your city's cost of living — *not*
wallet ÷ days (parked money can't inflate it). Full detail in `SafeToSpend.swift`; the shape:

```
income30/90  = Σ netAmountBase over last 30/90 days
recentDaily  = income30/30 ;  longRunDaily = income90/90
stabilityMult= clamp(recentDaily/longRunDaily, 0.7, 1.2)     // 1.0 while "learning"
typical      = typicalDailySpend(spends)        // excludes one-offs & investments
colLow       = max(150, colDailyBase * 0.45) ;  colHigh = colDailyBase * 2.5
base         = clamp(typical>0 ? typical : colDailyBase, colLow, colHigh)
             ± recovery tax (if overspending) / +15% (if trending up while stable)
ceiling      = max(colLow, (walletBalances - committed) / 30)
safeTodayBase   = round2( min(max(colLow, base), walletBalances) )
liveRemaining   = max(0, round2( min(initialForToday - spentToday, walletBalances) ))
```

`initialForToday` is snapshotted at dawn so the day's allowance is stable; `liveRemaining` ticks
down as you spend. Both are clamped to never exceed real holding-wallet cash.

---

## 10. Reimplementation checklist (for the Android/web engine)

1. `round2` = **half-away-from-zero** on the magnitude (not naive `Math.round`).
2. Convert to base via `toBase` **before** any arithmetic; base rate is 1.0; missing rate ⇒ 1:1.
3. Net = final hop output in base; gross = first hop input in base; `fee = max(0, gross - net)`.
4. Ledger is pre-signed (+ in / − out); wallet balance = opening + Σ live entries since anchor.
5. Allocation split: proportional, **last project absorbs the remainder**, sum == `round2(net)`.
6. Withdrawal net clamped to `[0, gross]`; two ledger legs sharing one id.
7. Project status by **gross** allocated ÷ gross quoted, with a `1e-9` paid tolerance.
8. Validate against [`money-vectors.json`](./money-vectors.json) — every case, to the cent.
