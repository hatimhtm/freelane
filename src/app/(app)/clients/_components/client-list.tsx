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
import { archiveClient, deleteClient } from "@/lib/data/actions";
import { cn } from "@/lib/utils";
import type { Client } from "@/lib/supabase/types";

type Enriched = Client & { projectCount: number; paidTotal: number };

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
  openNew,
}: {
  clients: Enriched[];
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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {clients.map((c, i) => (
          <motion.div
            key={c.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: i * 0.03 }}
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
                "group relative cursor-pointer p-5 transition-all hover:-translate-y-0.5 hover:border-border hover:shadow-md",
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

              <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">Projects</div>
                  <div className="font-medium tabular">{c.projectCount}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Paid</div>
                  <div className="font-medium tabular">
                    {c.paidTotal > 0
                      ? new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(c.paidTotal)
                      : "—"}
                  </div>
                </div>
              </div>

              {(c.ice || c.rc || c.default_currency) && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {c.ice && <Chip>ICE {c.ice}</Chip>}
                  {c.rc && <Chip>RC {c.rc}</Chip>}
                  {c.default_currency && <Chip>{c.default_currency}</Chip>}
                </div>
              )}

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
