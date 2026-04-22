"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { MoreVertical, Plus, ArrowUpRight } from "lucide-react";
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
import { toast } from "sonner";
import type { Client } from "@/lib/supabase/types";

type Enriched = Client & { projectCount: number; paidTotal: number };

export function ClientList({
  clients,
  openNew,
}: {
  clients: Enriched[];
  openNew?: boolean;
}) {
  const [open, setOpen] = useState(openNew ?? false);
  const [editing, setEditing] = useState<Client | null>(null);

  useEffect(() => {
    if (openNew) setOpen(true);
  }, [openNew]);

  async function onArchive(id: string) {
    try {
      await archiveClient(id, true);
      toast.success("Client archived");
    } catch (err: unknown) {
      toast.error((err as Error).message);
    }
  }

  async function onDelete(id: string) {
    if (!confirm("Delete this client? Their projects and invoices will be removed too.")) return;
    try {
      await deleteClient(id);
      toast.success("Client deleted");
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
              onClick={() => setEditing(c)}
              className="group relative cursor-pointer p-5 transition-all hover:border-border hover:shadow-md"
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5">
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
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100"
                        onClick={(e) => e.stopPropagation()}
                      />
                    }
                  >
                    <MoreVertical className="h-4 w-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenuItem onSelect={() => setEditing(c)}>Edit</DropdownMenuItem>
                    {!c.archived ? (
                      <DropdownMenuItem onSelect={() => onArchive(c.id)}>Archive</DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onSelect={() => archiveClient(c.id, false)}>
                        Unarchive
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive" onSelect={() => onDelete(c.id)}>
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

              {(c.ice || c.rc) && (
                <div className="mt-4 flex flex-wrap gap-1.5 text-[10px]">
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

      <ClientDialog open={open} onOpenChange={setOpen} />
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
    <span className="rounded-full border border-border/60 bg-muted/60 px-2 py-0.5 text-muted-foreground">
      {children}
    </span>
  );
}

ClientList.NewButton = function NewButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 h-4 w-4" />
        New client
      </Button>
      <ClientDialog open={open} onOpenChange={setOpen} />
    </>
  );
};
