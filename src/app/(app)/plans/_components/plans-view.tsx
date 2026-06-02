"use client";

import { useMemo, useState } from "react";
import { Plus, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PrimaryAction } from "@/components/app/primary-action";
import { MWidget } from "@/components/widgets/m-widget";

import { PlanModal } from "./plan-modal";
import { PlanDetailSheet } from "./plan-detail-sheet";

import { formatMoney } from "@/lib/money";
import type {
  CurrencyCode,
  PlannedSpend,
  PlanStrategy,
} from "@/lib/supabase/types";
import type { WalletOpt } from "@/app/(app)/spending/_components/spend-modal";

// Plans redesign view (2026-06).
//
// Header: Plans   [+ New plan]
// Active section: M widgets, one per active/planned plan. Card click
//   opens detail sheet. AI dot top-right via MWidget aiDot prop.
// Archive: <details> collapsed by default. Bought + abandoned +
//   cancelled rows. Per-row click opens detail sheet (read-only).
// Stat tiles (Wallets / Locked / Planned / Daily safe), cashflow atlas
// chart, pre-mortem cards, lock/unlock buttons, status sections — all
// REMOVED per brief.

export interface PlansViewProps {
  plans: PlannedSpend[];
  strategies: PlanStrategy[];
  wallets: WalletOpt[];
  baseCurrency: CurrencyCode;
  openNew: boolean;
  focusPlanId: string | null;
}

const ACTIVE_STATUSES = new Set(["active", "planned"]);
const ARCHIVE_STATUSES = new Set(["bought", "done", "cancelled", "abandoned"]);

export function PlansView({
  plans,
  strategies,
  wallets,
  baseCurrency,
  openNew,
  focusPlanId,
}: PlansViewProps) {
  const [modalOpen, setModalOpen] = useState(openNew);
  const [editingPlan, setEditingPlan] = useState<PlannedSpend | null>(null);
  const [detailPlan, setDetailPlan] = useState<PlannedSpend | null>(() => {
    if (!focusPlanId) return null;
    return plans.find((p) => p.id === focusPlanId) ?? null;
  });

  const { active, archive } = useMemo(() => {
    const a: PlannedSpend[] = [];
    const h: PlannedSpend[] = [];
    for (const p of plans) {
      if (ACTIVE_STATUSES.has(p.status)) a.push(p);
      else if (ARCHIVE_STATUSES.has(p.status)) h.push(p);
    }
    // Active sorted by target_date asc (no target_date → end), then by
    // planned_for. Archive by bought_at / planned_for desc.
    // A plan with no target_date must sort AFTER any target-dated plan,
    // not get its planned_for substituted into the comparator (which
    // produced interleaved order, sometimes ahead of target-dated plans).
    a.sort((x, y) => {
      const tx = x.target_date;
      const ty = y.target_date;
      if (!tx && !ty) {
        return (x.planned_for ?? "").localeCompare(y.planned_for ?? "");
      }
      if (!tx) return 1;
      if (!ty) return -1;
      return tx.localeCompare(ty);
    });
    h.sort((x, y) => {
      const tx = x.bought_at ?? x.planned_for ?? "";
      const ty = y.bought_at ?? y.planned_for ?? "";
      return ty.localeCompare(tx);
    });
    return { active: a, archive: h };
  }, [plans]);

  function openCreate() {
    setEditingPlan(null);
    setModalOpen(true);
  }

  return (
    <div className="mx-auto flex max-w-[1080px] flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-lg leading-tight">Plans</h1>
          <p className="text-xs text-muted-foreground">
            Big planned purchases the runway should know about.
          </p>
        </div>
        <Button onClick={openCreate} className="h-8 gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          New plan
        </Button>
      </header>

      {active.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/60 px-4 py-8 text-center text-xs text-muted-foreground">
          No active plans yet — start with a name and the AI will estimate the price.
        </div>
      ) : (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {active.map((p) => (
            <ActivePlanWidget
              key={p.id}
              plan={p}
              strategies={strategies.filter(
                (s) => s.plan_id === p.id && s.active,
              )}
              baseCurrency={baseCurrency}
              onOpen={() => setDetailPlan(p)}
            />
          ))}
        </section>
      )}

      {archive.length > 0 && (
        <details className="rounded-[10px] border border-border/60 bg-card/30">
          <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium text-foreground/80 hover:text-foreground">
            Archive · {archive.length}
          </summary>
          <ul className="flex flex-col divide-y divide-border/40 border-t border-border/40">
            {archive.map((p) => (
              <ArchiveRow
                key={p.id}
                plan={p}
                baseCurrency={baseCurrency}
                onOpen={() => setDetailPlan(p)}
              />
            ))}
          </ul>
        </details>
      )}

      <PlanModal
        open={modalOpen}
        onOpenChange={(v) => {
          setModalOpen(v);
          if (!v) setEditingPlan(null);
        }}
        editing={editingPlan}
        baseCurrency={baseCurrency}
      />

      {detailPlan && (
        <PlanDetailSheet
          open={!!detailPlan}
          onOpenChange={(v) => {
            if (!v) setDetailPlan(null);
          }}
          plan={detailPlan}
          strategies={strategies.filter((s) => s.plan_id === detailPlan.id)}
          wallets={wallets}
          baseCurrency={baseCurrency}
        />
      )}

      <PrimaryAction
        icon={Plus}
        label="New plan"
        ariaLabel="Create a new plan"
        onClick={openCreate}
      />
    </div>
  );
}

