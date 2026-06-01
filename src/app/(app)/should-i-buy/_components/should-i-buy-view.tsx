"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Sparkles, ShoppingBag, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  askShouldIBuyAction,
  deleteShouldIBuySessionAction,
  recordShouldIBuyDecisionAction,
} from "@/lib/data/actions";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { CurrencyCode, ShouldIBuySession, ShouldIBuyVerdict } from "@/lib/supabase/types";

const CURRENCIES = ["PHP", "MAD", "USD", "EUR", "CNY"];

const VERDICT_LABEL: Record<ShouldIBuyVerdict | "unknown", string> = {
  easy_yes: "Easy yes",
  fits_the_stretch: "Fits the stretch",
  tight_but_possible: "Tight but possible",
  not_this_stretch: "Not this stretch",
  unknown: "Pending",
};

const VERDICT_TONE: Record<ShouldIBuyVerdict | "unknown", string> = {
  easy_yes: "border-acid-lime/50 text-acid-lime bg-acid-lime/5",
  fits_the_stretch: "border-foreground/30 text-foreground/80 bg-foreground/[0.03]",
  tight_but_possible: "border-amber-400/40 text-amber-500 bg-amber-400/5",
  not_this_stretch: "border-overdue/50 text-overdue bg-overdue/5",
  unknown: "border-border text-muted-foreground",
};

interface ShouldIBuyViewProps {
  sessions: ShouldIBuySession[];
  baseCurrency: CurrencyCode;
}

function formatSessionDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function ShouldIBuyView({ sessions, baseCurrency }: ShouldIBuyViewProps) {
  const router = useRouter();
  const [item, setItem] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(baseCurrency);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [lastResult, setLastResult] = useState<{ narrative: string | null; verdict: string | null } | null>(null);

  function reset() {
    setItem("");
    setAmount("");
    setNote("");
    setCurrency(baseCurrency);
  }

  const showBasePreview = currency !== baseCurrency && amount.trim() !== "" && Number(amount) > 0;

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="font-display text-lg leading-tight">Should I buy this?</h1>
          <p className="text-xs text-muted-foreground">
            Quick read against the current stretch. The verdict is a mirror, not a command.
          </p>
        </div>
      </header>

      {/* Ask form */}
      <section className="rounded-[14px] border border-border/60 bg-card/40 p-4">
        <div className="grid gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Item</Label>
            <Input
              value={item}
              onChange={(e) => setItem(e.target.value)}
              placeholder="A chair · A new monitor · Eid clothes for wife"
              className="h-9 text-sm"
            />
          </div>
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Amount</Label>
              <Input
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="h-9 text-right tabular text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Currency</Label>
              <Select items={CURRENCIES.map((c) => ({ value: c, label: c }))} value={currency} onValueChange={(v) => v && setCurrency(v as CurrencyCode)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {showBasePreview && (
            <p className="-mt-1.5 text-[11px] tabular text-muted-foreground">
              At session time, this gets locked in {baseCurrency} from your latest rate.
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Note <span className="ml-1 normal-case tracking-normal text-muted-foreground/60">optional</span>
            </Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What kind of decision is this? Anything you want weighed?"
              rows={2}
              className="resize-none text-sm"
            />
          </div>
          <div className="flex justify-end">
            <Button
              disabled={pending || !item.trim() || !amount.trim()}
              onClick={() =>
                start(async () => {
                  try {
                    const res = await askShouldIBuyAction({
                      item: item.trim(),
                      amount: Number(amount),
                      currency,
                      note: note.trim() || undefined,
                    });
                    if (res) {
                      setLastResult({ narrative: res.narrative, verdict: res.verdict });
                      toast.success("Read written.");
                      reset();
                      router.refresh();
                    } else {
                      toast.error("Couldn't write the read.");
                    }
                  } catch (err) {
                    toast.error((err as Error).message);
                  }
                })
              }
              className="gap-1.5"
            >
              <Sparkles className={cn("h-3.5 w-3.5", pending && "animate-pulse")} />
              {pending ? "Reading…" : "Ask"}
            </Button>
          </div>
        </div>

        {lastResult && lastResult.narrative && (
          <div className="mt-3 rounded-md border border-border/40 bg-muted/30 px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Latest read</span>
              {lastResult.verdict && (
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider",
                    VERDICT_TONE[(lastResult.verdict as ShouldIBuyVerdict) ?? "unknown"],
                  )}
                >
                  {VERDICT_LABEL[(lastResult.verdict as ShouldIBuyVerdict) ?? "unknown"]}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm leading-snug text-foreground">{lastResult.narrative}</p>
          </div>
        )}
      </section>

      {/* History */}
      <section className="flex flex-col gap-2">
        <h2 className="font-display text-sm font-medium">Recent reads</h2>
        {sessions.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/60 px-4 py-8 text-center text-xs text-muted-foreground">
            Nothing yet. Ask about an item above to get the first read.
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-border/40 overflow-hidden rounded-[10px] border border-border/50 bg-card/30">
            {sessions.map((s) => (
              <SessionRow key={s.id} session={s} baseCurrency={baseCurrency} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SessionRow({ session, baseCurrency }: { session: ShouldIBuySession; baseCurrency: CurrencyCode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const verdictKey: ShouldIBuyVerdict | "unknown" = (session.verdict as ShouldIBuyVerdict | null) ?? "unknown";
  const decided = session.bought !== null;
  const stamp = decided ? formatSessionDate(session.decided_at) : formatSessionDate(session.created_at);
  const stampLabel = decided ? (session.bought ? "Bought" : "Passed") : "Asked";
  return (
    <li className="grid grid-cols-[1fr_auto] items-start gap-3 px-3 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <ShoppingBag className="h-3 w-3 shrink-0 text-foreground/70" />
          <span className="text-sm font-medium text-foreground">{session.item}</span>
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider",
              VERDICT_TONE[verdictKey],
            )}
          >
            {VERDICT_LABEL[verdictKey]}
          </span>
          {session.bought === true && (
            <span className="rounded-full border border-acid-lime/40 bg-acid-lime/5 px-2 py-0.5 text-[10px] uppercase tracking-wider text-acid-lime">
              Bought
            </span>
          )}
          {session.bought === false && (
            <span className="rounded-full border border-overdue/40 bg-overdue/5 px-2 py-0.5 text-[10px] uppercase tracking-wider text-overdue">
              Passed
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[11px] tabular text-muted-foreground">
          {formatMoney(Number(session.amount_base ?? 0), baseCurrency, { compact: true })}
          {session.currency !== baseCurrency && (
            <> · {session.currency} {Number(session.amount).toFixed(2)}</>
          )}
          {stamp && (
            <> · {stampLabel} {stamp}</>
          )}
        </div>
        {session.narrative && (
          <p className="mt-1.5 text-[12px] leading-relaxed text-foreground/85">{session.narrative}</p>
        )}
      </div>
      <div className="flex items-center gap-1">
        {session.bought === null && (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Mark as bought"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await recordShouldIBuyDecisionAction({ sessionId: session.id, bought: true });
                  toast.success("Marked bought.");
                  router.refresh();
                })
              }
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Mark as passed"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await recordShouldIBuyDecisionAction({ sessionId: session.id, bought: false });
                  toast.success("Marked passed.");
                  router.refresh();
                })
              }
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Delete read"
          onClick={async () => {
            try {
              await deleteShouldIBuySessionAction(session.id);
              toast.success("Removed.");
              router.refresh();
            } catch (err) {
              toast.error((err as Error).message);
            }
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </li>
  );
}
