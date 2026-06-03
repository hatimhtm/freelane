"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, Plus, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CenterModal, CenterModalBody, CenterModalFooter } from "@/components/ui/center-modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MWidget } from "@/components/widgets/m-widget";
import { WarningPill } from "@/components/widgets/warning-pill";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { createVendor } from "@/lib/data/actions";
import {
  resolveVendorIcon,
  normalizeVendorName,
  indexVendorIconCache,
} from "@/lib/brand/vendor-icon";
import { vendorSlug } from "@/lib/spending/vendor-extract";
import type {
  CurrencyCode,
  VendorIconCacheRow,
} from "@/lib/supabase/types";
import type { VendorsSubviewRow } from "@/lib/data/queries";

// Human-readable last-visit formatter. last_visit is an ISO date string
// from getVendorsSubviewData (max(spent_at) per vendor) — printing it raw
// ("2026-05-31") clashes with the rest of the LifeOS widget surface,
// which speaks "3d ago" / "yesterday" everywhere via the same kind of
// helper. Mirrors the daysAgo/formatLastSeen pair in
// src/components/spending/vendor-intelligence.tsx so the two vendors
// surfaces stay in lockstep.
function lastVisitLabel(iso: string | null, now: number = Date.now()): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const days = Math.max(0, Math.floor((now - t) / 86_400_000));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

const EASE = [0.22, 1, 0.36, 1] as const;

interface VendorsSubviewProps {
  needsIdentification: VendorsSubviewRow[];
  active: VendorsSubviewRow[];
  archived: VendorsSubviewRow[];
  baseCurrency: CurrencyCode;
  vendorIconCache: VendorIconCacheRow[];
}

// Vendors sub-view — replaces the empty placeholder in /spending/vendors.
// Sections (locked 2026-06-02 freelane-vendors-design):
//   1. HEADER          — "Spending · Vendors" + [+ Manual add]
//   2. NEEDS IDENTIFICATION (collapsed) — vendor_clarify queue. Tap a
//      row → opens the chatbot scoped to clarify_vendor.
//   3. ACTIVE VENDORS  — grid of M widgets (brand glyph + name + count
//      + total + last visit). Sorted by total spent desc.
//   4. ARCHIVED        — collapsed by default.
// Search filter lives at the top of ACTIVE.
export function VendorsSubview({
  needsIdentification,
  active,
  archived,
  baseCurrency,
  vendorIconCache,
}: VendorsSubviewProps) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  // Default CLOSED per locked freelane-vendors-design ("Needs
  // Identification collapsed"). The count badge on the panel header is
  // the discoverability affordance — the user opens it deliberately.
  const [needsOpen, setNeedsOpen] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [query, setQuery] = useState("");

  const cacheByName = useMemo(
    () => indexVendorIconCache(vendorIconCache ?? []),
    [vendorIconCache],
  );

  const filteredActive = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return active;
    return active.filter((v) => v.display_name.toLowerCase().includes(q));
  }, [active, query]);

  return (
    <section className="mt-5 flex flex-col gap-5">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="display-eyebrow text-muted-foreground">Vendors</div>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Lifetime totals + per-vendor memory. Tap any card for detail.
          </p>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          variant="outline"
          className="h-8 gap-1.5 text-[12px]"
        >
          <Plus className="h-3.5 w-3.5" />
          Manual add
        </Button>
      </header>

      {needsIdentification.length > 0 && (
        <NeedsIdentificationPanel
          rows={needsIdentification}
          open={needsOpen}
          onOpenChange={setNeedsOpen}
          baseCurrency={baseCurrency}
        />
      )}

      <div className="flex items-center gap-2">
        <SearchInput value={query} onChange={setQuery} />
        <span className="text-[11px] text-muted-foreground">
          {filteredActive.length} vendor{filteredActive.length === 1 ? "" : "s"}
        </span>
      </div>

      {filteredActive.length === 0 ? (
        <p className="rounded-[12px] border border-dashed border-foreground/10 bg-card/30 px-4 py-8 text-center text-[12px] text-muted-foreground">
          {active.length === 0
            ? "No vendors yet. Logged spends bind themselves to new vendor rows automatically."
            : "Nothing matches that search."}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredActive.map((row, i) => (
            <VendorCard
              key={row.vendor_id}
              row={row}
              baseCurrency={baseCurrency}
              cacheByName={cacheByName}
              index={i}
              onOpen={() =>
                router.push(`/spending/vendor/${vendorSlug(row.display_name)}`)
              }
            />
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <ArchivedPanel
          rows={archived}
          open={archivedOpen}
          onOpenChange={setArchivedOpen}
          baseCurrency={baseCurrency}
        />
      )}

      <CreateVendorModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => router.refresh()}
      />
    </section>
  );
}

