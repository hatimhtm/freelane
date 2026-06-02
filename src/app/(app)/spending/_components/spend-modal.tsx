"use client";

import {
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Plus, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";

import {
  CenterModal,
  CenterModalBody,
  CenterModalFooter,
} from "@/components/ui/center-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WalletPickerWithBalance } from "@/components/app/wallet-picker";

import { SafeToSpendImpactDial } from "@/components/app/safe-to-spend-impact-dial";
import { PriceTypoGuard } from "@/components/app/price-typo-guard";
import { TagSuggestStrip } from "@/components/app/tag-suggest-strip";
import { PriceIntelLine } from "@/components/app/price-intel-line";
import { CigaretteCostTranslatorStrip } from "@/components/app/cigarette-cost-translator-strip";

import { createSpend } from "@/lib/data/actions";
import { createCustomTagAction } from "../_actions/tag-actions";
import { formatMoney } from "@/lib/money";
import { cn, phtToday, phtTimeHHMM } from "@/lib/utils";
import { priceSanity, type PriceSanityResult } from "@/lib/ai/price-sanity";
import {
  buildTokenCategoryFrequency,
  buildWalletBias,
  suggestTagsLocal,
  tokenize,
  type SuggestedTag,
} from "@/lib/ai/tag-suggest";
import type { SafeToSpendBreakdown } from "@/lib/safe-to-spend";
import type {
  CurrencyCode,
  PriceIntelligenceRow,
  Spend,
  SpendCategory,
  SpendCategoryLink,
  SpendItem,
} from "@/lib/supabase/types";

const EASE = [0.22, 1, 0.36, 1] as const;
const PHP: CurrencyCode = "PHP";

export type WalletOpt = {
  id: string;
  name: string;
  is_holding: boolean;
  balanceBase?: number;
  // T13 — surface the canonical wallet tri-state down into the picker /
  // balance preview / impact dial so a wallet within tolerance reads
  // differently from one over its overdraft. The CLAUDE.md note at
  // payment-chain.ts promised these would propagate everywhere — these two
  // optional fields keep all five builders honest without breaking existing
  // callers.
  overdraftToleranceBase?: number;
  status?: "positive" | "within_tolerance" | "over_overdraft";
};

export type SpendModalDefaults = {
  categoryId?: string;
  amountBase?: number;
  description?: string;
  note?: string;
  recurringSpendId?: string;
  source?: string;
};

type ItemRow = { name: string; quantity: string; amount: string; notes: string };

export function SpendModal({
  open,
  onOpenChange,
  wallets,
  categories,
  currencies,
  baseCurrency,
  rates,
  recentSpends,
  spendCategoryLinks,
  spendItems,
  priceIntelCache,
  safeToSpendBaseline,
  initialSafeForToday,
  liveSafeRemaining,
  defaults,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  wallets: WalletOpt[];
  categories: SpendCategory[];
  currencies: string[];
  baseCurrency: CurrencyCode;
  rates: { code: string; rate_to_base: number }[];
  recentSpends: Spend[];
  spendCategoryLinks: SpendCategoryLink[];
  spendItems: SpendItem[];
  priceIntelCache?: PriceIntelligenceRow[];
  safeToSpendBaseline: SafeToSpendBreakdown;
  // BUG FIX #2 (LIVE DAILY SAFE) — explicit live numbers from the loader.
  // initialSafeForToday is the PHT-anchored snapshot (stable across the
  // day); liveSafeRemaining is initialSafeForToday minus sum of today's
  // spend.amount_base. Optional so legacy callers still work.
  initialSafeForToday?: number;
  liveSafeRemaining?: number;
  defaults?: SpendModalDefaults;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [walletId, setWalletId] = useState("");
  // BUG FIX #2 (revised) — the optimistic-decrement plumbing was removed:
  // on the happy path the modal unmounts before any paint, so the user
  // never saw the optimistic value. The rollback branch (intended for
  // save failures) was the OPPOSITE of the original UX intent. The
  // server-side router.refresh() re-renders within one paint of the
  // close transition, so the dial picks up the truthful live number
  // without intermediate state.
  const [spentAt, setSpentAt] = useState(() => phtToday());
  // Time-of-day on the spend (Tier 1, migration 0028). Optional; defaults to
  // "now" when the user is logging live, blank when backdating from home.
  const [spentTime, setSpentTime] = useState<string>(() => phtTimeHHMM());
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<string>(PHP);
  // Tier 2 (F): "It's For Us" tag — household line distinct from Wife.
  const [forUs, setForUs] = useState(false);
  // Sadaka workflow (Phase 2, migration 0075). Explicit toggle. The action
  // path writes a sadaka_ledger payment row and short-circuits auto-detect.
  const [sadaka, setSadaka] = useState(false);
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [businessRelevant, setBusinessRelevant] = useState(false);
  const [vat, setVat] = useState("");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [showItems, setShowItems] = useState(false);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [recurringSpendId, setRecurringSpendId] = useState<string | null>(null);
  const [coversPeriods, setCoversPeriods] = useState<number>(1);

  // Hard reset on every open so a previous draft doesn't bleed in. Defaults
  // are applied in the same pass to keep state mutations cohesive.
  useEffect(() => {
    if (!open) return;
    const richestHolding = wallets
      .filter((w) => w.is_holding)
      .sort((a, b) => (b.balanceBase ?? 0) - (a.balanceBase ?? 0))[0];
    setWalletId(richestHolding?.id ?? wallets[0]?.id ?? "");
    setSpentAt(phtToday());
    setSpentTime(phtTimeHHMM());
    setCurrency(PHP);
    setDescription(defaults?.description ?? "");
    setNotes(defaults?.note ?? "");
    setBusinessRelevant(false);
    setForUs(false);
    setSadaka(false);
    setVat("");
    setSelectedCategoryIds(defaults?.categoryId ? [defaults.categoryId] : []);
    setShowItems(false);
    setItems([]);
    setRecurringSpendId(defaults?.recurringSpendId ?? null);
    setCoversPeriods(1);
    setError(null);
    if (defaults?.amountBase && defaults.amountBase > 0) {
      setAmount(String(Math.round(defaults.amountBase)));
    } else {
      setAmount("");
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const amountNum = Number(amount) || 0;
  const amountBase = useMemo(
    () => toBase(amountNum, currency, rates, baseCurrency),
    [amountNum, currency, rates, baseCurrency],
  );

  const selectedWallet = wallets.find((w) => w.id === walletId);
  const selectedWalletBalance = selectedWallet?.balanceBase ?? 0;

  // Sorted wallets + balance map for the inline-balance picker. Holding wallets
  // float to the top with the richest first — the most likely source.
  const sortedWallets = useMemo(() => sortWallets(wallets), [wallets]);
  const walletBalances = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of wallets) {
      if (typeof w.balanceBase === "number") m.set(w.id, w.balanceBase);
    }
    return m;
  }, [wallets]);
  // Per-wallet status (positive / within_tolerance / over_overdraft) so the
  // picker can paint a soft terracotta or rose dot. The page-level wallet-list
  // builders are responsible for populating WalletOpt.status from the canonical
  // walletStatus() helper.
  const walletStatuses = useMemo(() => {
    const m = new Map<string, "positive" | "within_tolerance" | "over_overdraft">();
    for (const w of wallets) {
      if (w.status) m.set(w.id, w.status);
    }
    return m;
  }, [wallets]);
  const walletOptions = useMemo(
    () => sortedWallets.map((w) => ({ id: w.id, name: w.name })),
    [sortedWallets],
  );

  // Markov + wallet-bias suggestion strip — purely local + instant. AI fallback
  // would require a server roundtrip and breaks the calm of typing; deferred.
  const tagSuggestions: SuggestedTag[] = useMemo(() => {
    const tokens = tokenize(description);
    if (tokens.length < 3) return [];
    const freq = buildTokenCategoryFrequency(recentSpends, spendCategoryLinks);
    const bias = buildWalletBias(recentSpends, spendCategoryLinks);
    return suggestTagsLocal(description, walletId || null, categories, freq, bias);
  }, [description, walletId, categories, recentSpends, spendCategoryLinks]);

  // Hide already-selected suggestions so the strip never re-proposes a chip
  // the user just accepted — it would feel like noise.
  const visibleSuggestions = tagSuggestions.filter(
    (s) => !selectedCategoryIds.includes(s.categoryId),
  );

  const sanity: PriceSanityResult = useMemo(() => {
    if (amountNum <= 0) return { status: "ok" };
    return priceSanity({
      amount: amountNum,
      currency: currency as CurrencyCode,
      categoryIds: selectedCategoryIds,
      vendorToken: firstStrongToken(description),
      walletBalanceBase: selectedWalletBalance,
      history: { spends: recentSpends, links: spendCategoryLinks },
    });
  }, [
    amountNum,
    currency,
    selectedCategoryIds,
    description,
    selectedWalletBalance,
    recentSpends,
    spendCategoryLinks,
  ]);

  const activeCategories = useMemo(
    () => categories.filter((c) => !c.archived),
    [categories],
  );

  // Audience-kind index. Built off `categories` (NOT activeCategories) so
  // pinned seed rows are always indexed even if a stray archive slipped
  // through. Drives:
  //   - the audience radio behaviour (toggling one clears the other two)
  //   - the "hide legacy switches when audience seeds exist" gate
  //   - the on-save write that mirrors the chosen audience chip into the
  //     legacy business_relevant / for_us booleans
  const audienceIndex = useMemo(() => {
    const ids = new Set<string>();
    let business: string | null = null;
    let personal: string | null = null;
    let forUs: string | null = null;
    let allId: string | null = null;
    for (const c of categories) {
      if (c.tag_kind !== "audience") continue;
      ids.add(c.id);
      const lower = c.name.toLowerCase();
      if (lower === "business") business = c.id;
      else if (lower === "personal") personal = c.id;
      else if (lower === "for us") forUs = c.id;
      else if (lower === "all") allId = c.id;
    }
    return { ids, business, personal, forUs, allId };
  }, [categories]);

  const hasAudienceSeeds =
    audienceIndex.business != null ||
    audienceIndex.personal != null ||
    audienceIndex.forUs != null;

  function toggleCategory(id: string) {
    // Audience chips behave as a mutually-exclusive radio. Toggling one
    // clears the other two audience ids from the selection; click again
    // to unselect (back to the implicit "All").
    if (audienceIndex.ids.has(id)) {
      setSelectedCategoryIds((prev) => {
        const has = prev.includes(id);
        const stripped = prev.filter((x) => !audienceIndex.ids.has(x));
        return has ? stripped : [...stripped, id];
      });
      return;
    }
    setSelectedCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  // Mirror the chosen audience chip into the legacy booleans on every
  // selection change. Keeps a single source of truth — the chip — so the
  // ghost-row case (audience=Personal + business_relevant=true) can't
  // happen anymore. Skipped when the user account has no audience seeds
  // (e.g. brand-new user before 0086's trigger runs).
  useEffect(() => {
    if (!hasAudienceSeeds) return;
    const sel = selectedCategoryIds;
    const isBiz = audienceIndex.business != null && sel.includes(audienceIndex.business);
    const isForUs = audienceIndex.forUs != null && sel.includes(audienceIndex.forUs);
    setBusinessRelevant(isBiz);
    setForUs(isForUs);
  }, [selectedCategoryIds, audienceIndex, hasAudienceSeeds]);

  function addItem() {
    setItems((prev) => [...prev, { name: "", quantity: "1", amount: "", notes: "" }]);
  }
  function setItem(i: number, patch: Partial<ItemRow>) {
    setItems((prev) =>
      prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)),
    );
  }
  function removeItem(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  function save() {
    setError(null);
    if (!walletId) {
      setError("Pick a wallet first.");
      return;
    }
    if (!(amountNum > 0)) {
      setError("Enter an amount.");
      return;
    }
    const cleanItems = items
      .map((it) => ({
        name: it.name.trim(),
        quantity: it.quantity && Number(it.quantity) > 0 ? Number(it.quantity) : 1,
        amount: it.amount ? Number(it.amount) : null,
        notes: it.notes.trim() || null,
      }))
      .filter((it) => it.name.length > 0);

    const vatNum = vat ? Number(vat) : null;

    start(async () => {
      const result = await createSpend({
        wallet_id: walletId,
        spent_at: spentAt,
        spent_time: spentTime || null,
        amount: amountNum,
        currency,
        description: description.trim() || null,
        notes: notes.trim() || null,
        vat_amount: vatNum && vatNum > 0 ? vatNum : null,
        business_relevant: businessRelevant,
        for_us: forUs,
        is_sadaka: sadaka,
        covers_periods: recurringSpendId ? Math.max(1, coversPeriods) : 1,
        recurring_spend_id: recurringSpendId,
        categoryIds: selectedCategoryIds,
        items: cleanItems.length
          ? cleanItems.map((it) => ({ name: it.name, quantity: it.quantity, amount: it.amount, notes: it.notes }))
          : undefined,
      });
      if (!result.ok) {
        setError(result.error || "Couldn't save the spend.");
        return;
      }
      toast.success(
        `Logged · ${formatMoney(amountBase, baseCurrency, { compact: true })}`,
      );
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <CenterModal
      open={open}
      onOpenChange={onOpenChange}
      title="Log a spend"
      description="Record it, tag it, let the math update."
      size="lg"
      className="sm:max-w-[560px]"
    >
      <CenterModalBody>
        <AnimatePresence initial={false}>
          {error && (
            <motion.div
              key="err"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.24, ease: EASE }}
              className="mb-3 border-l-2 border-[var(--overdue)] bg-muted/30 px-3 py-2 text-xs leading-relaxed text-foreground/80"
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid gap-3 pt-0.5">
          <div className="grid grid-cols-[1fr_auto] items-start gap-3">
            <Row label="Wallet">
              <WalletPickerWithBalance
                value={walletId}
                onValueChange={(v) => v && setWalletId(v)}
                methods={walletOptions}
                balances={walletBalances}
                statuses={walletStatuses}
                baseCurrency={baseCurrency}
                placeholder="Pick a wallet"
              />
            </Row>
            <Row label="When">
              <div className="flex items-center gap-1.5">
                <Input
                  type="date"
                  value={spentAt}
                  onChange={(e) => setSpentAt(e.target.value)}
                  className="h-8 w-[150px] tabular"
                />
                <Input
                  type="time"
                  value={spentTime}
                  onChange={(e) => setSpentTime(e.target.value)}
                  className="h-8 w-[92px] tabular"
                  aria-label="Time of day (optional)"
                />
              </div>
            </Row>
          </div>

          <div className="grid grid-cols-[1fr_auto] items-start gap-3">
            <Row label="Amount">
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="h-9 flex-1 text-right tabular text-sm"
                />
                <Select
                  items={currencies.map((c) => ({ value: c, label: c }))}
                  value={currency}
                  onValueChange={(v) => v && setCurrency(v)}
                >
                  <SelectTrigger className="h-9 w-[78px] shrink-0 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {currencies.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </Row>

            <div className="pt-[18px]">
              <SafeToSpendImpactDial
                proposedAmountBase={amountBase}
                baseline={safeToSpendBaseline}
                liveRemaining={liveSafeRemaining}
                initialForToday={initialSafeForToday}
              />
            </div>
          </div>

          {sanity.status !== "ok" && (
            <PriceTypoGuard
              result={sanity}
              onApplyFix={(v) => setAmount(String(v))}
            />
          )}

          <Row label="Description">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What was it"
              rows={2}
              className="min-h-[40px] resize-none text-sm"
            />
          </Row>

          {visibleSuggestions.length > 0 && (
            <div className="-mt-1">
              <TagSuggestStrip
                suggestions={visibleSuggestions}
                categories={activeCategories}
                onAccept={toggleCategory}
              />
            </div>
          )}

          <Row label="Tags">
            <CategoryChips
              categories={activeCategories}
              selected={selectedCategoryIds}
              onToggle={toggleCategory}
              onTagCreated={(id) =>
                setSelectedCategoryIds((prev) =>
                  prev.includes(id) ? prev : [...prev, id],
                )
              }
            />
          </Row>

          {hasCigarettesTagSelected({
            selected: selectedCategoryIds,
            categories: activeCategories,
          }) && amountBase > 0 && (
            <CigaretteCostTranslatorStrip amountPhp={amountBase} />
          )}

          <Row label="Notes" optional>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything to remember"
              rows={2}
              className="min-h-[40px] resize-none text-sm"
            />
          </Row>

          <Hairline />

          {/* Legacy Business-relevant / For us switches — only rendered
              for accounts that don't yet have audience seeds (pre-0086
              users). Once the audience chips exist, the chip is the
              single source of truth and these toggles would just create
              ghost rows where the boolean and the tag disagree. */}
          {!hasAudienceSeeds && (
            <>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-foreground">
                  Business-relevant
                </span>
                <Switch
                  checked={businessRelevant}
                  onCheckedChange={setBusinessRelevant}
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col">
                  <span className="text-xs font-medium text-foreground">It&apos;s for us</span>
                  <span className="text-[10px] text-muted-foreground">Household — different from the Wife tag.</span>
                </div>
                <Switch
                  checked={forUs}
                  onCheckedChange={setForUs}
                />
              </div>
            </>
          )}

          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-xs font-medium text-foreground">Mark as sadaka</span>
              <span className="text-[10px] text-muted-foreground">Voluntary giving — writes to the sadaka pool.</span>
            </div>
            <Switch
              checked={sadaka}
              onCheckedChange={setSadaka}
            />
          </div>

          <Row label="VAT" optional>
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                placeholder="0.00"
                value={vat}
                onChange={(e) => setVat(e.target.value)}
                className="h-8 w-36 text-right tabular text-sm"
              />
              <span className="text-[11px] text-muted-foreground tabular">
                {currency}
              </span>
            </div>
          </Row>

          <Hairline />

          <div>
            <button
              type="button"
              onClick={() => setShowItems((v) => !v)}
              className="group flex w-full items-center justify-between text-left"
            >
              <span className="text-xs font-medium text-foreground">
                Add items
              </span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 text-muted-foreground transition-transform duration-300 ease-out",
                  showItems && "rotate-180",
                )}
              />
            </button>

            <AnimatePresence initial={false}>
              {showItems && (
                <motion.div
                  key="items"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.28, ease: EASE }}
                  className="overflow-hidden"
                >
                  <div className="mt-2.5 flex flex-col gap-2.5">
                    <AnimatePresence initial={false}>
                      {items.map((it, i) => (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.22, ease: EASE }}
                          className="border-l border-border/60 pl-3"
                        >
                          <div className="flex items-start gap-1.5">
                            <Input
                              value={it.name}
                              onChange={(e) =>
                                setItem(i, { name: e.target.value })
                              }
                              placeholder="Item"
                              className="h-8 flex-1 text-sm"
                            />
                            <Input
                              type="number"
                              inputMode="decimal"
                              step="0.001"
                              min="0"
                              value={it.quantity}
                              onChange={(e) =>
                                setItem(i, { quantity: e.target.value })
                              }
                              placeholder="qty"
                              aria-label="Quantity"
                              title="Quantity (default 1)"
                              className="h-8 w-14 text-center tabular text-sm"
                            />
                            <span className="self-center text-muted-foreground/60 text-xs">×</span>
                            <Input
                              type="number"
                              inputMode="decimal"
                              step="0.01"
                              value={it.amount}
                              onChange={(e) =>
                                setItem(i, { amount: e.target.value })
                              }
                              placeholder="0.00"
                              aria-label="Total price"
                              title="Total price for the line"
                              className="h-8 w-24 text-right tabular text-sm"
                            />
                            <button
                              type="button"
                              onClick={() => removeItem(i)}
                              className="grid size-8 place-items-center text-muted-foreground/60 transition-colors duration-300 ease-out hover:text-[var(--overdue)]"
                              aria-label="Remove item"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          {it.name.trim().length > 1 && (
                            <PriceIntelLine
                              itemName={it.name}
                              items={spendItems}
                              spends={recentSpends}
                              cache={priceIntelCache}
                            />
                          )}
                          <Input
                            value={it.notes}
                            onChange={(e) => setItem(i, { notes: e.target.value })}
                            placeholder="Notes (optional)"
                            className="mt-1.5 h-7 w-full text-xs text-foreground/80"
                          />
                        </motion.div>
                      ))}
                    </AnimatePresence>
                    <button
                      type="button"
                      onClick={addItem}
                      className="inline-flex h-7 w-fit items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors duration-300 ease-out hover:bg-muted hover:text-foreground"
                    >
                      <Plus className="h-3 w-3" />
                      Add item
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {recurringSpendId && (
            <>
              <Hairline />
              <Row label="Covers">
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    inputMode="numeric"
                    step="1"
                    min={1}
                    value={String(coversPeriods)}
                    onChange={(e) =>
                      setCoversPeriods(
                        Math.max(1, Math.floor(Number(e.target.value) || 1)),
                      )
                    }
                    className="h-8 w-20 text-right tabular text-sm"
                  />
                  <span className="text-xs text-muted-foreground">
                    {coversPeriods === 1 ? "period" : "periods"}
                  </span>
                </div>
              </Row>
            </>
          )}
        </div>
      </CenterModalBody>

      <CenterModalFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          onClick={save}
          disabled={pending || !walletId || amountNum <= 0}
        >
          {pending ? "Saving…" : "Save spend"}
        </Button>
      </CenterModalFooter>
    </CenterModal>
  );
}

