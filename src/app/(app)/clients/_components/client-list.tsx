"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { ArrowUpRight, MoreVertical, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { Client, CurrencyCode } from "@/lib/supabase/types";

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
};

export function ClientNewButton({ openInitial }: { openInitial?: boolean }) {
  const [open, setOpen] = useState(openInitial ?? false);
  useEffect(() => { if (openInitial) setOpen(true); }, [openInitial]);
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

  useEffect(() => { if (openNew) setNewOpen(true); }, [openNew]);

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

  return (
    <>
      <div className="grid auto-rows-fr items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {clients.map((c, i) => (
          <motion.div
            key={c.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: i * 0.03 }}
            className="h-full"
          >
            <Card
              role="button"
              tabIndex={0}
              onClick={() => router.push(`/clients/${c.id}`)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  router.push(`/clients/${c.id}`);
                }
              }}
              className={cn(
                "group relative flex h-full min-h-[15rem] flex-col p-5 cursor-pointer transition-all hover:-translate-y-0.5 hover:border-border hover:shadow-md",
                c.archived && "opacity-60",
              )}
            >
              <div className="flex items-start justify-between">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={c.name} />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{c.name}</div>
                    {c.company && (
                      <div className="truncate text-xs text-muted-foreground">
                        {c.company}
                      </div>
                    )}
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label="Open client menu"
                    className={cn(
                      "grid h-7 w-7 place-items-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-muted hover:text-foreground group-hover:opacity-100 data-[popup-open]:opacity-100 data-[popup-open]:bg-muted",
                    )}
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

              <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">Landed</div>
                  <div className="font-medium tabular">
                    {c.paidBase > 0 ? formatMoney(c.paidBase, baseCurrency, { compact: true }) : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Outstanding</div>
                  <div className={cn("font-medium tabular", c.outstandingBase > 0 ? "text-[var(--overdue)]" : "text-muted-foreground")}>
                    {c.outstandingBase > 0 ? formatMoney(c.outstandingBase, baseCurrency, { compact: true }) : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Projects</div>
                  <div className="font-medium tabular">
                    {c.projectCount}
                    {c.openCount > 0 && <span className="text-xs text-muted-foreground"> · {c.openCount} open</span>}
                  </div>
                </div>
              </div>

              {/* AI memory tags — watch flags (red) first, capped at 2 so every
                  card stays the same height. */}
              {(c.watch.length > 0 || c.facts.length > 0) && (
                <div className="mt-4 flex flex-wrap items-center gap-1.5">
                  {(c.watch.length > 0 ? c.watch : c.facts).slice(0, 2).map((t, idx) => (
                    <span
                      key={idx}
                      className={cn(
                        "max-w-full truncate rounded-full px-2 py-0.5 text-[10px] font-medium",
                        c.watch.length > 0
                          ? "bg-[var(--overdue)]/12 text-[var(--overdue)]"
                          : "border border-[var(--brand)]/40 text-muted-foreground",
                      )}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
                {c.default_currency && <Chip>{c.default_currency}</Chip>}
                {c.feesBase > 0 && <Chip>{formatMoney(c.feesBase, baseCurrency, { compact: true })} fees</Chip>}
                {c.lastPaidAt && <Chip>last {new Date(c.lastPaidAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</Chip>}
              </div>

              <div className="pointer-events-none absolute right-4 top-4 opacity-0 transition-opacity group-hover:opacity-100">
                <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </Card>
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

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <div
      className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-sm font-semibold text-white shadow-inner shadow-white/10"
      style={{
        background: `linear-gradient(135deg, oklch(0.65 0.18 ${hue}), oklch(0.55 0.22 ${(hue + 40) % 360}))`,
      }}
    >
      {initials || "?"}
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-border/60 bg-muted/60 px-2 py-0.5 text-[10px] text-muted-foreground">
      {children}
    </span>
  );
}
