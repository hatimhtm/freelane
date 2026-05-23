"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import {
  archivePaymentMethod,
  createPaymentMethod,
  deletePaymentMethod,
  updatePaymentMethod,
} from "@/lib/data/actions";
import type { Currency, CurrencyCode, PaymentMethod, PaymentMethodKind } from "@/lib/supabase/types";

const KINDS: { value: PaymentMethodKind; label: string }[] = [
  { value: "bank", label: "Bank" },
  { value: "wallet", label: "Wallet" },
  { value: "exchange", label: "Exchange / on-ramp" },
  { value: "crypto", label: "Crypto" },
  { value: "cash", label: "Cash" },
  { value: "other", label: "Other" },
];
const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.value, k.label]));

export function MethodsForm({ methods, currencies, baseCurrency }: { methods: PaymentMethod[]; currencies: Currency[]; baseCurrency: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<PaymentMethod | null>(null);
  const [creating, setCreating] = useState(false);
  const [, start] = useTransition();

  const active = methods.filter((m) => !m.archived);
  const archived = methods.filter((m) => m.archived);

  function onArchive(m: PaymentMethod) {
    start(async () => {
      try { await archivePaymentMethod(m.id, !m.archived); router.refresh(); }
      catch (err) { toast.error((err as Error).message); }
    });
  }
  function onDelete(m: PaymentMethod) {
    if (!confirm(`Delete "${m.name}"? Past payments keep their amounts but lose this label.`)) return;
    start(async () => {
      try { await deletePaymentMethod(m.id); toast.success("Deleted"); router.refresh(); }
      catch (err) { toast.error((err as Error).message); }
    });
  }

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-border/60">
        <AnimatePresence initial={false}>
          {active.map((m, i) => (
            <MethodRow key={m.id} m={m} baseCurrency={baseCurrency} last={i === active.length - 1 && archived.length === 0} onEdit={() => setEditing(m)} onArchive={() => onArchive(m)} onDelete={() => onDelete(m)} />
          ))}
          {archived.map((m, i) => (
            <MethodRow key={m.id} m={m} baseCurrency={baseCurrency} last={i === archived.length - 1} onEdit={() => setEditing(m)} onArchive={() => onArchive(m)} onDelete={() => onDelete(m)} />
          ))}
        </AnimatePresence>
        {methods.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">No methods yet.</div>
        )}
      </div>

      <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
        <Plus className="mr-1.5 h-3.5 w-3.5" /> Add method
      </Button>

      <Dialog open={creating} onOpenChange={setCreating}>
        <MethodDialog
          currencies={currencies}
          baseCurrency={baseCurrency}
          onSubmit={async (values) => {
            try { await createPaymentMethod(values); toast.success("Method added"); setCreating(false); router.refresh(); }
            catch (err) { toast.error((err as Error).message); }
          }}
        />
      </Dialog>
      {editing && (
        <Dialog open onOpenChange={(o) => !o && setEditing(null)}>
          <MethodDialog
            initial={editing}
            currencies={currencies}
            baseCurrency={baseCurrency}
            onSubmit={async (values) => {
              try { await updatePaymentMethod(editing.id, values); toast.success("Method updated"); setEditing(null); router.refresh(); }
              catch (err) { toast.error((err as Error).message); }
            }}
          />
        </Dialog>
      )}
    </div>
  );
}

function MethodRow({ m, baseCurrency, last, onEdit, onArchive, onDelete }: { m: PaymentMethod; baseCurrency: string; last: boolean; onEdit: () => void; onArchive: () => void; onDelete: () => void }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: m.archived ? 0.55 : 1 }}
      exit={{ opacity: 0 }}
      className={cn("group flex items-center gap-3 px-4 py-3", !last && "border-b border-border/50")}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{m.name}</span>
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{KIND_LABEL[m.kind] ?? m.kind}</span>
          {m.is_holding && (
            <span className="shrink-0 rounded-full bg-[var(--chart-1)]/12 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--chart-1)]">Holding</span>
          )}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground tabular">
          {Number(m.monthly_fee_php) > 0 ? `${formatMoney(Number(m.monthly_fee_php), (m.monthly_fee_currency ?? baseCurrency) as CurrencyCode, { compact: true })}/mo fee` : "no monthly fee"}
          {m.currency_in || m.currency_out ? ` · ${m.currency_in ?? "any"} → ${m.currency_out ?? "any"}` : ""}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 max-md:opacity-100">
        <IconBtn onClick={onEdit} label="Edit"><Pencil className="h-3.5 w-3.5" /></IconBtn>
        <IconBtn onClick={onArchive} label={m.archived ? "Restore" : "Archive"}>
          {m.archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
        </IconBtn>
        <IconBtn onClick={onDelete} label="Delete" danger><Trash2 className="h-3.5 w-3.5" /></IconBtn>
      </div>
    </motion.div>
  );
}