function Row({
  label,
  children,
  optional,
}: {
  label: string;
  children: ReactNode;
  optional?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
        {optional && (
          <span className="ml-1 normal-case tracking-normal text-muted-foreground/60">
            optional
          </span>
        )}
      </Label>
      {children}
    </div>
  );
}

// Tier 4: Cigarette Cost Translator triggers when the user has tagged the
// spend as Cigarettes. Match by category NAME so the user's renamed seed
// (e.g. "Cigs" or "Smokes") still triggers if they include "cigarette".
function hasCigarettesTagSelected({
  selected,
  categories,
}: {
  selected: string[];
  categories: SpendCategory[];
}): boolean {
  const byId = new Map(categories.map((c) => [c.id, c]));
  for (const id of selected) {
    const cat = byId.get(id);
    if (!cat) continue;
    if (/cigarettes?|smoke/i.test(cat.name)) return true;
  }
  return false;
}

function Hairline() {
  return <div className="h-px w-full bg-border/60" />;
}

// Spendings workflow — TAG SYSTEM (3 kinds, post-0083).
//
// Renders three zones inside the modal Tags row:
//   1. Audience radio (Business / Personal / For us) — mutually
//      exclusive. "All" is the unselected default.
//   2. Category multi-select wrap (predefined tags).
//   3. Custom multi-select wrap + inline "+ New tag" form.
function CategoryChips({
  categories,
  selected,
  onToggle,
  onTagCreated,
}: {
  categories: SpendCategory[];
  selected: string[];
  onToggle: (id: string) => void;
  // Notify parent when a new custom tag was created so it can
  // optimistically select it / trigger a refresh.
  onTagCreated?: (id: string) => void;
}) {
  if (categories.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No categories yet — add some in settings.
      </p>
    );
  }
  const tagKindOf = (c: SpendCategory): "audience" | "category" | "custom" => {
    const tk = c.tag_kind;
    return tk === "audience" || tk === "custom" ? tk : "category";
  };
  // Exclude the "All" seed — it's a filter-row sentinel ("no audience
  // restriction"), NOT a tag the user can attach to a spend. Letting the
  // chip render here would leave a clickable dead-end that writes a
  // meaningless tag id.
  const audience = categories.filter(
    (c) => tagKindOf(c) === "audience" && c.name.toLowerCase() !== "all",
  );
  const cats = categories.filter((c) => tagKindOf(c) === "category");
  const customs = categories.filter((c) => tagKindOf(c) === "custom");
  return (
    <div className="flex flex-col gap-2.5">
      {audience.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {audience.map((c) => {
            const on = selected.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onToggle(c.id)}
                aria-pressed={on}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors duration-300 ease-out",
                  on
                    ? "border-foreground bg-foreground text-background"
                    : "border-foreground/20 text-foreground/85 hover:bg-foreground/[0.05]",
                )}
              >
                {c.name}
              </button>
            );
          })}
        </div>
      )}
      {cats.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {cats.map((c) => {
            const on = selected.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onToggle(c.id)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors duration-300 ease-out",
                  on
                    ? "border-foreground bg-foreground text-background"
                    : "border-border/70 text-foreground/80 hover:bg-muted hover:text-foreground",
                )}
              >
                {c.name}
              </button>
            );
          })}
        </div>
      )}
      <CustomTagsRow
        tags={customs}
        selected={selected}
        onToggle={onToggle}
        onTagCreated={onTagCreated}
      />
    </div>
  );
}

