"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronRight, LayoutGrid, Plus, Rows3, Users } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
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

  // List view narrows to a single ~672px (max-w-2xl) column on >= sm so the
  // reading rhythm matches the editorial typography. Board view keeps the
  // wider max-w-5xl so 3 kanban columns fit comfortably.
  const outerMaxWidth = view === "list" ? "max-w-2xl" : "max-w-5xl";

  return (
    <div className={cn("mx-auto px-4 sm:px-6 py-8 lg:px-10 lg:py-12", outerMaxWidth)}>
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
              <PaidSection paid={paid} onOpen={openProject} />
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

// Two-layer collapse pattern for the Paid section:
//   State 1 — section collapsed (default): only the `▸ PAID (N)` header.
//   State 2 — section expanded, rows collapsed: compact single-line rows.
//   State 3 — section expanded + one or more rows open: tap a row to reveal
//             an inline summary. Multiple rows may be open simultaneously
//             (no auto-collapse-others — feels less twitchy on a small list).
function PaidSection({ paid, onOpen }: { paid: PaidRow[]; onOpen: (id: string) => void }) {
  const [sectionOpen, setSectionOpen] = useState(false);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const reducedMotion = useReducedMotion();
  // The per-row fade-in stagger should ONLY run on first reveal — re-opening
  // the section after a collapse would otherwise replay the cascade every
  // time, which reads as "rebuilding" rather than "revealing". Tracked via a
  // ref so the flip doesn't trigger a re-render.
  const hasOpenedRef = useRef(false);
  const staggerActive = !hasOpenedRef.current && !reducedMotion;
  if (sectionOpen && !hasOpenedRef.current) hasOpenedRef.current = true;

  function toggleRow(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section>
      <button
        type="button"
        onClick={() => setSectionOpen((v) => !v)}
        className="mb-3 flex w-full items-center gap-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        aria-expanded={sectionOpen}
      >
        {/* Section chevron is intentionally smaller + dimmer than the per-row
            chevron below — two layers of disclosure stacked vertically need
            different visual weights so the reading hierarchy is unambiguous. */}
        <ChevronRight
          className={cn(
            "h-3 w-3 shrink-0 text-muted-foreground/50 transition-transform",
            sectionOpen && "rotate-90",
          )}
        />
        <span className="uppercase tracking-wider text-[11px]">Paid</span>
        <span className="text-[11px] text-muted-foreground/70 tabular">({paid.length})</span>
      </button>

      <AnimatePresence initial={false}>
        {sectionOpen && (
          <motion.div
            key="paid-card"
            initial={reducedMotion ? { opacity: 1 } : { opacity: 0, height: 0 }}
            animate={reducedMotion ? { opacity: 1 } : { opacity: 1, height: "auto" }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={reducedMotion ? { duration: 0 } : { duration: 0.18, ease: "easeOut" }}
            className="overflow-hidden"
          >
            {/* Single overflow-hidden lives on the height-animating wrapper
                above; the Card itself drops the clip so focus rings / shadows
                can render past its edge if added later. */}
            <Card className="p-0">
              <ul>
                {paid.map((p, i) => {
                  const isOpen = openIds.has(p.id);
                  return (
                    <motion.li
                      key={p.id}
                      initial={staggerActive ? { opacity: 0 } : false}
                      animate={staggerActive ? { opacity: 1 } : undefined}
                      transition={
                        staggerActive
                          ? { duration: 0.18, delay: i * 0.015 }
                          : { duration: 0 }
                      }
                      className={cn(
                        i < paid.length - 1 && "border-b border-border/50",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggleRow(p.id)}
                        // py-3 max-md:py-3.5 brings the tap target to ~44px on
                        // touch (Apple HIG / Material) while staying compact
                        // on desktop pointers.
                        className="flex w-full items-center justify-between gap-3 px-4 py-3 max-md:py-3.5 text-left transition-colors hover:bg-muted/40"
                      >
                        {/* Row identity leads with the project TITLE so Paid
                            rows match the visual hierarchy of Open rows above
                            (blocked-money-list also puts title first, client
                            secondary). Client name + amount + paid date sit on
                            a second metadata line — the brief specified all
                            four columns on the compact row. Client gets the
                            truncate budget; amount + date are shrink-0 tabular
                            so they remain readable on narrow widths. */}
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="truncate text-sm font-medium">{p.title}</span>
                          <span className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="truncate">{p.clientName}</span>
                            <span className="shrink-0 tabular">
                              {formatMoney(p.amount, p.currency, { compact: true })}
                            </span>
                            <span className="shrink-0 tabular">
                              {new Date(p.completedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                            </span>
                          </span>
                        </div>
                        <ChevronRight
                          className={cn(
                            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                            isOpen && "rotate-90",
                          )}
                        />
                      </button>

                      <AnimatePresence initial={false}>
                        {isOpen && (
                          <motion.div
                            key="row-expand"
                            initial={reducedMotion ? { opacity: 1 } : { opacity: 0, height: 0 }}
                            animate={reducedMotion ? { opacity: 1 } : { opacity: 1, height: "auto" }}
                            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
                            transition={reducedMotion ? { duration: 0 } : { duration: 0.16, ease: "easeOut" }}
                            className="overflow-hidden"
                            // Tap-anywhere-to-close on the expanded panel —
                            // matches touch-device expectation. The "Open
                            // details" button already stopPropagation's so it
                            // still routes to the project sheet.
                            onClick={() => toggleRow(p.id)}
                            role="button"
                            tabIndex={-1}
                          >
                            <div className="px-4 pb-3 pt-1 text-xs text-muted-foreground space-y-1.5">
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onOpen(p.id); }}
                                className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline-offset-2 hover:underline"
                              >
                                Open details
                                <ChevronRight className="h-3 w-3" />
                              </button>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.li>
                  );
                })}
              </ul>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
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
