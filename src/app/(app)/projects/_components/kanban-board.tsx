"use client";

import { startTransition, useMemo, useOptimistic, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { motion, useReducedMotion } from "motion/react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { KANBAN_COLUMNS, type KanbanColumnId, type KanbanColumnSortKey } from "@/lib/constants";
import type { Client, Payment, Project, ProjectStatus, ProjectTemplate } from "@/lib/supabase/types";
import { ProjectCard } from "./project-card";
import { ProjectDialog } from "./project-dialog";
import { updateProjectStatus } from "@/lib/data/actions";

// Paid projects auto-hide from the kanban after this many days — they're
// already visible on the payments page and dashboard recent-payments list, so
// keeping them on the kanban just adds clutter. Older paid rows are not
// archived in the DB — only filtered from the view.
const PAID_VISIBLE_DAYS = 3;
const DAY_MS = 86_400_000;

// Shared paper-settle spring — tighter than the framer-motion default. Less
// bounce, more "settles into place". Used by both the dragged card (overlay)
// and the FLIP reflow of neighbour cards so the choreography reads as one
// motion. Reduced-motion swaps in an instant transition.
const PAPER_SETTLE_SPRING = { type: "spring" as const, stiffness: 420, damping: 38, mass: 0.6 };

/** Best-effort "when did this project become paid". Falls back through:
 *  completed_at  →  the most recent payment's paid_at  →  updated_at. */
function paidSince(project: Project, payments: Payment[]): number | null {
  if (project.completed_at) return new Date(project.completed_at).getTime();
  const latest = payments
    .map((p) => new Date(p.paid_at).getTime())
    .sort((a, b) => b - a)[0];
  if (latest) return latest;
  return project.updated_at ? new Date(project.updated_at).getTime() : null;
}

/** Pull a sortable timestamp off a project for a given sort key. Paid uses
 *  the SAME `paidSince()` source-of-truth that drives the PAID_VISIBLE_DAYS
 *  cutoff, so sort order and visibility stay locked together: the most
 *  recently paid project always sits on top, even if an unrelated edit
 *  bumps `updated_at` after the fact. Typed as KanbanColumnSortKey so any
 *  new sort key added to KANBAN_COLUMNS forces this switch to handle it. */
function timestampFor(
  project: Project,
  key: KanbanColumnSortKey,
  paymentsForProject: Payment[],
): number {
  if (key === "completed_at") {
    return paidSince(project, paymentsForProject) ?? 0;
  }
  return project.created_at ? new Date(project.created_at).getTime() : 0;
}

export function KanbanBoard({
  projects: serverProjects,
  clients,
  payments,
  templates,
}: {
  projects: Project[];
  clients: Client[];
  payments: Payment[];
  templates: ProjectTemplate[];
}) {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  // Base list comes from server props — no `useState(initial)` so new projects
  // from router.refresh() show up immediately. Drag-drop gets an optimistic
  // overlay via useOptimistic that auto-clears once the transition settles.
  const [projects, applyOptimisticStatus] = useOptimistic(
    serverProjects,
    (state: Project[], patch: { id: string; status: ProjectStatus }) =>
      state.map((p) => (p.id === patch.id ? { ...p, status: patch.status } : p)),
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [defaultStatus, setDefaultStatus] = useState<ProjectStatus>("unpaid");
  const [activeId, setActiveId] = useState<string | null>(null);
  // The column the dragged card currently hovers over — drives the acid-lime
  // hot-ring. Updated via onDragOver. Null while nothing is being dragged.
  const [overColumn, setOverColumn] = useState<KanbanColumnId | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const paymentsById = useMemo(() => {
    const map = new Map<string, Payment[]>();
    payments.forEach((p) => {
      const arr = map.get(p.project_id) ?? [];
      arr.push(p);
      map.set(p.project_id, arr);
    });
    return map;
  }, [payments]);

  // `hiddenPaidCount` is the number of paid projects older than the grace
  // window — rendered as a small "+N older" hint at the bottom of the Paid
  // column so the user knows they exist (and where to find them).
  //
  // Sort dispatch: each column reads its sortKey/sortDir from KANBAN_COLUMNS
  // (constants.ts). Unpaid + partially_paid → created_at ASC (oldest stuck
  // projects bubble to the top). Paid → completed_at DESC ("recent wins"
  // first). The PAID_VISIBLE_DAYS cutoff runs BEFORE the sort so hiddenCount
  // math still uses the un-sorted iteration.
  const { columns, hiddenPaidCount } = useMemo(() => {
    const map: Record<string, Project[]> = {};
    KANBAN_COLUMNS.forEach((c) => (map[c.id] = []));
    const cutoff = Date.now() - PAID_VISIBLE_DAYS * DAY_MS;
    let hidden = 0;
    projects.forEach((p) => {
      if (p.status === "archived") return;
      if (p.status === "paid") {
        const ts = paidSince(p, paymentsById.get(p.id) ?? []);
        if (ts !== null && ts < cutoff) {
          hidden += 1;
          return;
        }
      }
      (map[p.status] ??= []).push(p);
    });
    // Sort each column per its column-definition sort key + direction.
    // Paid uses paidSince() (via timestampFor) so sort order matches the
    // PAID_VISIBLE_DAYS cutoff above — single source of truth.
    KANBAN_COLUMNS.forEach((col) => {
      const list = map[col.id];
      if (!list || list.length < 2) return;
      const sign = col.sortDir === "asc" ? 1 : -1;
      list.sort(
        (a, b) =>
          sign *
          (timestampFor(a, col.sortKey, paymentsById.get(a.id) ?? []) -
            timestampFor(b, col.sortKey, paymentsById.get(b.id) ?? [])),
      );
    });
    return { columns: map, hiddenPaidCount: hidden };
  }, [projects, paymentsById]);

  const clientsById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);

  function findContainer(id: string): KanbanColumnId | null {
    if (KANBAN_COLUMNS.find((c) => c.id === id)) return id as KanbanColumnId;
    const project = projects.find((p) => p.id === id);
    return (project?.status as KanbanColumnId) ?? null;
  }

  function onDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
    setOverColumn(findContainer(String(event.active.id)));
  }

  function onDragOver(event: DragOverEvent) {
    const overId = event.over?.id;
    if (overId == null) {
      setOverColumn(null);
      return;
    }
    const container = findContainer(String(overId));
    setOverColumn(container);
  }

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    setOverColumn(null);
    if (!over) return;

    const from = findContainer(String(active.id));
    const to = findContainer(String(over.id));
    if (!from || !to) return;

    const project = projects.find((p) => p.id === active.id);
    if (!project) return;

    if (from === to) return; // same column, no-op

    const nextStatus = to as ProjectStatus;

    // Moving a card to "Paid" means money arrived — open the log-payment form
    // (prefilled to this project) instead of silently flipping status. Status
    // settles to paid once the logged payment covers the balance.
    if (nextStatus === "paid" && from !== "paid") {
      router.push(`/payments?new=1&project=${project.id}`);
      return;
    }

    startTransition(async () => {
      applyOptimisticStatus({ id: project.id, status: nextStatus });
      try {
        await updateProjectStatus(project.id, nextStatus);
        router.refresh();
      } catch (err: unknown) {
        toast.error((err as Error).message);
      }
    });
  }

  const active = activeId ? projects.find((p) => p.id === activeId) : null;
  const activeSourceColumn = activeId ? findContainer(activeId) : null;

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={rectIntersection}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto scroll-muted pb-4">
          {KANBAN_COLUMNS.map((col) => (
            <Column
              key={col.id}
              column={col}
              projects={columns[col.id] ?? []}
              hiddenPaidCount={col.id === "paid" ? hiddenPaidCount : 0}
              clientsById={clientsById}
              paymentsById={paymentsById}
              isDragActive={activeId !== null}
              isDropTarget={overColumn === col.id && activeSourceColumn !== col.id}
              reducedMotion={!!reducedMotion}
              onOpenNew={() => {
                setDefaultStatus(col.id);
                setEditing(null);
                setDialogOpen(true);
              }}
              onOpenEdit={(p) => {
                setEditing(p);
                setDialogOpen(true);
              }}
            />
          ))}
        </div>

        <DragOverlay>
          {active ? (
            <motion.div
              initial={reducedMotion ? { opacity: 0.95 } : { scale: 1, rotate: 0 }}
              animate={
                reducedMotion
                  ? { opacity: 1 }
                  : { scale: 1.04, rotate: 1.6 }
              }
              transition={reducedMotion ? { duration: 0 } : PAPER_SETTLE_SPRING}
              className={cn(
                "rounded-lg",
                // Ink-coloured shadow (slate, not pure black) — sits in the
                // editorial palette rather than reading as a hard drop-shadow.
                !reducedMotion && "shadow-[0_24px_60px_-20px_rgba(15,23,42,0.45)]",
              )}
            >
              <ProjectCard
                project={active}
                client={clientsById.get(active.client_id)}
                payments={paymentsById.get(active.id) ?? []}
                dragging
              />
            </motion.div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <ProjectDialog
        open={dialogOpen}
        onOpenChange={(v) => {
          setDialogOpen(v);
          if (!v) setEditing(null);
        }}
        clients={clients}
        templates={templates}
        project={editing ?? undefined}
        defaultStatus={defaultStatus}
      />
    </>
  );
}