function ActivePlanWidget({
  plan,
  strategies,
  baseCurrency,
  onOpen,
}: {
  plan: PlannedSpend;
  strategies: PlanStrategy[];
  baseCurrency: CurrencyCode;
  onOpen: () => void;
}) {
  const price = Number(plan.expected_base ?? 0);
  const activeStrategy = strategies[0];
  // Progress bar — a rough "fraction of price covered IF the user
  // perfectly followed the active strategy every day since activation".
  // We do NOT measure actual category-spend deltas vs. baseline yet, so
  // the bar is a PROJECTION, not a measurement. Labelled accordingly
  // (see below) — lying motion bars erode trust faster than missing ones.
  const progressPct = (() => {
    if (!activeStrategy || !activeStrategy.activated_at) return 0;
    const m = Number(activeStrategy.monthly_save_estimate ?? 0);
    if (!(m > 0) || !(price > 0)) return 0;
    const daysActive =
      (Date.now() - new Date(activeStrategy.activated_at).getTime()) /
      86_400_000;
    const saved = (m / 30) * Math.max(0, daysActive);
    return Math.max(0, Math.min(100, Math.round((saved / price) * 100)));
  })();
  const hasActiveStrategy = !!(activeStrategy && activeStrategy.activated_at);

  const targetLine = plan.target_date
    ? `by ${formatTargetDate(plan.target_date)}`
    : null;

  return (
    <MWidget
      label={plan.label}
      eyebrow="Plan"
      icon={<Wallet className="h-4 w-4" />}
      hero={
        <span className="display-headline text-[28px] leading-none">
          {formatMoney(price, baseCurrency, { compact: true })}
        </span>
      }
      sub={
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-foreground">
            {plan.label}
          </span>
          <ProgressBar pct={progressPct} />
          {hasActiveStrategy && (
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              projected · {progressPct}%
            </span>
          )}
        </div>
      }
      supporting={
        <div className="flex flex-col gap-0.5">
          {targetLine && <span>{targetLine}</span>}
          {activeStrategy && (
            <span>strategy: {activeStrategy.title}</span>
          )}
        </div>
      }
      onOpen={onOpen}
      aiDot={{
        key: `plan.${plan.id}`,
        label: plan.label,
        data: {
          plan_id: plan.id,
          price_base: price,
          target_date: plan.target_date,
          status: plan.status,
        },
      }}
    />
  );
}

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/[0.08]">
      <div
        className="h-full rounded-full bg-foreground/60"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function ArchiveRow({
  plan,
  baseCurrency,
  onOpen,
}: {
  plan: PlannedSpend;
  baseCurrency: CurrencyCode;
  onOpen: () => void;
}) {
  // bought/done = a real receipt landed. abandoned/cancelled = the
  // money never moved, so the planned price isn't "spent" — render it
  // as the planned amount with a clear label so the eye doesn't read
  // an unspent ₱70k as money out.
  const wasBought = plan.status === "bought" || plan.status === "done";
  const actual = wasBought
    ? plan.bought_actual_price !== null
      ? Number(plan.bought_actual_price)
      : Number(plan.expected_base ?? 0)
    : Number(plan.expected_base ?? 0);
  const toneClass =
    plan.status === "bought" || plan.status === "done"
      ? "bg-[color:var(--lime,#a8c540)]/15 text-foreground/80"
      : "bg-foreground/[0.06] text-foreground/55";
  return (
    <li
      className="grid grid-cols-[1fr_auto] items-start gap-3 px-4 py-2.5 hover:bg-muted/40 cursor-pointer"
      onClick={onOpen}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-1.5">
          <span className="text-sm font-medium text-foreground">
            {plan.label}
          </span>
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${toneClass}`}
          >
            {plan.status}
          </span>
          {plan.satisfaction_rating !== null && (
            <span className="text-[11px] text-foreground/60">
              {"★".repeat(plan.satisfaction_rating)}
            </span>
          )}
        </div>
        {plan.satisfaction_note ? (
          <div className="text-[11px] text-muted-foreground">
            {plan.satisfaction_note.slice(0, 80)}
            {plan.satisfaction_note.length > 80 ? "..." : ""}
          </div>
        ) : plan.notes ? (
          <div className="text-[11px] text-muted-foreground">
            {plan.notes.slice(0, 80)}
            {plan.notes.length > 80 ? "..." : ""}
          </div>
        ) : null}
      </div>
      <div className="text-right">
        <div className="font-display tabular text-sm">
          {formatMoney(actual, baseCurrency, { compact: true })}
        </div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {wasBought
            ? (plan.bought_at ?? plan.planned_for)
            : `planned · ${plan.planned_for ?? ""}`}
        </div>
      </div>
    </li>
  );
}

function formatTargetDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