// Per-vendor M widget. Whole-card click opens detail. Per-card AI dot
// (top-right) dispatches the chatbot scoped to this vendor.
//
// Standardized on the locked MWidget + AiDot + WarningPill primitives so
// the Vendors sub-view reads identically to Dashboard / Plans / Stats —
// the previous bespoke <Link>+<Sparkles> card was the only widget surface
// re-implementing the chatbot dispatch by hand, which drifted from the
// canonical setActiveCardContext path.
function VendorCard({
  row,
  baseCurrency,
  cacheByName,
  index,
  onOpen,
}: {
  row: VendorsSubviewRow;
  baseCurrency: CurrencyCode;
  cacheByName: Map<string, VendorIconCacheRow>;
  index: number;
  onOpen: () => void;
}) {
  const resolved = resolveVendorIcon(row.display_name, {
    cache: cacheByName.get(normalizeVendorName(row.display_name)) ?? null,
    className: "size-7",
  });
  // The warning must AGREE with the Active grouping. queries.ts puts a
  // vendor in Active when `!needs_identification || identification_skipped`,
  // so a card sitting in Active with low confidence but no
  // needs_identification flag (e.g. brand-key match that cleared the flag
  // before the brain finished) shouldn't shout "Needs identification" at
  // the user — they already implicitly resolved it.
  const showWarning =
    (row.confidence ?? 0) < 0.4 &&
    !row.identification_skipped &&
    row.needs_identification;
  const visitedAgo = lastVisitLabel(row.last_visit);
  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index, 10) * 0.02, ease: EASE }}
    >
      <MWidget
        label={row.display_name}
        icon={resolved.icon}
        hero={formatMoney(row.total_base, baseCurrency, { compact: true })}
        sub={row.display_name}
        supporting={
          <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
            <span>
              {row.spend_count} spend{row.spend_count === 1 ? "" : "s"}
            </span>
            {visitedAgo && (
              <>
                <span aria-hidden>·</span>
                <span>last {visitedAgo}</span>
              </>
            )}
          </span>
        }
        warning={
          showWarning ? <WarningPill>Needs identification</WarningPill> : undefined
        }
        aiDot={{
          key: `vendor:${row.vendor_id}`,
          label: row.display_name,
          // Vendors workflow per-card AI dot — opens the chatbot scoped
          // to this vendor with `intent:'vendor_detail'` so the
          // intent-classifier routing table in chat-context-registry
          // can pass the vendor_price_history + recent spends context
          // to chat-answer. canonical_name + brand_key + vendor_name
          // are carried so the brain can answer follow-ups about the
          // place (rate trend, recent visits, items) without needing
          // the user to re-state which vendor they meant.
          data: {
            intent: "vendor_detail",
            vendor_id: row.vendor_id,
            vendor_name: row.display_name,
            canonical_name: row.canonical_name,
            brand_key: row.brand_key,
          },
        }}
        onOpen={onOpen}
      />
    </motion.li>
  );
}

