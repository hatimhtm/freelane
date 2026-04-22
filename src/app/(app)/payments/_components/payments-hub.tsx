"use client";

import { useMemo, useState } from "react";
import { motion } from "motion/react";
import NumberFlow from "@number-flow/react";
import {
  ArrowUpRight,
  ChevronRight,
  FileText,
  LayoutGrid,
  Rows3,
  CheckCircle2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatMoney, toBase } from "@/lib/money";
import type {
  Client,
  CurrencyCode,
  ExchangeRate,
  Invoice,
  Payment,
  Project,
} from "@/lib/supabase/types";
import { PaymentSheet } from "./payment-sheet";

type Props = {
  payments: Payment[];
  projects: Project[];
  clients: Client[];
  invoices: Invoice[];
  rates: ExchangeRate[];
  baseCurrency: CurrencyCode;
};

const PERIODS = [
  { id: "week",    label: "This week"    },
  { id: "month",   label: "This month"   },
  { id: "last",    label: "Last month"   },
  { id: "quarter", label: "Last 3 months"},
  { id: "year",    label: "This year"    },
  { id: "all",     label: "All time"     },
] as const;
type PeriodId = (typeof PERIODS)[number]["id"];

export function PaymentsHub({
  payments,
  projects,
  clients,
  invoices,
  rates,
  baseCurrency,
}: Props) {
  const [period, setPeriod] = useState<PeriodId>("month");
  const [view, setView] = useState<"cards" | "table">("cards");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Payment | null>(null);

  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const clientsById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  const invoicesById = useMemo(() => new Map(invoices.map((i) => [i.id, i])), [invoices]);

  const filtered = useMemo(() => {
    const now = new Date();
    const start = periodStart(period, now);
    const end = periodEnd(period, now);
    const q = query.trim().toLowerCase();

    return payments.filter((p) => {
      const d = new Date(p.paid_at);
      if (start && d < start) return false;
      if (end && d > end) return false;
      if (q) {
        const project = projectsById.get(p.project_id);
        const client = project ? clientsById.get(project.client_id) : undefined;
        const haystack = [
          project?.title,
          client?.name,
          p.method,
          p.reference,
          p.notes,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [payments, period, query, projectsById, clientsById]);

  const totalInBase = useMemo(
    () => filtered.reduce((s, p) => s + toBase(Number(p.amount), p.currency as CurrencyCode, rates), 0),
    [filtered, rates],
  );

  const pendingInBase = useMemo(() => {
    // Outstanding across all projects, regardless of period filter.
    let total = 0;
    for (const project of projects) {
      if (project.status === "paid" || project.status === "archived") continue;
      const paid = payments
        .filter((p) => p.project_id === project.id && p.currency === project.currency)
        .reduce((s, p) => s + Number(p.amount), 0);
      const outstanding = Math.max(0, Number(project.amount) - paid);
      total += toBase(outstanding, project.currency as CurrencyCode, rates);
    }
    return total;
  }, [projects, payments, rates]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr_1fr]">
        <HeroPending value={pendingInBase} currency={baseCurrency} />
        <PeriodStat label={PERIODS.find((p) => p.id === period)!.label} value={totalInBase} currency={baseCurrency} />
        <PeriodStat
          label="Received, all time"
          value={payments.reduce((s, p) => s + toBase(Number(p.amount), p.currency as CurrencyCode, rates), 0)}
          currency={baseCurrency}
          muted
        />
      </div>

      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <Select
              items={PERIODS.map((p) => ({ value: p.id, label: p.label }))}
              value={period}
              onValueChange={(v) => v && setPeriod(v as PeriodId)}
            >
              <SelectTrigger className="h-9 w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIODS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Search client, project, method…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-9 w-[260px]"
            />
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/40 p-0.5">
            <ViewToggle icon={LayoutGrid} label="Cards" active={view === "cards"} onClick={() => setView("cards")} />
            <ViewToggle icon={Rows3} label="Table" active={view === "table"} onClick={() => setView("table")} />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-muted-foreground">
            No payments match the filters.
          </div>
        ) : view === "cards" ? (
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((p, i) => (
              <PaymentCard
                key={p.id}
                payment={p}
                project={projectsById.get(p.project_id)}
                client={p.project_id ? clientsById.get(projectsById.get(p.project_id)?.client_id ?? "") : undefined}
                invoice={p.invoice_id ? invoicesById.get(p.invoice_id) ?? null : null}
                onOpen={() => setSelected(p)}
                index={i}
              />
            ))}
          </div>
        ) : (
          <PaymentsTable
            payments={filtered}
            projectsById={projectsById}
            clientsById={clientsById}
            invoicesById={invoicesById}
            onOpen={setSelected}
          />
        )}
      </Card>

      <PaymentSheet
        payment={selected}
        project={selected ? projectsById.get(selected.project_id) : undefined}
        client={
          selected
            ? clientsById.get(projectsById.get(selected.project_id)?.client_id ?? "")
            : undefined
        }
        invoice={
          selected?.invoice_id ? invoicesById.get(selected.invoice_id) ?? null : null
        }
        rates={rates}
        baseCurrency={baseCurrency}
        open={!!selected}
        onOpenChange={(v) => !v && setSelected(null)}
      />
    </div>
  );
}

function HeroPending({ value, currency }: { value: number; currency: CurrencyCode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <Card className="relative overflow-hidden border-[var(--brand)]/30 p-6">
        <div className="pointer-events-none absolute inset-0 brand-glow-strong" />
        <div className="relative">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand)] animate-pulse" />
            Pending · money you're owed
          </div>
          <div className="mt-3 text-[44px] font-semibold leading-none tracking-tight tabular">
            <NumberFlow
              value={value}
              format={{ style: "currency", currency: currency === "PHP" ? "PHP" : currency, maximumFractionDigits: 0 }}
            />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Sum of unpaid balances across all projects, converted to {currency} at your current rates.
          </p>
        </div>
      </Card>
    </motion.div>
  );
}