function CustomTagsRow({
  tags,
  selected,
  onToggle,
  onTagCreated,
}: {
  tags: SpendCategory[];
  selected: string[];
  onToggle: (id: string) => void;
  onTagCreated?: (id: string) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const name = draft.trim();
    if (!name) return;
    start(async () => {
      const res = await createCustomTagAction(name);
      if (!res.ok) {
        toast.error(res.error || "Couldn't add the tag.");
        return;
      }
      onTagCreated?.(res.data.id);
      setDraft("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((c) => {
        const on = selected.includes(c.id);
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onToggle(c.id)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors duration-300 ease-out",
              on
                ? "border-foreground bg-foreground text-background"
                : "border-border/60 text-foreground/75 hover:bg-muted hover:text-foreground",
            )}
          >
            {c.name}
          </button>
        );
      })}
      <form onSubmit={submit} className="inline-flex items-center gap-1">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="+ New tag"
          className="h-7 w-24 rounded-full border border-foreground/15 bg-card/40 px-2.5 text-[11.5px] outline-none placeholder:text-muted-foreground/60 focus:border-foreground/35"
        />
        {draft.trim().length > 0 && (
          <button
            type="submit"
            disabled={pending}
            className="h-7 rounded-full bg-foreground px-2 text-[10.5px] font-medium text-background transition-opacity disabled:opacity-40"
          >
            Add
          </button>
        )}
      </form>
    </div>
  );
}

