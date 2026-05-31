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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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

import { SafeToSpendImpactDial } from "@/components/app/safe-to-spend-impact-dial";
import { PriceTypoGuard } from "@/components/app/price-typo-guard";
import { TagSuggestStrip } from "@/components/app/tag-suggest-strip";
import { PriceIntelLine } from "@/components/app/price-intel-line";

import { createSpend } from "@/lib/data/actions";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
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
};

export type SpendSheetDefaults = {
  categoryId?: string;
  amountBase?: number;
  description?: string;
  note?: string;
  recurringSpendId?: string;
  source?: string;
};

type ItemRow = { name: string; amount: string };

export function SpendSheet({
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
  defaults?: SpendSheetDefaults;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [walletId, setWalletId] = useState("");
  const [spentAt, setSpentAt] = useState(() => today());
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<string>(PHP);
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
    setSpentAt(today());
    setCurrency(PHP);
    setDescription(defaults?.description ?? "");
    setNotes(defaults?.note ?? "");
    setBusinessRelevant(false);
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

  function toggleCategory(id: string) {
    setSelectedCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function addItem() {
    setItems((prev) => [...prev, { name: "", amount: "" }]);
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
        amount: it.amount ? Number(it.amount) : null,
      }))
      .filter((it) => it.name.length > 0);

    const vatNum = vat ? Number(vat) : null;

    start(async () => {
      try {
        await createSpend({
          wallet_id: walletId,
          spent_at: spentAt,
          amount: amountNum,
          currency,
          description: description.trim() || null,
          notes: notes.trim() || null,
          vat_amount: vatNum && vatNum > 0 ? vatNum : null,
          business_relevant: businessRelevant,
          covers_periods: recurringSpendId ? Math.max(1, coversPeriods) : 1,
          recurring_spend_id: recurringSpendId,
          categoryIds: selectedCategoryIds,
          items: cleanItems.length
            ? cleanItems.map((it) => ({ name: it.name, amount: it.amount }))
            : undefined,
        });
        toast.success(
          `Logged · ${formatMoney(amountBase, baseCurrency, { compact: true })}`,
        );
        onOpenChange(false);
        router.refresh();
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto bg-paper text-ink sm:max-w-lg"
      >
        <SheetHeader className="px-6 pt-8 pb-2">
          <div className="display-eyebrow text-ink/55">Log spend</div>
          <SheetTitle className="mt-3 font-fraunces text-[28px] leading-none tracking-tight text-ink">
            A moment of money
          </SheetTitle>
          <SheetDescription className="sr-only">
            Record a spend, tag it, and let the math update.
          </SheetDescription>
        </SheetHeader>

        <AnimatePresence initial={false}>
          {error && (
            <motion.div
              key="err"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.28, ease: EASE }}
              className="mx-6 mt-4 border-l-2 border-[var(--overdue)] bg-paper px-3 py-2 text-[13px] leading-relaxed text-ink/80"
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex flex-col gap-7 px-6 pt-6 pb-32">
          <Row label="Wallet">
            <Select
              items={wallets.map((w) => ({ value: w.id, label: w.name }))}
              value={walletId}
              onValueChange={(v) => v && setWalletId(v)}
            >
              <SelectTrigger className="h-10 w-full">
                <SelectValue placeholder="Pick a wallet" />
              </SelectTrigger>
              <SelectContent>
                {sortWallets(wallets).map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    <span>{w.name}</span>
                    {w.is_holding && w.balanceBase !== undefined && (
                      <span className="ml-2 text-ink/50 tabular">
                        {formatMoney(w.balanceBase, baseCurrency, {
                          compact: true,
                        })}
                      </span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>

          <Hairline />

          <div className="grid grid-cols-[1fr_auto] items-start gap-5">
            <Row label="Amount">
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="h-11 flex-1 text-right tabular text-[16px]"
                />
                <Select
                  items={currencies.map((c) => ({ value: c, label: c }))}
                  value={currency}
                  onValueChange={(v) => v && setCurrency(v)}
                >
                  <SelectTrigger className="h-11 w-[84px] shrink-0">
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

            <div className="pt-7">
              <SafeToSpendImpactDial
                proposedAmountBase={amountBase}
                baseline={safeToSpendBaseline}
              />
            </div>
          </div>

          {sanity.status !== "ok" && (
            <PriceTypoGuard
              result={sanity}
              onApplyFix={(v) => setAmount(String(v))}
            />
          )}

          <Row label="Date">
            <Input
              type="date"
              value={spentAt}
              onChange={(e) => setSpentAt(e.target.value)}
              className="h-10 w-[180px] tabular"
            />
          </Row>

          <Hairline />

          <Row label="Description">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What was it"
              rows={2}
              className="min-h-[44px] resize-none"
            />
          </Row>

          {visibleSuggestions.length > 0 && (
            <div className="-mt-3">
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
            />
          </Row>

          <Row label="Notes" optional>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything to remember"
              rows={2}
              className="min-h-[44px] resize-none"
            />
          </Row>

          <Hairline />

          <div className="flex items-center justify-between gap-4">
            <span className="text-[13px] font-medium text-ink">
              Business-relevant
            </span>
            <Switch
              checked={businessRelevant}
              onCheckedChange={setBusinessRelevant}
            />
          </div>

          <Row label="VAT" optional>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                placeholder="0.00"
                value={vat}
                onChange={(e) => setVat(e.target.value)}
                className="h-10 w-40 text-right tabular"
              />
              <span className="text-[12px] text-ink/55 tabular">
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
              <span className="text-[13px] font-medium text-ink">
                Add items
              </span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 text-ink/55 transition-transform duration-300 ease-out",
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
                  transition={{ duration: 0.32, ease: EASE }}
                  className="overflow-hidden"
                >
                  <div className="mt-4 flex flex-col gap-4">
                    <AnimatePresence initial={false}>
                      {items.map((it, i) => (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.24, ease: EASE }}
                          className="border-l border-ink/10 pl-4"
                        >
                          <div className="flex items-start gap-2">
                            <Input
                              value={it.name}
                              onChange={(e) =>
                                setItem(i, { name: e.target.value })
                              }
                              placeholder="Item"
                              className="h-10 flex-1"
                            />
                            <Input
                              type="number"
                              inputMode="decimal"
                              step="0.01"
                              value={it.amount}
                              onChange={(e) =>
                                setItem(i, { amount: e.target.value })
                              }
                              placeholder="0.00"
                              className="h-10 w-28 text-right tabular"
                            />
                            <button
                              type="button"
                              onClick={() => removeItem(i)}
                              className="grid size-10 place-items-center text-ink/40 transition-colors duration-300 ease-out hover:text-[var(--overdue)]"
                              aria-label="Remove item"
                            >
                              <X className="h-4 w-4" />
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
                        </motion.div>
                      ))}
                    </AnimatePresence>
                    <button
                      type="button"
                      onClick={addItem}
                      className="inline-flex h-9 w-fit items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-ink/75 transition-colors duration-300 ease-out hover:bg-ink/[0.05] hover:text-ink"
                    >
                      <Plus className="h-3.5 w-3.5" />
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
                    className="h-10 w-20 text-right tabular"
                  />
                  <span className="text-[13px] text-ink/55">
                    {coversPeriods === 1 ? "period" : "periods"}
                  </span>
                </div>
              </Row>
            </>
          )}

          {/* Spacer so the sticky footer never crowds the last field. */}
          <div className="h-2" />
        </div>

        <div className="sticky bottom-0 border-t border-ink/10 bg-paper/85 px-6 py-4 supports-backdrop-filter:backdrop-blur-md">
          <button
            type="button"
            onClick={save}
            disabled={pending || !walletId || amountNum <= 0}
            className={cn(
              "inline-flex h-11 w-full items-center justify-center rounded-lg text-[14px] font-medium tracking-tight",
              "bg-[var(--brand)] text-[var(--brand-foreground)]",
              "transition-[transform,filter,opacity] duration-300 ease-out",
              "hover:brightness-[0.97] active:translate-y-px",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {pending ? "Saving" : "Save spend"}
          </button>
        </div>
      </SheetContent>
    </Sheet>
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
    <div className="flex flex-col gap-2">
      <Label className="text-[11px] uppercase tracking-[0.18em] text-ink/55">
        {label}
        {optional && (
          <span className="ml-1 text-ink/35 normal-case tracking-normal">
            optional
          </span>
        )}
      </Label>
      {children}
    </div>
  );
}

function Hairline() {
  return <div className="h-px w-full bg-ink/10" />;
}

function CategoryChips({
  categories,
  selected,
  onToggle,
}: {
  categories: SpendCategory[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  if (categories.length === 0) {
    return (
      <p className="text-[12px] text-ink/55">
        No categories yet — add some in settings.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {categories.map((c) => {
        const on = selected.includes(c.id);
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onToggle(c.id)}
            className={cn(
              "rounded-full border-[1.5px] px-3 py-1.5 text-[13px] font-medium transition-colors duration-300 ease-out",
              on
                ? "border-ink bg-ink text-paper"
                : "border-ink/20 text-ink hover:bg-ink/[0.05]",
            )}
          >
            {c.name}
          </button>
        );
      })}
    </div>
  );
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

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