function PeriodStat({
  label,
  value,
  currency,
  muted,
}: {
  label: string;
  value: number;
  currency: CurrencyCode;
  muted?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.05 }}
    >
      <Card className="p-6">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {muted ? "Lifetime" : "Received in"}
        </div>
        <div className="mt-1 text-xs text-muted-foreground/80">{label}</div>
        <div className="mt-3 text-3xl font-semibold tracking-tight tabular">
          <NumberFlow
            value={value}
            format={{ style: "currency", currency: currency === "PHP" ? "PHP" : currency, maximumFractionDigits: 0 }}
          />
        </div>
      </Card>
    </motion.div>
  );
}

function ViewToggle({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
        active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function PaymentCard({
  payment,
  project,
  client,
  invoice,
  onOpen,
  index,
}: {
  payment: Payment;
  project?: Project;
  client?: Client;
  invoice?: Invoice | null;
  onOpen: () => void;
  index: number;
}) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.02 }}
      onClick={onOpen}
      className="group relative flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-4 text-left transition-all hover:border-border hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-emerald-500">
            <ArrowUpRight className="h-3.5 w-3.5" />
            <span className="text-xs font-medium">Received</span>
          </div>
          <div className="mt-1 text-lg font-semibold tabular">
            {formatMoney(Number(payment.amount), payment.currency as CurrencyCode)}
          </div>
        </div>
        {invoice && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--chart-5)]/15 px-2 py-0.5 text-[10px] font-medium text-[var(--chart-5)]">
            <CheckCircle2 className="h-2.5 w-2.5" />
            Invoiced
          </span>
        )}
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{project?.title ?? "—"}</div>
        <div className="truncate text-xs text-muted-foreground">
          {client?.name ?? "—"} · {new Date(payment.paid_at).toLocaleDateString()}
          {payment.method && <> · {payment.method}</>}
        </div>
      </div>
      <ChevronRight className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
    </motion.button>
  );
}

function PaymentsTable({
  payments,
  projectsById,
  clientsById,
  invoicesById,
  onOpen,
}: {
  payments: Payment[];
  projectsById: Map<string, Project>;
  clientsById: Map<string, Client>;
  invoicesById: Map<string, Invoice>;
  onOpen: (payment: Payment) => void;
}) {
  return (
    <div className="overflow-x-auto scroll-muted">
      <table className="w-full text-sm">
        <thead className="border-b border-border/60 bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-4 py-2.5 text-left">Date</th>
            <th className="px-4 py-2.5 text-left">Project</th>
            <th className="px-4 py-2.5 text-left">Client</th>
            <th className="px-4 py-2.5 text-left">Method</th>
            <th className="px-4 py-2.5 text-right">Amount</th>
            <th className="px-4 py-2.5 text-center">Invoice</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {payments.map((p) => {
            const project = projectsById.get(p.project_id);
            const client = project ? clientsById.get(project.client_id) : undefined;
            const invoice = p.invoice_id ? invoicesById.get(p.invoice_id) : null;
            return (
              <tr
                key={p.id}
                onClick={() => onOpen(p)}
                className="cursor-pointer transition-colors hover:bg-muted/40"
              >
                <td className="px-4 py-2.5 tabular text-muted-foreground">
                  {new Date(p.paid_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-2.5 font-medium">{project?.title ?? "—"}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{client?.name ?? "—"}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{p.method ?? "—"}</td>
                <td className="px-4 py-2.5 text-right tabular font-medium">
                  {formatMoney(Number(p.amount), p.currency as CurrencyCode)}
                </td>
                <td className="px-4 py-2.5 text-center">
                  {invoice ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--chart-5)]">
                      <FileText className="h-3 w-3" />
                      {invoice.invoice_number}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ────────────────────────────── period helpers ──
function startOfWeek(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  const diff = (day + 6) % 7; // Monday as start of week
  x.setDate(x.getDate() - diff);
  return x;
}

function periodStart(period: PeriodId, now: Date): Date | null {
  switch (period) {
    case "week":    return startOfWeek(now);
    case "month":   return new Date(now.getFullYear(), now.getMonth(), 1);
    case "last":    return new Date(now.getFullYear(), now.getMonth() - 1, 1);
    case "quarter": return new Date(now.getFullYear(), now.getMonth() - 2, 1);
    case "year":    return new Date(now.getFullYear(), 0, 1);
    case "all":     return null;
  }
}

function periodEnd(period: PeriodId, now: Date): Date | null {
  if (period === "last") {
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    end.setHours(23, 59, 59, 999);
    return end;
  }
  return null;
}
