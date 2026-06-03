"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import {
  createRecurringSpend,
  deleteRecurringSpend,
  updateRecurringSpend,
} from "@/lib/data/actions";
import type {
  Currency,
  CurrencyCode,
  PaymentMethod,
  RecurringSpend,
  RecurringScheduleKind,
} from "@/lib/supabase/types";

const SCHEDULES: { value: RecurringScheduleKind; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "weekly", label: "Weekly" },
  { value: "half_monthly", label: "Half-monthly" },
  { value: "every_n_months", label: "Every N months" },
  { value: "yearly", label: "Yearly" },
];

export function CyclesForm({
  rules,
  wallets,
  currencies,
  baseCurrency,
}: {
  rules: RecurringSpend[];
  wallets: PaymentMethod[];
  currencies: Currency[];
  baseCurrency: CurrencyCode;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<RecurringSpend | null>(null);
  const [creating, setCreating] = useState(false);
  const [, start] = useTransition();

  const active = rules.filter((r) => r.active);
  const paused = rules.filter((r) => !r.active);

  function onDelete(r: RecurringSpend) {
    if (!confirm(`Delete "${r.label}"? Past matched spends keep their links.`))
      return;
    start(async () => {
      try {
        await deleteRecurringSpend(r.id);
        toast.success("Cycle deleted");
        router.refresh();
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-border/60">
        {active.map((r, i) => (
          <CycleRow
            key={r.id}
            rule={r}
            wallets={wallets}
            baseCurrency={baseCurrency}
            last={i === active.length - 1 && paused.length === 0}
            onEdit={() => setEditing(r)}
            onDelete={() => onDelete(r)}
          />
        ))}
        {paused.map((r, i) => (
          <CycleRow
            key={r.id}
            rule={r}
            wallets={wallets}
            baseCurrency={baseCurrency}
            last={i === paused.length - 1}
            onEdit={() => setEditing(r)}
            onDelete={() => onDelete(r)}
          />
        ))}
        {rules.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No cycles yet.
          </div>
        )}
      </div>

      <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
        <Plus className="mr-1.5 h-3.5 w-3.5" /> Add cycle
      </Button>

      <Dialog open={creating} onOpenChange={setCreating}>
        <CycleDialog
          wallets={wallets}
          currencies={currencies}
          baseCurrency={baseCurrency}
          onSubmit={async (values) => {
            try {
              await createRecurringSpend(values);
              toast.success("Cycle added");
              setCreating(false);
              router.refresh();
            } catch (err) {
              toast.error((err as Error).message);
            }
          }}
        />
      </Dialog>
      {editing && (
        <Dialog open onOpenChange={(o) => !o && setEditing(null)}>
          <CycleDialog
            initial={editing}
            wallets={wallets}
            currencies={currencies}
            baseCurrency={baseCurrency}
            onSubmit={async (values) => {
              try {
                await updateRecurringSpend(editing.id, values);
                toast.success("Cycle updated");
                setEditing(null);
                router.refresh();
              } catch (err) {
                toast.error((err as Error).message);
              }
            }}
          />
        </Dialog>
      )}
    </div>
  );
}

function CycleRow({
  rule,
  wallets,
  baseCurrency,
  last,
  onEdit,
  onDelete,
}: {
  rule: RecurringSpend;
  wallets: PaymentMethod[];
  baseCurrency: CurrencyCode;
  last: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const wallet = wallets.find((w) => w.id === rule.wallet_id);
  const scheduleLabel =
    rule.schedule_kind === "monthly"
      ? `Monthly · day ${rule.day_of_month ?? "—"}`
      : rule.schedule_kind === "weekly"
        ? `Weekly · day ${rule.day_of_week ?? "—"}`
        : rule.schedule_kind === "half_monthly"
          ? "Twice a month"
          : rule.schedule_kind === "yearly"
            ? `Yearly · day ${rule.day_of_month ?? "—"}`
            : `Every ${rule.every_n_value ?? "—"} months`;
  return (
    <div
      className={cn(
        "group flex items-center gap-3 px-4 py-3",
        !last && "border-b border-border/50",
        !rule.active && "opacity-55",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{rule.label}</span>
          {!rule.active && (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              Paused
            </span>
          )}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground tabular">
          {formatMoney(
            Number(rule.expected_amount),
            (rule.expected_currency as CurrencyCode) ?? baseCurrency,
            { compact: true },
          )}{" "}
          · {scheduleLabel}
          {wallet ? ` · ${wallet.name}` : ""}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 max-md:opacity-100">
        <IconBtn onClick={onEdit} label="Edit">
          <Pencil className="h-3.5 w-3.5" />
        </IconBtn>
        <IconBtn onClick={onDelete} label="Delete" danger>
          <Trash2 className="h-3.5 w-3.5" />
        </IconBtn>
      </div>
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  label,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={cn(
        "grid size-7 max-md:size-9 place-items-center rounded-md text-muted-foreground hover:bg-muted",
        danger ? "hover:text-destructive" : "hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

type CycleValues = {
  label: string;
  expected_amount: number;
  expected_currency: string;
  schedule_kind: RecurringScheduleKind;
  day_of_month: number | null;
  day_of_week: number | null;
  every_n_value: number | null;
  wallet_id: string | null;
  active: boolean;
  notes: string | null;
};

function CycleDialog({
  initial,
  wallets,
  currencies,
  baseCurrency,
  onSubmit,
}: {
  initial?: RecurringSpend;
  wallets: PaymentMethod[];
  currencies: Currency[];
  baseCurrency: CurrencyCode;
  onSubmit: (v: CycleValues) => Promise<void>;
}) {
  const [v, setV] = useState<CycleValues>({
    label: initial?.label ?? "",
    expected_amount: Number(initial?.expected_amount ?? 0),
    expected_currency: (initial?.expected_currency as string) ?? baseCurrency,
    schedule_kind: (initial?.schedule_kind as RecurringScheduleKind) ?? "monthly",
    day_of_month: initial?.day_of_month ?? 1,
    day_of_week: initial?.day_of_week ?? 1,
    every_n_value: initial?.every_n_value ?? 1,
    wallet_id: initial?.wallet_id ?? null,
    active: initial?.active ?? true,
    notes: initial?.notes ?? "",
  });
  const [pending, start] = useTransition();
  const NONE = "__none__";

  function submit() {
    if (!v.label.trim()) {
      toast.error("Label is required");
      return;
    }
    if (!(Number(v.expected_amount) > 0)) {
      toast.error("Expected amount must be greater than 0");
      return;
    }
    start(async () => {
      await onSubmit({
        ...v,
        label: v.label.trim(),
        notes: v.notes?.trim() || null,
      });
    });
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{initial ? "Edit cycle" : "New cycle"}</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <Label className="text-xs">Label</Label>
          <Input
            value={v.label}
            onChange={(e) => setV({ ...v, label: e.target.value })}
            placeholder="Netflix · Wife allowance · Rent"
            autoFocus
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Expected amount</Label>
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={v.expected_amount}
              onChange={(e) =>
                setV({ ...v, expected_amount: Number(e.target.value) })
              }
            />
          </div>
          <div>
            <Label className="text-xs">Currency</Label>
            <Select
              value={v.expected_currency}
              onValueChange={(val) => val && setV({ ...v, expected_currency: val })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {currencies.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label className="text-xs">Schedule</Label>
          <Select
            value={v.schedule_kind}
            onValueChange={(val) =>
              val && setV({ ...v, schedule_kind: val as RecurringScheduleKind })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCHEDULES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {v.schedule_kind === "monthly" && (
          <div>
            <Label className="text-xs">Day of month</Label>
            <Input
              type="number"
              min="1"
              max="28"
              value={v.day_of_month ?? 1}
              onChange={(e) =>
                setV({ ...v, day_of_month: Number(e.target.value) })
              }
            />
          </div>
        )}
        {v.schedule_kind === "weekly" && (
          <div>
            <Label className="text-xs">Day of week (0–6)</Label>
            <Input
              type="number"
              min="0"
              max="6"
              value={v.day_of_week ?? 1}
              onChange={(e) =>
                setV({ ...v, day_of_week: Number(e.target.value) })
              }
            />
          </div>
        )}
        {v.schedule_kind === "every_n_months" && (
          <div>
            <Label className="text-xs">Every N months</Label>
            <Input
              type="number"
              min="1"
              value={v.every_n_value ?? 1}
              onChange={(e) =>
                setV({ ...v, every_n_value: Number(e.target.value) })
              }
            />
          </div>
        )}
        <div>
          <Label className="text-xs">Wallet</Label>
          <Select
            value={v.wallet_id ?? NONE}
            onValueChange={(val) =>
              setV({ ...v, wallet_id: !val || val === NONE ? null : val })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Any wallet" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Any wallet</SelectItem>
              {wallets.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
          <span className="min-w-0">
            <span className="block text-sm font-medium">Active</span>
            <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
              Paused cycles stay in the list for audit but stop triggering Today nudges.
            </span>
          </span>
          <Switch
            checked={v.active}
            onCheckedChange={(c) => setV({ ...v, active: c === true })}
            className="mt-0.5 shrink-0"
          />
        </label>
        <div>
          <Label className="text-xs">Notes</Label>
          <Input
            value={v.notes ?? ""}
            onChange={(e) => setV({ ...v, notes: e.target.value })}
            placeholder="optional"
          />
        </div>
        <Button className="w-full" onClick={submit} disabled={pending}>
          {pending ? "Saving…" : initial ? "Save changes" : "Add cycle"}
        </Button>
      </div>
    </DialogContent>
  );
}
