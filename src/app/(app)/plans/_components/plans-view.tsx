"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Plus, Trash2, Unlock, Wallet } from "lucide-react";
import { toast } from "sonner";
import { motion } from "motion/react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CashflowAtlasChart } from "@/components/spending/cashflow-atlas-chart";
import { PrimaryAction } from "@/components/app/primary-action";
import { PlanModal } from "./plan-modal";
import { PreMortemCard } from "./pre-mortem-card";

import { formatMoney } from "@/lib/money";
import { cancelPlannedSpend, commitPlannedSpend, uncommitPlannedSpend, deletePlannedSpend } from "@/lib/data/actions";
import type { SafeToSpendBreakdown } from "@/lib/safe-to-spend";
import type { CashflowAtlas } from "@/lib/cashflow-atlas";
import type {
  CalmWeatherState,
  CurrencyCode,
  PlannedSpend,
  PlannedSpendStatus,
  SpendCategory,
} from "@/lib/supabase/types";
import type { WalletOpt } from "@/app/(app)/spending/_components/spend-modal";

const EASE = [0.22, 1, 0.36, 1] as const;

export interface PlansViewProps {
  plans: PlannedSpend[];
  bigPlans: PlannedSpend[];
  atlas: CashflowAtlas;
  safe: SafeToSpendBreakdown;
  walletTotal: number;
  wallets: WalletOpt[];
  spendCategories: SpendCategory[];
  currencies: string[];
  baseCurrency: CurrencyCode;
  forecastHeadline: string | null;
  forecastNarrative: string | null;
  calmWeather: CalmWeatherState | null;
  openNew: boolean;
  focusPlanId: string | null;
}

const STATUS_LABEL: Record<PlannedSpendStatus, string> = {
  planned: "Planned",
  committed: "Locked",
  done: "Done",
  cancelled: "Cancelled",
};

const STATUS_ORDER: PlannedSpendStatus[] = ["committed", "planned", "done", "cancelled"];

