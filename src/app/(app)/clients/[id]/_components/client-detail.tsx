"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, MoreVertical, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { archiveClient, deleteClient } from "@/lib/data/actions";
import type {
  Client,
  ClientMemoryConsolidated,
  CurrencyCode,
  ProjectStatus,
  QuietChannel,
  RateInsight,
} from "@/lib/supabase/types";
import { ClientDialog } from "../../_components/client-dialog";
import { MemoryComposer } from "./memory-composer";
import { FollowUpButton } from "./follow-up-button";
import { QuietChannelBanner } from "./quiet-channel-banner";
import { RateInsightsSection } from "./rate-insights-section";

type ProjectView = { id: string; title: string; amount: number; currency: CurrencyCode; status: ProjectStatus; outstandingNative: number };
type Entry = { id: string; content: string; createdAt: string; consolidated: boolean };

const STATUS_META: Record<string, { label: string; cls: string }> = {
  unpaid:         { label: "Unpaid",  cls: "bg-muted text-muted-foreground" },
  partially_paid: { label: "Partial", cls: "bg-[var(--chart-3)]/15 text-[var(--chart-3)]" },
  paid:           { label: "Paid",    cls: "bg-[var(--success)]/15 text-[var(--success)]" },
  archived:       { label: "Archived", cls: "bg-muted text-muted-foreground" },
};

export function ClientDetail({
  client,
  currency,
  landed,
  outstandingTotal,
  memory,
  consolidated,
  projects,
  events,
  aiEnabled,
  hasOutstanding,
  quietChannel,
  rateInsights,
}: {
  client: Client;
  currency: CurrencyCode;
  landed: number;
  outstandingTotal: number;
  memory: Entry[];
  consolidated: ClientMemoryConsolidated;
  projects: ProjectView[];
  events: { id: string; title: string; createdAt: string }[];
  aiEnabled: boolean;
  hasOutstanding: boolean;
  quietChannel: QuietChannel | null;
  rateInsights: RateInsight[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [, start] = useTransition();

  function onArchive() {
    start(async () => {
      try { await archiveClient(client.id, !client.archived); toast.success(client.archived ? "Unarchived" : "Archived"); router.refresh(); }
      catch (err) { toast.error((err as Error).message); }
    });
  }
  function onDelete() {
    if (!confirm("Delete this client? Their projects and payments go too.")) return;
    start(async () => {
      try { await deleteClient(client.id); toast.success("Client deleted"); router.push("/clients"); }
      catch (err) { toast.error((err as Error).message); }
    });
  }

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-8 lg:px-10 lg:py-12">
      <Link href="/clients" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="size-4" /> Clients
      </Link>

      <div className="mt-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="display-headline text-3xl md:text-4xl">{client.name}</h1>
          {client.company && <p className="mt-1 text-sm text-muted-foreground">{client.company}</p>}
          {client.short_description && (
            <p className="mt-3 max-w-xl text-sm text-muted-foreground">{client.short_description}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {aiEnabled && hasOutstanding && <FollowUpButton clientId={client.id} />}
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil className="mr-1.5 h-4 w-4" /> Edit
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger aria-label="More" className="grid size-9 place-items-center rounded-md border border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground">
              <MoreVertical className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onArchive}>{client.archived ? "Unarchive" : "Archive"}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onDelete}>Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-border/60 bg-border/60">
        <Stat label="Landed" value={formatMoney(landed, currency, { compact: true })} />
        <Stat label="Outstanding" value={formatMoney(outstandingTotal, currency, { compact: true })} />
        <Stat label="Projects" value={String(projects.length)} />
      </div>

      {quietChannel && (
        <div className="mt-6">
          <QuietChannelBanner channel={quietChannel} />
        </div>
      )}

      <div className="mt-10 grid gap-10 lg:grid-cols-[1.3fr_1fr]">
        <section>
          <h2 className="mb-3 text-sm font-medium">Memory</h2>
          <MemoryComposer clientId={client.id} entries={memory} consolidated={consolidated} />
        </section>

        <div className="space-y-10">
          {aiEnabled && (
            <RateInsightsSection insights={rateInsights} />
          )}

          <section>
            <h2 className="mb-3 text-sm font-medium">Projects</h2>
            {projects.length === 0 ? (
              <Card className="px-4 py-6 text-center text-sm text-muted-foreground">No projects yet.</Card>
            ) : (
              <Card className="overflow-hidden p-0">
                {projects.map((p, i) => {
                  const meta = STATUS_META[p.status] ?? STATUS_META.unpaid;
                  return (
                    <Link
                      key={p.id}
                      href="/projects"
                      className={cn("flex items-center justify-between px-4 py-3 transition-colors hover:bg-muted/40", i < projects.length - 1 && "border-b border-border/50")}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{p.title}</div>
                        <div className="text-xs tabular text-muted-foreground">{formatMoney(p.amount, p.currency, { compact: true })}</div>
                      </div>
                      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", meta.cls)}>{meta.label}</span>
                    </Link>
                  );
                })}
              </Card>
            )}
          </section>

          {events.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-medium">Activity</h2>
              <ol className="relative ml-2 space-y-2.5 border-l border-border/60 pl-4">
                {events.slice(0, 12).map((e) => (
                  <li key={e.id} className="relative text-sm">
                    <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-muted-foreground/30 ring-2 ring-background" />
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 flex-1 truncate">{e.title}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground/70 tabular">
                        {new Date(e.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      </div>

      <ClientDialog open={editing} onOpenChange={setEditing} client={client} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card px-4 py-4">
      <div className="display-eyebrow text-muted-foreground">{label}</div>
      <div className="mt-1.5 text-xl font-semibold tabular tracking-tight">{value}</div>
    </div>
  );
}
