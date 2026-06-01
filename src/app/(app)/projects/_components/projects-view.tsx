"use client";

import { useMemo, useState } from "react";
import { LayoutGrid, Plus, Rows3, Users } from "lucide-react";
import { motion } from "motion/react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/link-button";
import { BlockedMoneyList, type BlockedRow } from "@/components/app/blocked-money-list";
import { PrimaryAction } from "@/components/app/primary-action";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { Client, CurrencyCode, Payment, Project, ProjectTemplate } from "@/lib/supabase/types";
import { KanbanBoard } from "./kanban-board";
import { ProjectDialog } from "./project-dialog";

type PaidRow = { id: string; title: string; clientName: string; amount: number; currency: CurrencyCode; completedAt: string };

export function ProjectsView({
  projects,
  clients,
  payments,
  templates,
  blocked,
  paid,
  currency,
  openNew,
}: {
  projects: Project[];
  clients: Client[];
  payments: Payment[];
  templates: ProjectTemplate[];
  blocked: BlockedRow[];
  paid: PaidRow[];
  currency: CurrencyCode;
  openNew?: boolean;
}) {
  const [view, setView] = useState<"list" | "board">("board");
  const [dialogOpen, setDialogOpen] = useState(openNew ?? false);
  const [editing, setEditing] = useState<Project | null>(null);
  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  function openProject(id: string) {
    const project = projectsById.get(id) ?? null;
    setEditing(project);
    setDialogOpen(true);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-8 lg:px-10 lg:py-12">
      <PageHeader
        title="Projects"
        description="Open balances ranked by amount and how long they've waited."
        actions={
          clients.length > 0 && (
            <div className="flex items-center gap-2">
              <ViewToggle view={view} onChange={setView} />
              <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
                <Plus className="mr-1.5 h-4 w-4" />
                New project
              </Button>
            </div>
          )
        }
      />

      <div className="mt-8">
        {clients.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Add a client first."
            description="Projects belong to clients — add at least one before you create a project."
            action={<LinkButton href="/clients?new=1"><Plus className="mr-1.5 h-4 w-4" />Add client</LinkButton>}
          />
        ) : view === "board" ? (
          <KanbanBoard projects={projects} clients={clients} payments={payments} templates={templates} />
        ) : (
          <div className="space-y-10">
            <section>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-sm font-medium">Open · ranked by urgency</h2>
                <span className="text-xs text-muted-foreground">{blocked.length} {blocked.length === 1 ? "project" : "projects"}</span>
              </div>
              <BlockedMoneyList rows={blocked} baseCurrency={currency} interactive onOpen={openProject} />
            </section>

            {paid.length > 0 && (
              <section>
                <h2 className="mb-3 text-sm font-medium text-muted-foreground">Paid recently</h2>
                <Card className="overflow-hidden p-0">
                  <ul>
                    {paid.map((p, i) => (
                      <motion.li
                        key={p.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.3, delay: i * 0.02 }}
                        onClick={() => openProject(p.id)}
                        className={cn(
                          "flex cursor-pointer items-center justify-between px-4 py-3 transition-colors hover:bg-muted/40",
                          i < paid.length - 1 && "border-b border-border/50",
                        )}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{p.title}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {p.clientName} · paid {new Date(p.completedAt).toLocaleDateString()}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="rounded-full bg-[var(--success)]/12 px-2 py-0.5 text-[11px] font-medium text-[var(--success)]">Paid</span>
                          <span className="text-sm tabular text-muted-foreground">{formatMoney(p.amount, p.currency, { compact: true })}</span>
                        </div>
                      </motion.li>
                    ))}
                  </ul>
                </Card>
              </section>
            )}
          </div>
        )}
      </div>

      <ProjectDialog
        open={dialogOpen}
        onOpenChange={(v) => { setDialogOpen(v); if (!v) setEditing(null); }}
        clients={clients}
        templates={templates}
        project={editing ?? undefined}
        defaultStatus="unpaid"
      />

      {clients.length > 0 && (
        <PrimaryAction
          icon={Plus}
          label="New project"
          ariaLabel="Create a new project"
          onClick={() => { setEditing(null); setDialogOpen(true); }}
        />
      )}
    </div>
  );
}

function ViewToggle({ view, onChange }: { view: "list" | "board"; onChange: (v: "list" | "board") => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-[6px] border border-border/70 bg-muted/40 p-0.5">
      {([["list", Rows3, "List"], ["board", LayoutGrid, "Board"]] as const).map(([id, Icon, label]) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium transition-colors",
            view === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}
