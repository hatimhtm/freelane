"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { MoreVertical, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ClientDialog } from "./client-dialog";
import { PrimaryAction } from "@/components/app/primary-action";
import { archiveClient, deleteClient } from "@/lib/data/actions";
import type { Client, CurrencyCode } from "@/lib/supabase/types";
import {
  ClientWidget,
  type ClientWidgetWarning,
} from "@/components/widgets/client-widget";

// Client cards are now rendered through the locked widget system (M widget
// shell). The list owns the surrounding chrome (motion stagger + per-card
// dropdown menu) but the visual identity, AI dot, and warning pills live
// inside ClientWidget. The dropdown floats over the widget's top-right
// corner — same affordance as the prior inline implementation, just
// detached from the card body now that the widget owns layout.

type Enriched = Client & {
  projectCount: number;
  openCount: number;
  paidBase: number;
  feesBase: number;
  outstandingBase: number;
  lastPaidAt: string | null;
  hasMemory: boolean;
  watch: string[];
  facts: string[];
  // From the Clients workflow: pattern_changed (open notification) +
  // quiet_14d (existing Quiet Channels Tier 5). Outstanding > 0 is
  // derived inline below into an overdue pill (X = open project count).
  patternChangedKind?: string | null;
  hasQuietChannel?: boolean;
};

export function ClientNewButton({ openInitial }: { openInitial?: boolean }) {
  const [open, setOpen] = useState(openInitial ?? false);
  useEffect(() => {
    if (openInitial) setOpen(true);
  }, [openInitial]);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 h-4 w-4" />
        New client
      </Button>
      <ClientDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

export function ClientList({
  clients,
  baseCurrency,
  openNew,
}: {
  clients: Enriched[];
  baseCurrency: CurrencyCode;
  openNew?: boolean;
}) {
  const router = useRouter();
  const [newOpen, setNewOpen] = useState(openNew ?? false);
  const [editing, setEditing] = useState<Client | null>(null);

  useEffect(() => {
    if (openNew) setNewOpen(true);
  }, [openNew]);

  async function onArchive(id: string, next: boolean) {
    try {
      await archiveClient(id, next);
      toast.success(next ? "Client archived" : "Client unarchived");
      router.refresh();
    } catch (err: unknown) {
      toast.error((err as Error).message);
    }
  }

  async function onDelete(id: string) {
    if (!confirm("Delete this client? Their projects and invoices will be removed too.")) return;
    try {
      await deleteClient(id);
      toast.success("Client deleted");
      router.refresh();
    } catch (err: unknown) {
      toast.error((err as Error).message);
    }
  }

  const enriched = useMemo(
    () =>
      clients.map((c) => {
        const warnings: ClientWidgetWarning[] = [];
        if (c.patternChangedKind) {
          warnings.push({
            kind: "pattern_changed",
            label:
              c.patternChangedKind === "payment_method"
                ? "Payment method shift"
                : c.patternChangedKind === "project_size_shift"
                ? "Project size shift"
                : "Pattern shift",
          });
        }
        if (c.hasQuietChannel) {
          warnings.push({ kind: "quiet_14d", label: "Quiet 14d+" });
        }
        if (c.openCount > 0 && c.outstandingBase > 0) {
          warnings.push({
            kind: "overdue",
            label: c.openCount === 1 ? "1 open" : `${c.openCount} open`,
          });
        }
        return { c, warnings };
      }),
    [clients],
  );

  return (
    <>
      <div className="grid auto-rows-fr items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {enriched.map(({ c, warnings }, i) => (
          <motion.div
            key={c.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: i * 0.03 }}
            className="relative h-full"
          >
            <ClientWidget
              client={{
                id: c.id,
                name: c.name,
                company: c.company,
                // Boolean only — the raw notes string never crosses into
                // the widget; the top fact (below) carries the privacy-
                // preserving teaser instead.
                hasNotes: !!(c.notes && c.notes.trim().length > 0),
                archived: !!c.archived,
                paidBase: c.paidBase,
                outstandingBase: c.outstandingBase,
                projectCount: c.projectCount,
                openProjectCount: c.openCount,
                lastPaidAt: c.lastPaidAt,
                defaultCurrency: (c.default_currency as CurrencyCode | null) ?? null,
              }}
              baseCurrency={baseCurrency}
              warnings={warnings}
              // Facts come from c.facts (consolidated memory bullets) for
              // now — they're rendered as the supporting line on the card
              // and threaded into the AI dot context. Confidence is a
              // sentinel (0.7) because the consolidated memory bullets
              // don't carry per-row confidence yet; the FactsPanel on the
              // detail sheet still shows the real ai_user_facts.confidence
              // from getClientFacts().
              facts={(c.facts ?? []).slice(0, 2).map((f) => ({
                key: "memory",
                value: f,
                confidence: 0.7,
              }))}
              onOpen={() => router.push(`/clients/${c.id}`)}
            />
            <div className="pointer-events-none absolute right-9 top-2 z-10">
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label="Open client menu"
                  className="pointer-events-auto grid h-7 w-7 place-items-center rounded-md text-muted-foreground opacity-40 transition-all hover:bg-muted hover:text-foreground hover:opacity-100 data-[popup-open]:opacity-100 data-[popup-open]:bg-muted"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreVertical className="h-4 w-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenuItem onClick={() => setEditing(c)}>Edit</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onArchive(c.id, !c.archived)}>
                    {c.archived ? "Unarchive" : "Archive"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => onDelete(c.id)}>
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </motion.div>
        ))}
      </div>

      <ClientDialog open={newOpen} onOpenChange={setNewOpen} />
      <ClientDialog
        open={!!editing}
        onOpenChange={(v) => !v && setEditing(null)}
        client={editing ?? undefined}
      />

      <PrimaryAction
        icon={Plus}
        label="New client"
        ariaLabel="Create a new client"
        onClick={() => setNewOpen(true)}
      />
    </>
  );
}