function Column({
  column,
  projects,
  hiddenPaidCount,
  clientsById,
  paymentsById,
  isDragActive,
  isDropTarget,
  reducedMotion,
  onOpenNew,
  onOpenEdit,
}: {
  column: (typeof KANBAN_COLUMNS)[number];
  projects: Project[];
  hiddenPaidCount: number;
  clientsById: Map<string, Client>;
  paymentsById: Map<string, Payment[]>;
  isDragActive: boolean;
  isDropTarget: boolean;
  reducedMotion: boolean;
  onOpenNew: () => void;
  onOpenEdit: (project: Project) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const tone = column.tone;

  const toneDot = {
    neutral: "bg-muted-foreground/60",
    brand:   "bg-[var(--chart-1)]",
    amber:   "bg-[var(--chart-3)]",
    cyan:    "bg-[var(--chart-2)]",
    success: "bg-[var(--chart-5)]",
    danger:  "bg-[var(--chart-4)]",
  }[tone];

  // Empty-column ghost placeholder: when a drag is in progress and the cursor
  // hovers an empty column (or this column is empty AND a destination), show
  // a faint dashed outline at the drop point. 72px matches a typical card.
  const showEmptyGhost = isDragActive && isDropTarget && projects.length === 0;

  return (
    <div className="relative flex w-[300px] shrink-0 flex-col">
      {/* Acid-lime hot-ring: 2px stroke at 30% opacity around the destination
          column. Only when this column is the drop target AND not the source.
          Sits in an absolute wrapper so it doesn't reflow the column layout. */}
      {isDropTarget && (
        <motion.div
          aria-hidden
          initial={reducedMotion ? { opacity: 0.3 } : { opacity: 0 }}
          animate={{ opacity: 0.3 }}
          exit={{ opacity: 0 }}
          transition={reducedMotion ? { duration: 0 } : { duration: 0.18, ease: "easeIn" }}
          className="pointer-events-none absolute inset-0 z-10 rounded-xl ring-2 ring-acid-lime"
          style={{ borderRadius: 16 }}
        />
      )}

      <div className="mb-3 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full", toneDot)} />
          <span className="text-sm font-medium">{column.label}</span>
          <span className="text-xs text-muted-foreground">{projects.length}</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onOpenNew}
          aria-label={`New project in ${column.label}`}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-[160px] flex-1 flex-col gap-2 rounded-xl border border-border/40 bg-muted/30 p-2 transition-all",
          isOver && !isDropTarget && "border-[var(--brand)]/40 bg-[var(--brand)]/5",
        )}
      >
        <SortableContext items={projects.map((p) => p.id)} strategy={verticalListSortingStrategy}>
          {projects.map((project) => (
            <SortableCard
              key={project.id}
              project={project}
              client={clientsById.get(project.client_id)}
              payments={paymentsById.get(project.id) ?? []}
              reducedMotion={reducedMotion}
              onClick={() => onOpenEdit(project)}
            />
          ))}
        </SortableContext>

        {/* Ghost placeholder for an empty column receiving a drop. Static when
            reduced-motion is on. */}
        {showEmptyGhost && (
          <div
            aria-hidden
            className="pointer-events-none rounded-lg border border-dashed border-acid-lime/60 bg-acid-lime/5"
            style={{ height: 72 }}
          />
        )}

        {projects.length === 0 && !showEmptyGhost && (
          <motion.button
            onClick={onOpenNew}
            initial={{ opacity: 0.5 }}
            whileHover={{ opacity: 1 }}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/50 px-3 py-6 text-xs text-muted-foreground transition-colors hover:border-border"
          >
            <Plus className="h-3 w-3" />
            Add project
          </motion.button>
        )}

        {/* Ghost placeholder after the last card — shows where the drag will
            land when a column already has cards. Skip when reduced motion. */}
        {isDragActive && isDropTarget && projects.length > 0 && !reducedMotion && (
          <div
            aria-hidden
            className="pointer-events-none rounded-lg border border-dashed border-acid-lime/60 bg-acid-lime/5"
            style={{ height: 72 }}
          />
        )}

        {hiddenPaidCount > 0 && (
          <Link
            href="/payments"
            className="mt-1 flex items-center justify-center rounded-md px-2 py-2 text-[11px] text-muted-foreground/70 transition-colors hover:bg-muted/40 hover:text-foreground"
            title={`${hiddenPaidCount} paid project${hiddenPaidCount === 1 ? "" : "s"} older than ${PAID_VISIBLE_DAYS} days — view them on the payments page.`}
          >
            +{hiddenPaidCount} older · in Payments →
          </Link>
        )}
      </div>
    </div>
  );
}

function SortableCard({
  project,
  client,
  payments,
  reducedMotion,
  onClick,
}: {
  project: Project;
  client?: Client;
  payments: Payment[];
  reducedMotion: boolean;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: project.id,
  });

  // dnd-kit handles the transform on the dragged element itself; framer-motion
  // layoutId drives the FLIP-style reflow of neighbours. We disable
  // framer-motion's layout animation while THIS card is being dragged so the
  // two animation systems don't fight on the same node. Reduced-motion drops
  // dnd-kit's CSS transition to none.
  const style = {
    transform: CSS.Transform.toString(transform),
    transition: reducedMotion ? "none" : transition,
    opacity: isDragging ? 0 : 1,
  };

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      layoutId={reducedMotion || isDragging ? undefined : `project-card-${project.id}`}
      transition={reducedMotion ? { duration: 0 } : PAPER_SETTLE_SPRING}
      {...attributes}
      {...listeners}
    >
      <ProjectCard project={project} client={client} payments={payments} onClick={onClick} />
    </motion.div>
  );
}
