"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CenterModal, CenterModalBody, CenterModalFooter } from "@/components/ui/center-modal";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { PrimaryAction } from "@/components/app/primary-action";
import { formatMoney } from "@/lib/money";
import { archiveVendor, createVendor } from "@/lib/data/actions";
import type {
  CurrencyCode,
  Spend,
  SpendVendorLink,
  Vendor,
  VendorAlias,
} from "@/lib/supabase/types";
import type { VendorHeartbeat } from "@/lib/ai/vendor-heartbeat";
import type { VendorAbsence } from "@/lib/ai/vendor-absence";

interface VendorsViewProps {
  vendors: Vendor[];
  aliases: VendorAlias[];
  heartbeats: VendorHeartbeat[];
  absences: VendorAbsence[];
  links: SpendVendorLink[];
  spends: Spend[];
  baseCurrency: CurrencyCode;
}

export function VendorsView({
  vendors,
  aliases,
  heartbeats,
  absences,
  links,
  spends,
  baseCurrency,
}: VendorsViewProps) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);

  const spendCountByVendor = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of links) m.set(l.vendor_id, (m.get(l.vendor_id) ?? 0) + 1);
    return m;
  }, [links]);

  const totalsByVendor = useMemo(() => {
    const m = new Map<string, number>();
    const spendById = new Map(spends.map((s) => [s.id, s] as const));
    for (const l of links) {
      const sp = spendById.get(l.spend_id);
      if (!sp) continue;
      m.set(l.vendor_id, (m.get(l.vendor_id) ?? 0) + Number(sp.amount_base ?? 0));
    }
    return m;
  }, [links, spends]);

  const sortedHeartbeats = useMemo(() => {
    return [...heartbeats].sort((a, b) => {
      const totalA = totalsByVendor.get(a.vendor.id) ?? 0;
      const totalB = totalsByVendor.get(b.vendor.id) ?? 0;
      return totalB - totalA;
    });
  }, [heartbeats, totalsByVendor]);

  const aliasesByVendor = useMemo(() => {
    const m = new Map<string, VendorAlias[]>();
    for (const a of aliases) {
      const arr = m.get(a.vendor_id) ?? [];
      arr.push(a);
      m.set(a.vendor_id, arr);
    }
    return m;
  }, [aliases]);

  return (
    <div className="mx-auto flex max-w-[1080px] flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="font-display text-lg leading-tight">Vendors</h1>
          <p className="text-xs text-muted-foreground">
            Places of San Pablo (and beyond). Heartbeat, absence, drift.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="h-8 gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          New vendor
        </Button>
      </header>

      {/* Absence strip — vendors quiet for too long */}
      {absences.length > 0 && (
        <section className="flex flex-col gap-2 rounded-[12px] border border-border/60 bg-card/40 p-3.5">
          <h2 className="font-display text-sm font-medium">Quiet vendors</h2>
          <ul className="flex flex-col gap-1.5 text-[12px]">
            {absences.slice(0, 6).map((a) => (
              <li key={a.vendor.id} className="flex items-baseline justify-between gap-3">
                <span>
                  <Link
                    href={`/vendors/${a.vendor.id}`}
                    className="font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    {a.vendor.canonical_name}
                  </Link>
                  <span className="ml-1 text-muted-foreground">
                    · {a.daysSinceLastSeen}d since last visit (typical {a.typicalGapDays.toFixed(0)}d)
                  </span>
                </span>
                <span className="text-[10px] text-muted-foreground">{a.totalVisits} total</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Vendor list */}
      <section className="flex flex-col gap-2">
        <h2 className="font-display text-sm font-medium">All vendors</h2>
        {sortedHeartbeats.length === 0 && (
          <div className="rounded-md border border-dashed border-border/60 px-4 py-8 text-center text-xs text-muted-foreground">
            No vendors yet. Add one to start tracking heartbeat + drift.
          </div>
        )}
        <ul className="flex flex-col divide-y divide-border/40 rounded-[10px] border border-border/50 bg-card/30">
          {sortedHeartbeats.map((h) => {
            const total = totalsByVendor.get(h.vendor.id) ?? 0;
            const count = spendCountByVendor.get(h.vendor.id) ?? 0;
            const myAliases = aliasesByVendor.get(h.vendor.id) ?? [];
            return (
              <li
                key={h.vendor.id}
                className="grid grid-cols-[1fr_auto] items-baseline gap-3 px-3 py-2.5 hover:bg-muted/40"
              >
                <Link
                  href={`/vendors/${h.vendor.id}`}
                  className="block min-w-0"
                >
                  <div className="flex flex-wrap items-baseline gap-1.5">
                    <span className="text-sm font-medium text-foreground">{h.vendor.canonical_name}</span>
                    {h.vendor.short_description && (
                      <span className="text-[11px] text-muted-foreground">
                        · {h.vendor.short_description.slice(0, 60)}
                      </span>
                    )}
                    {h.shift !== "typical" && (
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${shiftBadgeClass(h.shift)}`}
                      >
                        {h.shift}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {count} spends · {formatMoney(total, baseCurrency, { compact: true })}
                    {h.vendor.last_seen_at && ` · last ${h.vendor.last_seen_at}`}
                    {myAliases.length > 0 && ` · aliases: ${myAliases.map((a) => a.alias).slice(0, 3).join(", ")}`}
                  </div>
                </Link>
                <div className="flex items-center gap-1.5 text-right">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={async () => {
                      try {
                        await archiveVendor(h.vendor.id, !h.vendor.archived);
                        toast.success(h.vendor.archived ? "Restored" : "Archived");
                        router.refresh();
                      } catch (err) {
                        toast.error((err as Error).message);
                      }
                    }}
                    aria-label={`${h.vendor.archived ? "Restore" : "Archive"} vendor ${h.vendor.canonical_name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                  <Link
                    href={`/vendors/${h.vendor.id}`}
                    className="grid size-7 place-items-center text-muted-foreground hover:text-foreground"
                    aria-label={`Open ${h.vendor.canonical_name} details`}
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <CreateVendorModal open={createOpen} onOpenChange={setCreateOpen} />

      <PrimaryAction
        icon={Plus}
        label="New vendor"
        ariaLabel="Create a new vendor"
        onClick={() => setCreateOpen(true)}
      />
    </div>
  );
}

function shiftBadgeClass(shift: VendorHeartbeat["shift"]): string {
  if (shift === "spike" || shift === "above") return "border-acid-lime/50 text-acid-lime";
  if (shift === "below") return "border-overdue/50 text-overdue";
  return "border-border text-muted-foreground";
}

function CreateVendorModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);

  function reset() {
    setName("");
    setShortDescription("");
    setNotes("");
    setPending(false);
  }

  async function save() {
    if (!name.trim()) return;
    setPending(true);
    try {
      await createVendor({
        canonical_name: name.trim(),
        short_description: shortDescription.trim() || null,
        notes: notes.trim() || null,
      });
      toast.success(`Added ${name.trim()}`);
      reset();
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <CenterModal
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
      title="New vendor"
      description="A place — a store, a restaurant, a service. The AI watches the rhythm."
      size="md"
    >
      <CenterModalBody>
        <div className="grid gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Canonical name
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="SM Mayapa"
              className="h-9 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Short description
            </Label>
            <Input
              value={shortDescription}
              onChange={(e) => setShortDescription(e.target.value)}
              placeholder="Grocery near Mayapa intersection"
              className="h-9 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Notes <span className="ml-1 normal-case tracking-normal text-muted-foreground/60">optional</span>
            </Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything worth remembering"
              rows={3}
              className="resize-none text-sm"
            />
          </div>
        </div>
      </CenterModalBody>
      <CenterModalFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={save} disabled={pending || !name.trim()}>
          {pending ? "Saving…" : "Add vendor"}
        </Button>
      </CenterModalFooter>
    </CenterModal>
  );
}