// PHT helpers are imported from @/lib/utils (phtToday + phtTimeHHMM).

function toBase(
  amount: number,
  currency: string,
  rates: { code: string; rate_to_base: number }[],
  baseCurrency: string,
): number {
  if (!amount) return 0;
  if (currency === baseCurrency) return amount;
  const r = rates.find((x) => x.code === currency)?.rate_to_base ?? 1;
  return amount * r;
}

function sortWallets(wallets: WalletOpt[]): WalletOpt[] {
  // Holding wallets at the top; balance-rich first so the most likely source
  // is reachable without scrolling.
  return [...wallets].sort((a, b) => {
    if (a.is_holding !== b.is_holding) return a.is_holding ? -1 : 1;
    const balA = a.balanceBase ?? 0;
    const balB = b.balanceBase ?? 0;
    if (balA !== balB) return balB - balA;
    return a.name.localeCompare(b.name);
  });
}

// Pick the strongest non-stopword token to feed priceSanity's vendor filter —
// catches "fishpan", "globe", "dali", etc. without a full vendor field.
function firstStrongToken(description: string): string | undefined {
  const tokens = tokenize(description);
  const longest = tokens
    .filter((t) => t.length >= 4)
    .sort((a, b) => b.length - a.length)[0];
  return longest;
}
