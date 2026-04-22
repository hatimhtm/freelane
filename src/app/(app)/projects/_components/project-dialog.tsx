"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  addPayment,
  createProject,
  deletePayment,
  deleteProject,
  updateProject,
} from "@/lib/data/actions";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import { KANBAN_COLUMNS } from "@/lib/constants";
import type { Client, Payment, Project, ProjectStatus } from "@/lib/supabase/types";
import { formatMoney } from "@/lib/money";

const CURRENCIES = ["PHP", "MAD", "USD", "EUR", "CNY"];

export function ProjectDialog({
  open,
  onOpenChange,
  clients,
  project,
  defaultStatus = "quoted",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clients: Client[];
  project?: Project;
  defaultStatus?: ProjectStatus;
}) {
  const [state, setState] = useState<Partial<Project>>({});
  const [payments, setPayments] = useState<Payment[]>([]);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    if (project) {
      setState(project);
      loadPayments(project.id);
    } else {
      setState({
        status: defaultStatus,
        currency: clients[0]?.default_currency ?? "PHP",
        client_id: clients[0]?.id,
      });
      setPayments([]);
    }
  }, [open, project, defaultStatus, clients]);

  async function loadPayments(projectId: string) {
    const supabase = createBrowserSupabase();
    const { data } = await supabase
      .from("payments")
      .select("*")
      .eq("project_id", projectId)
      .order("paid_at", { ascending: false });
    setPayments((data ?? []) as Payment[]);
  }

  function update<K extends keyof Project>(key: K, value: Project[K] | null | undefined) {
    setState((prev) => ({ ...prev, [key]: value }));
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!state.title?.trim() || !state.client_id) {
      toast.error("Title and client are required");
      return;
    }
    start(async () => {
      try {
        if (project) {
          await updateProject(project.id, {
            client_id: state.client_id!,
            title: state.title!,
            description: state.description ?? "",
            amount: Number(state.amount ?? 0),
            currency: state.currency ?? "PHP",
            status: state.status,
            due_date: state.due_date ?? null,
          });
          toast.success("Project updated");
        } else {
          await createProject({
            client_id: state.client_id!,
            title: state.title!,
            description: state.description ?? "",
            amount: Number(state.amount ?? 0),
            currency: state.currency ?? "PHP",
            status: state.status ?? defaultStatus,
            due_date: state.due_date ?? null,
          });
          toast.success("Project created");
        }
        onOpenChange(false);
      } catch (err: unknown) {
        toast.error((err as Error).message);
      }
    });
  }

  async function onDelete() {
    if (!project) return;
    if (!confirm("Delete this project and all its payments?")) return;
    try {
      await deleteProject(project.id);
      toast.success("Project deleted");
      onOpenChange(false);
    } catch (err: unknown) {
      toast.error((err as Error).message);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto scroll-muted">
        <form onSubmit={onSubmit} className="flex h-full flex-col">
          <SheetHeader>
            <SheetTitle>{project ? "Edit project" : "New project"}</SheetTitle>
            <SheetDescription>
              {project ? "Tweak the details or log a new payment." : "Add a project for a client."}
            </SheetDescription>
          </SheetHeader>

          <div className="grid gap-5 px-4 py-6">
            <Field label="Title" required>
              <Input
                value={state.title ?? ""}
                onChange={(e) => update("title", e.target.value)}
                placeholder="iOS MVP — Phase 1"
                autoFocus
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Client" required>
                <Select
                  value={state.client_id}
                  onValueChange={(v) => {
                    const c = clients.find((x) => x.id === v);
                    update("client_id", v);
                    if (c?.default_currency && !project) update("currency", c.default_currency);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pick a client" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Status">
                <Select
                  value={state.status as string}
                  onValueChange={(v) => update("status", v as ProjectStatus)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KANBAN_COLUMNS.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-[1fr_120px] gap-4">
              <Field label="Amount">
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  value={state.amount ?? ""}
                  onChange={(e) => update("amount", Number(e.target.value))}
                  placeholder="0.00"
                />
              </Field>
              <Field label="Currency">
                <Select
                  value={state.currency}
                  onValueChange={(v) => update("currency", v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field label="Due date">
              <Input
                type="date"
                value={state.due_date ?? ""}
                onChange={(e) => update("due_date", e.target.value || null)}
              />
            </Field>

            <Field label="Description">
              <Textarea
                value={state.description ?? ""}
                onChange={(e) => update("description", e.target.value)}
                rows={3}
                placeholder="Short description that'll appear on invoices…"
              />
            </Field>

            {project && (
              <>
                <Separator />
                <PaymentsSection
                  project={project}
                  payments={payments}
                  onRefresh={() => loadPayments(project.id)}
                />
              </>
            )}
          </div>

          <SheetFooter className="mt-auto flex-row justify-between border-t border-border/60 bg-background/70 backdrop-blur">
            {project ? (
              <Button type="button" variant="ghost" onClick={onDelete} className="text-destructive">
                <Trash2 className="mr-1.5 h-4 w-4" />
                Delete
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : project ? "Save changes" : "Create project"}
              </Button>
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function PaymentsSection({
  project,
  payments,
  onRefresh,
}: {
  project: Project;
  payments: Payment[];
  onRefresh: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("");
  const [pending, start] = useTransition();

  const totalPaid = payments
    .filter((p) => p.currency === project.currency)
    .reduce((s, p) => s + Number(p.amount), 0);
  const outstanding = Math.max(0, Number(project.amount) - totalPaid);

  function onAdd(event: React.FormEvent) {
    event.preventDefault();
    const n = Number(amount);
    if (!n || n <= 0) {
      toast.error("Enter a positive amount");
      return;
    }
    start(async () => {
      try {
        await addPayment({
          project_id: project.id,
          amount: n,
          currency: project.currency,
          paid_at: paidAt,
          method: method || undefined,
        });
        setAmount("");
        setMethod("");
        onRefresh();
        toast.success("Payment logged");
      } catch (err: unknown) {
        toast.error((err as Error).message);
      }
    });
  }

  async function onRemove(id: string) {
    try {
      await deletePayment(id);
      onRefresh();
      toast.success("Payment removed");
    } catch (err: unknown) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Payments
        </div>
        <div className="text-xs tabular text-muted-foreground">
          {formatMoney(totalPaid, project.currency)} / {formatMoney(Number(project.amount), project.currency)}
          {outstanding > 0 && (
            <> · <span className="text-foreground">{formatMoney(outstanding, project.currency)} left</span></>
          )}
        </div>
      </div>

      <form onSubmit={onAdd} className="grid grid-cols-[1fr_130px_auto] gap-2">
        <Input
          type="number"
          inputMode="decimal"
          step="0.01"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
        <Button type="submit" size="icon" disabled={pending} aria-label="Add payment">
          <Plus className="h-4 w-4" />
        </Button>
      </form>
      <Input
        placeholder="Method (e.g. Wise, bank transfer) — optional"
        value={method}
        onChange={(e) => setMethod(e.target.value)}
        className="mt-2 h-8 text-xs"
      />

      {payments.length > 0 && (
        <ul className="mt-3 divide-y divide-border/60 rounded-lg border border-border/60 bg-muted/30">
          {payments.map((p) => (
            <li key={p.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <div>
                <div className="tabular">{formatMoney(Number(p.amount), p.currency)}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(p.paid_at).toLocaleDateString()}
                  {p.method && <> · {p.method}</>}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => onRemove(p.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
    </div>
  );
}
