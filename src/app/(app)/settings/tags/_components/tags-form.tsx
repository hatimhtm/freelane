"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  archiveSpendCategory,
  createSpendCategory,
  deleteSpendCategory,
  updateSpendCategory,
} from "@/lib/data/actions";
import type { SpendCategory, SpendCategoryKind, TagKind } from "@/lib/supabase/types";

const LEDGER_KINDS: { value: SpendCategoryKind; label: string }[] = [
  { value: "consumption", label: "Consumption" },
  { value: "investment", label: "Investment" },
  { value: "neutral", label: "Neutral" },
];

export function TagsForm({ categories }: { categories: SpendCategory[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<SpendCategory | null>(null);
  const [creating, setCreating] = useState(false);
  const [, start] = useTransition();

  const audience = categories.filter((c) => c.tag_kind === "audience");
  const standard = categories.filter(
    (c) => c.tag_kind === "category" && !c.archived,
  );
  const custom = categories.filter(
    (c) => c.tag_kind === "custom" && !c.archived,
  );
  const archived = categories.filter((c) => c.archived);

  function onArchive(c: SpendCategory) {
    start(async () => {
      try {
        // archiveSpendCategory throws on failure (does not return ActionResult).
        await archiveSpendCategory(c.id, !c.archived);
        router.refresh();
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  function onDelete(c: SpendCategory) {
    if (c.pinned) {
      toast.error("Pinned tags can't be deleted.");
      return;
    }
    if (!confirm(`Delete "${c.name}"? Past spends keep their amounts but lose this tag.`))
      return;
    start(async () => {
      const result = await deleteSpendCategory(c.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Tag deleted");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <Group title="Audience" hint="Immutable seeds — who the spend was for.">
        <TagList
          items={audience}
          immutable
          onEdit={() => {}}
          onArchive={() => {}}
          onDelete={() => {}}
        />
      </Group>
      <Group title="Categories" hint="The shape of the spend — food, transport, bills.">
        <TagList
          items={standard}
          onEdit={setEditing}
          onArchive={onArchive}
          onDelete={onDelete}
        />
      </Group>
      <Group title="Custom tags" hint="Anything you've added yourself.">
        <TagList
          items={custom}
          onEdit={setEditing}
          onArchive={onArchive}
          onDelete={onDelete}
        />
      </Group>
      {archived.length > 0 && (
        <Group title="Archived" hint="Hidden from the spend modal; restore anytime.">
          <TagList
            items={archived}
            onEdit={setEditing}
            onArchive={onArchive}
            onDelete={onDelete}
          />
        </Group>
      )}

      <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
        <Plus className="mr-1.5 h-3.5 w-3.5" /> Add tag
      </Button>

      <Dialog open={creating} onOpenChange={setCreating}>
        <TagDialog
          onSubmit={async (values) => {
            const result = await createSpendCategory({
              name: values.name,
              kind: values.kind,
              tagKind: values.tagKind,
              createdByUser: true,
            });
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            toast.success("Tag added");
            setCreating(false);
            router.refresh();
          }}
        />
      </Dialog>
      {editing && (
        <Dialog open onOpenChange={(o) => !o && setEditing(null)}>
          <TagDialog
            initial={editing}
            onSubmit={async (values) => {
              const result = await updateSpendCategory(editing.id, {
                name: values.name,
                kind: values.kind,
              });
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              toast.success("Tag updated");
              setEditing(null);
              router.refresh();
            }}
          />
        </Dialog>
      )}
    </div>
  );
}

function Group({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </div>
        {hint && (
          <p className="text-[11px] leading-snug text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

function TagList({
  items,
  immutable,
  onEdit,
  onArchive,
  onDelete,
}: {
  items: SpendCategory[];
  immutable?: boolean;
  onEdit: (c: SpendCategory) => void;
  onArchive: (c: SpendCategory) => void;
  onDelete: (c: SpendCategory) => void;
}) {
  if (items.length === 0)
    return (
      <div className="rounded-xl border border-dashed border-border/60 px-4 py-3 text-xs text-muted-foreground">
        Nothing here yet.
      </div>
    );
  return (
    <div className="overflow-hidden rounded-xl border border-border/60">
      {items.map((c, i) => (
        <div
          key={c.id}
          className={cn(
            "group flex items-center gap-3 px-4 py-2.5",
            i !== items.length - 1 && "border-b border-border/50",
            c.archived && "opacity-55",
          )}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{c.name}</span>
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {c.kind}
              </span>
              {c.pinned && (
                <span className="shrink-0 rounded-full bg-[var(--chart-1)]/12 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--chart-1)]">
                  pinned
                </span>
              )}
            </div>
          </div>
          {!immutable && (
            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 max-md:opacity-100">
              <IconBtn label="Edit" onClick={() => onEdit(c)}>
                <Pencil className="h-3.5 w-3.5" />
              </IconBtn>
              <IconBtn
                label={c.archived ? "Restore" : "Archive"}
                onClick={() => onArchive(c)}
              >
                {c.archived ? (
                  <ArchiveRestore className="h-3.5 w-3.5" />
                ) : (
                  <Archive className="h-3.5 w-3.5" />
                )}
              </IconBtn>
              <IconBtn label="Delete" danger onClick={() => onDelete(c)}>
                <Trash2 className="h-3.5 w-3.5" />
              </IconBtn>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function IconBtn({
  children,
  label,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={cn(
        "grid size-7 max-md:size-9 place-items-center rounded-md text-muted-foreground hover:bg-muted",
        danger ? "hover:text-destructive" : "hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

type TagValues = { name: string; kind: SpendCategoryKind; tagKind: TagKind };

function TagDialog({
  initial,
  onSubmit,
}: {
  initial?: SpendCategory;
  onSubmit: (v: TagValues) => Promise<void>;
}) {
  const [v, setV] = useState<TagValues>({
    name: initial?.name ?? "",
    kind: (initial?.kind as SpendCategoryKind) ?? "neutral",
    tagKind: (initial?.tag_kind as TagKind) ?? "custom",
  });
  const [pending, start] = useTransition();
  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{initial ? "Edit tag" : "New tag"}</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <Label className="text-xs">Name</Label>
          <Input
            value={v.name}
            onChange={(e) => setV({ ...v, name: e.target.value })}
            placeholder="Travel · Pets · Family allowance"
            autoFocus
          />
        </div>
        <div>
          <Label className="text-xs">Ledger kind</Label>
          <Select
            value={v.kind}
            onValueChange={(val) =>
              val && setV({ ...v, kind: val as SpendCategoryKind })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEDGER_KINDS.map((k) => (
                <SelectItem key={k.value} value={k.value}>
                  {k.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            Drives the Investment vs Consumption split. Neutral stays out of
            both rails.
          </p>
        </div>
        <Button
          className="w-full"
          disabled={pending}
          onClick={() =>
            start(async () => {
              if (!v.name.trim()) {
                toast.error("Name is required");
                return;
              }
              await onSubmit({ ...v, name: v.name.trim() });
            })
          }
        >
          {pending ? "Saving…" : initial ? "Save changes" : "Add tag"}
        </Button>
      </div>
    </DialogContent>
  );
}
