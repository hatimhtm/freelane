"use client";

import { startTransition, useMemo, useOptimistic, useState } from "react";
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
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { motion } from "motion/react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { KANBAN_COLUMNS, type KanbanColumnId } from "@/lib/constants";
import type { Client, Payment, Project, ProjectStatus, ProjectTemplate } from "@/lib/supabase/types";
import { ProjectCard } from "./project-card";
import { ProjectDialog } from "./project-dialog";
import { updateProjectStatus } from "@/lib/data/actions";

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

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const columns = useMemo(() => {
    const map: Record<string, Project[]> = {};
    KANBAN_COLUMNS.forEach((c) => (map[c.id] = []));
    projects.forEach((p) => {
      if (p.status === "archived") return;
      (map[p.status] ??= []).push(p);
    });
    return map;
  }, [projects]);

  const paymentsById = useMemo(() => {
    const map = new Map<string, Payment[]>();
    payments.forEach((p) => {
      const arr = map.get(p.project_id) ?? [];
      arr.push(p);
      map.set(p.project_id, arr);
    });
    return map;
  }, [payments]);

  const clientsById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);

  function findContainer(id: string): KanbanColumnId | null {
    if (KANBAN_COLUMNS.find((c) => c.id === id)) return id as KanbanColumnId;
    const project = projects.find((p) => p.id === id);
    return (project?.status as KanbanColumnId) ?? null;
  }

  function onDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    const from = findContainer(String(active.id));
    const to = findContainer(String(over.id));
    if (!from || !to) return;

    const project = projects.find((p) => p.id === active.id);
    if (!project) return;

    if (from === to) return; // same column, no-op

    const nextStatus = to as ProjectStatus;
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

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={rectIntersection}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto scroll-muted pb-4">
          {KANBAN_COLUMNS.map((col) => (
            <Column
              key={col.id}
              column={col}
              projects={columns[col.id] ?? []}
              clientsById={clientsById}
              paymentsById={paymentsById}
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
            <div className="rotate-[1.5deg]">
              <ProjectCard
                project={active}
                client={clientsById.get(active.client_id)}
                payments={paymentsById.get(active.id) ?? []}
                dragging
              />
            </div>
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
  clientsById,
  paymentsById,
  onOpenNew,
  onOpenEdit,
}: {
  column: (typeof KANBAN_COLUMNS)[number];
  projects: Project[];
  clientsById: Map<string, Client>;
  paymentsById: Map<string, Payment[]>;
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

  return (
    <div className="flex w-[300px] shrink-0 flex-col">
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
          isOver && "border-[var(--brand)]/40 bg-[var(--brand)]/5",
        )}
      >
        <SortableContext items={projects.map((p) => p.id)} strategy={verticalListSortingStrategy}>
          {projects.map((project) => (
            <SortableCard
              key={project.id}
              project={project}
              client={clientsById.get(project.client_id)}
              payments={paymentsById.get(project.id) ?? []}
              onClick={() => onOpenEdit(project)}
            />
          ))}
        </SortableContext>

        {projects.length === 0 && (
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
      </div>
    </div>
  );
}

function SortableCard({
  project,
  client,
  payments,
  onClick,
}: {
  project: Project;
  client?: Client;
  payments: Payment[];
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: project.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <ProjectCard project={project} client={client} payments={payments} onClick={onClick} />
    </div>
  );
}