export function PlansView({
  plans,
  bigPlans,
  atlas,
  safe,
  walletTotal,
  wallets,
  spendCategories,
  currencies,
  baseCurrency,
  forecastHeadline,
  forecastNarrative,
  openNew,
  focusPlanId,
}: PlansViewProps) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(openNew);
  const [editingPlan, setEditingPlan] = useState<PlannedSpend | null>(null);
  // Plans the user just deleted/cancelled — optimistically hidden until
  // router.refresh() lands the fresh data so the UI feels instant.
  const [removedIds, setRemovedIds] = useState<Set<string>>(() => new Set());

  const visiblePlans = useMemo(
    () => plans.filter((p) => !removedIds.has(p.id)),
    [plans, removedIds],
  );

  const grouped = useMemo(() => groupByStatus(visiblePlans), [visiblePlans]);
  const committedTotal = useMemo(
    () => visiblePlans
      .filter((p) => p.status === "committed")
      .reduce((s, p) => s + Number(p.committed_base ?? p.expected_base ?? 0), 0),
    [visiblePlans],
  );
  const plannedActiveTotal = useMemo(
    () => visiblePlans
      .filter((p) => p.status === "planned")
      .reduce((s, p) => s + Number(p.expected_base ?? 0), 0),
    [visiblePlans],
  );

  function openCreate() {
    setEditingPlan(null);
    setModalOpen(true);
  }
  function openEdit(plan: PlannedSpend) {
    setEditingPlan(plan);
    setModalOpen(true);
  }

  return (
    <div className="mx-auto flex max-w-[1080px] flex-col gap-5 p-4 sm:p-6">
      {/* Page hero */}
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-lg leading-tight">Plans</h1>
          <p className="text-xs text-muted-foreground">
            Future outflows the runway is already counting against.
          </p>
        </div>
        <Button onClick={openCreate} className="h-8 gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          New plan
        </Button>
      </header>

      {/* Headline numbers */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Wallets" value={walletTotal} baseCurrency={baseCurrency} />
        <Stat
          label="Locked"
          value={committedTotal}
          baseCurrency={baseCurrency}
          accent={committedTotal > 0 ? "lime" : undefined}
        />
        <Stat label="Planned" value={plannedActiveTotal} baseCurrency={baseCurrency} />
        <Stat
          label="Daily safe"
          value={Math.round(safe.safeTodayBase)}
          baseCurrency={baseCurrency}
        />
      </section>

      {/* 90-day Pre-Commitment Runway atlas */}
      <CashflowAtlasChart
        atlas={atlas}
        baseCurrency={baseCurrency}
        headline={forecastHeadline ?? undefined}
        narrative={forecastNarrative ?? undefined}
      />

      {/* Pre-Mortem cards (one per big plan) */}
      {bigPlans.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-sm font-medium">
            Pre-Mortem · {bigPlans.length} big plan{bigPlans.length === 1 ? "" : "s"} on the horizon
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {bigPlans.slice(0, 4).map((plan) => (
              <PreMortemCard
                key={plan.id}
                plan={plan}
                atlas={atlas}
                walletTotal={walletTotal}
                baseCurrency={baseCurrency}
                highlighted={focusPlanId === plan.id}
                onCommit={() => doCommit(plan, router)}
                onUncommit={() => doUncommit(plan, router)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Status sections */}
      <section className="flex flex-col gap-4">
        {STATUS_ORDER.map((status) => {
          const list = grouped[status] ?? [];
          if (list.length === 0) return null;
          return (
            <PlanGroup
              key={status}
              status={status}
              plans={list}
              baseCurrency={baseCurrency}
              onEdit={openEdit}
              onCommit={(p) => doCommit(p, router)}
              onUncommit={(p) => doUncommit(p, router)}
              onCancel={(p) => {
                setRemovedIds((s) => new Set(s).add(p.id));
                doCancel(p, router);
              }}
              onDelete={(p) => {
                setRemovedIds((s) => new Set(s).add(p.id));
                doDelete(p, router);
              }}
            />
          );
        })}
        {visiblePlans.length === 0 && (
          <div className="rounded-md border border-dashed border-border/60 px-4 py-8 text-center text-xs text-muted-foreground">
            No plans yet — add one to start parking money before you spend it.
          </div>
        )}
      </section>

      <PlanModal
        open={modalOpen}
        onOpenChange={(v) => {
          setModalOpen(v);
          if (!v) setEditingPlan(null);
        }}
        editing={editingPlan}
        wallets={wallets}
        currencies={currencies}
        baseCurrency={baseCurrency}
        categories={spendCategories}
      />

      <PrimaryAction
        icon={Plus}
        label="New plan"
        ariaLabel="Create a new plan"
        onClick={openCreate}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  baseCurrency,
  accent,
}: {
  label: string;
  value: number;
  baseCurrency: CurrencyCode;
  accent?: "lime" | "terracotta";
}) {
  return (
    <div className="rounded-[10px] border border-border/60 bg-card/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={`font-display tabular text-base ${accent === "lime" ? "text-acid-lime" : accent === "terracotta" ? "text-overdue" : ""}`}
      >
        {formatMoney(value, baseCurrency, { compact: true })}
      </div>
    </div>
  );
}

function groupByStatus(plans: PlannedSpend[]) {
  const out: Record<PlannedSpendStatus, PlannedSpend[]> = {
    planned: [],
    committed: [],
    done: [],
    cancelled: [],
  };
  for (const p of plans) out[p.status].push(p);
  return out;
}

function PlanGroup({
  status,
  plans,
  baseCurrency,
  onEdit,
  onCommit,
  onUncommit,
  onCancel,
  onDelete,
}: {
  status: PlannedSpendStatus;
  plans: PlannedSpend[];
  baseCurrency: CurrencyCode;
  onEdit: (p: PlannedSpend) => void;
  onCommit: (p: PlannedSpend) => void;
  onUncommit: (p: PlannedSpend) => void;
  onCancel: (p: PlannedSpend) => void;
  onDelete: (p: PlannedSpend) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h3 className="font-display text-sm font-medium">{STATUS_LABEL[status]}</h3>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {plans.length} · {formatMoney(plans.reduce((s, p) => s + Number(p.expected_base ?? 0), 0), baseCurrency, { compact: true })}
        </span>
      </div>
      <ul className="flex flex-col divide-y divide-border/40 rounded-[10px] border border-border/50 bg-card/30">
        {plans.map((p) => (
          <PlanRow
            key={p.id}
            plan={p}
            baseCurrency={baseCurrency}
            onEdit={() => onEdit(p)}
            onCommit={() => onCommit(p)}
            onUncommit={() => onUncommit(p)}
            onCancel={() => onCancel(p)}
            onDelete={() => onDelete(p)}
          />
        ))}
      </ul>
    </div>
  );
}

function PlanRow({
  plan,
  baseCurrency,
  onEdit,
  onCommit,
  onUncommit,
  onCancel,
  onDelete,
}: {
  plan: PlannedSpend;
  baseCurrency: CurrencyCode;
  onEdit: () => void;
  onCommit: () => void;
  onUncommit: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const isLocked = plan.status === "committed";
  const isDone = plan.status === "done";
  const isCancelled = plan.status === "cancelled";
  return (
    <li
      className="grid grid-cols-[1fr_auto] items-start gap-3 px-3 py-2.5 hover:bg-muted/40"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        onEdit();
      }}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-1.5">
          <span className="text-sm font-medium text-foreground">{plan.label}</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {plan.certainty}
          </span>
          {plan.is_big_plan && (
            <Badge variant="outline" className="h-4 px-1 text-[9px] tracking-wide">
              BIG
            </Badge>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {plan.planned_for}
          {plan.planned_for_window_days ? ` ±${plan.planned_for_window_days}d` : ""}
          {plan.notes ? ` · ${plan.notes.slice(0, 80)}${plan.notes.length > 80 ? "…" : ""}` : ""}
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-right">
        <div className="font-display tabular text-sm">
          {formatMoney(Number(plan.expected_base ?? 0), baseCurrency, { compact: true })}
        </div>
        {!isDone && !isCancelled && (
          <>
            {isLocked ? (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onUncommit();
                }}
                aria-label={`Unlock plan ${plan.label}`}
                title="Unlock"
              >
                <Unlock className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onCommit();
                }}
                aria-label={`Lock money for ${plan.label}`}
                title="Lock for this"
              >
                <Lock className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={(e) => {
                e.stopPropagation();
                onCancel();
              }}
              aria-label={`Cancel plan ${plan.label}`}
              title="Cancel"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
        {(isDone || isCancelled) && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            aria-label={`Delete plan ${plan.label} from history`}
            title="Delete from history"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </li>
  );
}

function doCommit(plan: PlannedSpend, router: ReturnType<typeof useRouter>) {
  void (async () => {
    try {
      await commitPlannedSpend(plan.id);
      toast.success(`Locked ${plan.label}`);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  })();
}

function doUncommit(plan: PlannedSpend, router: ReturnType<typeof useRouter>) {
  void (async () => {
    try {
      await uncommitPlannedSpend(plan.id);
      toast.success(`Unlocked ${plan.label}`);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  })();
}

function doCancel(plan: PlannedSpend, router: ReturnType<typeof useRouter>) {
  void (async () => {
    try {
      await cancelPlannedSpend(plan.id);
      toast.success(`Cancelled ${plan.label}`);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  })();
}

function doDelete(plan: PlannedSpend, router: ReturnType<typeof useRouter>) {
  void (async () => {
    try {
      await deletePlannedSpend(plan.id);
      toast.success(`Deleted ${plan.label}`);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  })();
}