function IconBtn({ children, onClick, label, danger }: { children: React.ReactNode; onClick: () => void; label: string; danger?: boolean }) {
  return (
    <button onClick={onClick} aria-label={label} className={cn("grid size-7 max-md:size-9 place-items-center rounded-md text-muted-foreground hover:bg-muted", danger ? "hover:text-destructive" : "hover:text-foreground")}>
      {children}
    </button>
  );
}

type MethodValues = { name: string; kind: string; currency_in: string | null; currency_out: string | null; monthly_fee_php: number; monthly_fee_currency: string | null; is_holding: boolean; notes: string | null };

function MethodDialog({ initial, currencies, baseCurrency, onSubmit }: { initial?: PaymentMethod; currencies: Currency[]; baseCurrency: string; onSubmit: (v: MethodValues) => Promise<void> }) {
  const [v, setV] = useState({
    name: initial?.name ?? "",
    kind: initial?.kind ?? "wallet",
    currency_in: initial?.currency_in ?? "",
    currency_out: initial?.currency_out ?? "",
    monthly_fee_php: initial?.monthly_fee_php ?? 0,
    monthly_fee_currency: initial?.monthly_fee_currency ?? baseCurrency,
    is_holding: initial?.is_holding ?? false,
    notes: initial?.notes ?? "",
  });
  const [pending, start] = useTransition();
  const ANY = "__any__";

  function submit() {
    if (!v.name.trim()) { toast.error("Name is required"); return; }
    start(async () => {
      await onSubmit({
        name: v.name.trim(),
        kind: v.kind,
        currency_in: v.currency_in || null,
        currency_out: v.currency_out || null,
        monthly_fee_php: Number(v.monthly_fee_php) || 0,
        monthly_fee_currency: v.monthly_fee_currency || null,
        is_holding: v.is_holding,
        notes: v.notes.trim() || null,
      });
    });
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader><DialogTitle>{initial ? "Edit method" : "New method"}</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <Label className="text-xs">Name</Label>
            <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Wise · GCash · Bank wire…" autoFocus />
          </div>
          <div>
            <Label className="text-xs">Kind</Label>
            <Select value={v.kind} onValueChange={(val) => val && setV({ ...v, kind: val })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Monthly fee</Label>
            <div className="flex gap-1.5">
              <Input className="flex-1" type="number" inputMode="decimal" step="0.01" value={v.monthly_fee_php} onChange={(e) => setV({ ...v, monthly_fee_php: Number(e.target.value) })} />
              <Select
                items={currencies.map((c) => ({ value: c.code, label: c.code }))}
                value={v.monthly_fee_currency}
                onValueChange={(val) => val && setV({ ...v, monthly_fee_currency: val })}
              >
                <SelectTrigger className="w-20 shrink-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {currencies.map((c) => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">Takes (currency in)</Label>
            <Select value={v.currency_in || ANY} onValueChange={(val) => setV({ ...v, currency_in: !val || val === ANY ? "" : val })}>
              <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any</SelectItem>
                {currencies.map((c) => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Gives (currency out)</Label>
            <Select value={v.currency_out || ANY} onValueChange={(val) => setV({ ...v, currency_out: !val || val === ANY ? "" : val })}>
              <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any</SelectItem>
                {currencies.map((c) => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <label className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
          <span className="min-w-0">
            <span className="block text-sm font-medium">Holding wallet</span>
            <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
              Money I keep a balance in (coin.ph, Cash). It counts as received when it lands, then I log a withdrawal when I move it out.
            </span>
          </span>
          <Switch checked={v.is_holding} onCheckedChange={(c) => setV({ ...v, is_holding: c === true })} className="mt-0.5 shrink-0" />
        </label>
        <div>
          <Label className="text-xs">Notes</Label>
          <Input value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} placeholder="optional" />
        </div>
        <Button className="w-full" onClick={submit} disabled={pending}>{pending ? "Saving…" : initial ? "Save changes" : "Add method"}</Button>
      </div>
    </DialogContent>
  );
}