function NeedsIdentificationPanel({
  rows,
  open,
  onOpenChange,
  baseCurrency,
}: {
  rows: VendorsSubviewRow[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  baseCurrency: CurrencyCode;
}) {
  return (
    <div className="rounded-[14px] border border-foreground/10 bg-card/40">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3"
      >
        <span className="display-eyebrow text-muted-foreground">
          Needs identification
          <span className="ml-2 rounded-full bg-foreground/10 px-2 py-0.5 text-foreground">
            {rows.length}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: EASE }}
            className="overflow-hidden"
          >
            <ul className="border-t border-foreground/10">
              {rows.map((r) => {
                // Seed the chatbot pill with whatever the backfill /
                // sync kickoff brain already cached on the vendor row.
                // Empty arrays force a fresh Pro call (or worse, show
                // empty chips); piping the cached canonical_name +
                // aliases means the pill renders REAL options on the
                // first tap.
                const cachedChips: string[] = [];
                if (r.canonical_name) cachedChips.push(r.canonical_name);
                for (const alias of r.aliases) {
                  if (
                    typeof alias === "string" &&
                    alias.length > 0 &&
                    !cachedChips.includes(alias)
                  ) {
                    cachedChips.push(alias);
                  }
                }
                const suggestedAnswers = cachedChips.slice(0, 3);
                return (
                <li
                  key={r.vendor_id}
                  className="grid grid-cols-[1fr_auto] items-baseline gap-3 border-b border-foreground/5 px-4 py-2.5 last:border-b-0"
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (typeof window !== "undefined") {
                        window.dispatchEvent(
                          new CustomEvent("freelane:open-chatbot", {
                            detail: {
                              question: `What is "${r.display_name}"? Tap the closest, or type it.`,
                              activeCard: {
                                key: `vendor_clarify:${r.vendor_id}`,
                                label: r.display_name,
                                data: {
                                  intent: "clarify_vendor",
                                  vendor_id: r.vendor_id,
                                  vendor_name: r.display_name,
                                  canonical_name: r.canonical_name,
                                  brand_key: r.brand_key,
                                  suggested_answers: suggestedAnswers,
                                  alternatives: suggestedAnswers.map(
                                    (canonical_name) => ({
                                      canonical_name,
                                      reasoning: "",
                                    }),
                                  ),
                                  allow_skip: true,
                                },
                              },
                            },
                          }),
                        );
                      }
                    }}
                    className="min-w-0 text-left"
                  >
                    <div className="truncate text-[13px] text-foreground">
                      {r.display_name}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {r.spend_count} spend{r.spend_count === 1 ? "" : "s"} ·{" "}
                      {formatMoney(r.total_base, baseCurrency, { compact: true })}
                    </div>
                  </button>
                  <span className="text-[11px] text-muted-foreground">
                    What is this?
                  </span>
                </li>
                );
              })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ArchivedPanel({
  rows,
  open,
  onOpenChange,
  baseCurrency,
}: {
  rows: VendorsSubviewRow[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  baseCurrency: CurrencyCode;
}) {
  return (
    <div className="rounded-[14px] border border-foreground/10 bg-card/30">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3"
      >
        <span className="display-eyebrow text-muted-foreground">
          Archived
          <span className="ml-2 rounded-full bg-foreground/10 px-2 py-0.5 text-foreground">
            {rows.length}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: EASE }}
            className="overflow-hidden"
          >
            <ul className="border-t border-foreground/10">
              {rows.map((r) => (
                <li
                  key={r.vendor_id}
                  className="grid grid-cols-[1fr_auto] items-baseline gap-3 border-b border-foreground/5 px-4 py-2 last:border-b-0"
                >
                  <span className="truncate text-[12px] text-foreground/80">
                    {r.display_name}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {formatMoney(r.total_base, baseCurrency, { compact: true })}
                  </span>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  // Re-uses the canonical <Input> primitive so vendor search shares the
  // ring/focus/dark-mode contract with the CreateVendorModal fields below
  // and the rest of the app's input surfaces.
  return (
    <div className="relative flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search vendors"
        aria-label="Search vendors"
        className="h-8 rounded-full pl-8 text-[12px]"
      />
    </div>
  );
}

function CreateVendorModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
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
      const result = await createVendor({
        canonical_name: name.trim(),
        short_description: shortDescription.trim() || null,
        notes: notes.trim() || null,
      });
      if (!result.ok) {
        toast.error(result.error || "Couldn't add vendor.");
        return;
      }
      toast.success(
        result.data.reused
          ? `Reused existing ${name.trim()}`
          : `Added ${name.trim()}`,
      );
      reset();
      onOpenChange(false);
      onCreated();
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
      description="A place — a store, restaurant, sari-sari, service. The brain will ask you to clarify if it isn't sure what it is."
      size="md"
    >
      <CenterModalBody>
        <div className="grid gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Vendor name
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
