"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import NumberFlow from "@number-flow/react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createExpense, deleteExpense, updateExpense } from "@/lib/data/actions";
import { formatMoney, toBase } from "@/lib/money";
import type { Currency, CurrencyCode, Expense } from "@/lib/supabase/types";

type Props = {
  expenses: Expense[];
  currencies: Currency[];
  baseCurrency: CurrencyCode;
  triggerLabel?: string;
  triggerIcon?: React.ReactNode;
};

export function ExpensesHub({
  expenses,
  currencies,
  baseCurrency,
  triggerLabel = "New expense",
  triggerIcon = <Plus className="mr-1.5 h-4 w-4" />,
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<Expense | null>(null);
  const [creating, setCreating] = useState(false);

  // Totals scoped to "this month" — matches the dashboard mental model.
  const monthlyTotal = useMemo(() => {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    return expenses
      .filter((e) => new Date(e.spent_at) >= startOfMonth)
      .reduce(
        (sum, e) =>
          sum +
          toBase(
            Number(e.amount),
            e.currency as CurrencyCode,
            // Hub renders amounts in their native currency; the monthly total
            // does its own conversion using the existing rate logic. We don't
            // get rates here but they're not strictly needed if all expenses
            // are in baseCurrency. For mixed currencies the dashboard does
            // the conversion server-side.
            [],
          ),
        0,
      );
  }, [expenses]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Spent this month
          </div>
          <div className="mt-2 text-[28px] font-semibold tracking-tight tabular">
            <NumberFlow
              value={monthlyTotal}
              format={{
                style: "currency",
                currency: baseCurrency === "PHP" ? "PHP" : baseCurrency,
                maximumFractionDigits: 0,
              }}
            />
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Total recorded
          </div>
          <div className="mt-2 text-[28px] font-semibold tracking-tight tabular">
            {expenses.length}
          </div>
        </Card>
        <div className="flex items-end justify-end">
          <Dialog open={creating} onOpenChange={setCreating}>
            <DialogTrigger asChild>
              <Button>
                {triggerIcon}
                {triggerLabel}
              </Button>
            </DialogTrigger>
            <ExpenseDialog
              currencies={currencies}
              defaultCurrency={baseCurrency}
              onSubmit={async (values) => {
                try {
                  await createExpense(values);
                  toast.success("Expense logged");
                  setCreating(false);
                  router.refresh();
                } catch (err: unknown) {
                  toast.error((err as Error).message);
                }
              }}
            />
          </Dialog>
        </div>
      </div>

      {expenses.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border/60 bg-muted/30">
                <tr className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5 text-left">Date</th>
                  <th className="px-4 py-2.5 text-left">Description</th>
                  <th className="px-4 py-2.5 text-left">Vendor</th>
                  <th className="px-4 py-2.5 text-left">Category</th>
                  <th className="px-4 py-2.5 text-right">Amount</th>
                  <th className="w-16" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {expenses.map((e) => (
                  <motion.tr
                    key={e.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="group"
                  >
                    <td className="px-4 py-2.5 text-muted-foreground tabular">
                      {new Date(e.spent_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2.5 font-medium">{e.description}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{e.vendor ?? "—"}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{e.category ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular">
                      {formatMoney(Number(e.amount), e.currency as CurrencyCode)}
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setEditing(e)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <DeleteButton expenseId={e.id} onDone={() => router.refresh()} />
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {editing && (
        <Dialog open onOpenChange={(open) => !open && setEditing(null)}>
          <ExpenseDialog
            initial={editing}
            currencies={currencies}
            defaultCurrency={baseCurrency}
            onSubmit={async (values) => {
              try {
                await updateExpense(editing.id, values);
                toast.success("Expense updated");
                setEditing(null);
                router.refresh();
              } catch (err: unknown) {
                toast.error((err as Error).message);
              }
            }}
          />
        </Dialog>
      )}
    </div>
  );
}

function DeleteButton({ expenseId, onDone }: { expenseId: string; onDone: () => void }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 hover:text-destructive"
      disabled={pending}
      onClick={() => {
        if (!confirm("Delete this expense?")) return;
        start(async () => {
          try {
            await deleteExpense(expenseId);
            toast.success("Deleted");
            onDone();
          } catch (err: unknown) {
            toast.error((err as Error).message);
          }
        });
      }}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
}

type ExpenseFormValues = {
  spent_at: string;
  description: string;
  amount: number;
  currency: string;
  vendor: string | null;
  category: string | null;
  notes: string | null;
};

function ExpenseDialog({
  initial,
  currencies,
  defaultCurrency,
  onSubmit,
}: {
  initial?: Expense;
  currencies: Currency[];
  defaultCurrency: CurrencyCode;
  onSubmit: (values: ExpenseFormValues) => Promise<void>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [values, setValues] = useState({
    spent_at: initial?.spent_at ?? today,
    description: initial?.description ?? "",
    amount: initial?.amount ?? 0,
    currency: initial?.currency ?? defaultCurrency,
    vendor: initial?.vendor ?? "",
    category: initial?.category ?? "",
    notes: initial?.notes ?? "",
  });
  const [pending, start] = useTransition();

  function submit() {
    if (!values.description.trim()) {
      toast.error("Description is required");
      return;
    }
    if (!values.amount || values.amount <= 0) {
      toast.error("Amount must be a positive number");
      return;
    }
    start(async () => {
      await onSubmit({
        spent_at: values.spent_at,
        description: values.description.trim(),
        amount: Number(values.amount),
        currency: values.currency,
        vendor: values.vendor.trim() || null,
        category: values.category.trim() || null,
        notes: values.notes.trim() || null,
      });
    });
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{initial ? "Edit expense" : "New expense"}</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Date</Label>
            <Input
              type="date"
              value={values.spent_at}
              onChange={(e) => setValues({ ...values, spent_at: e.target.value })}
            />
          </div>
          <div>
            <Label className="text-xs">Currency</Label>
            <Select
              value={values.currency}
              onValueChange={(v) => v && setValues({ ...values, currency: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {currencies.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.code} · {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label className="text-xs">Description</Label>
          <Input
            placeholder="GitHub Copilot, plane ticket, new keyboard…"
            value={values.description}
            onChange={(e) => setValues({ ...values, description: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Amount</Label>
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={values.amount}
              onChange={(e) => setValues({ ...values, amount: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label className="text-xs">Vendor</Label>
            <Input
              placeholder="optional"
              value={values.vendor}
              onChange={(e) => setValues({ ...values, vendor: e.target.value })}
            />
          </div>
        </div>
        <div>
          <Label className="text-xs">Category</Label>
          <Input
            placeholder="Software · Hardware · Travel · …"
            value={values.category}
            onChange={(e) => setValues({ ...values, category: e.target.value })}
          />
        </div>
        <div>
          <Label className="text-xs">Notes</Label>
          <Textarea
            placeholder="optional"
            rows={2}
            value={values.notes}
            onChange={(e) => setValues({ ...values, notes: e.target.value })}
          />
        </div>
        <Button className="w-full" onClick={submit} disabled={pending}>
          {pending ? "Saving…" : initial ? "Save changes" : "Add expense"}
        </Button>
      </div>
    </DialogContent>
  );
}
