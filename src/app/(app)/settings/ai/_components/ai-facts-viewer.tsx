"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { deleteFact, editFact } from "@/lib/ai/facts-actions";
import type { Fact, FactSubjectKind } from "@/lib/ai/facts";
import type { FactSubjectGroup } from "@/lib/ai/facts-queries";

// Per-subject AI facts viewer. Lists live facts grouped by
// (subject_kind, subject_id) with edit / soft-delete affordances. The
// fact `key` is read-only (partial-unique indexes treat it as part of
// the slot identity); the form surfaces value + evidence only.

const KIND_LABEL: Record<string, string> = {
  user: "About you",
  client: "Client",
  vendor: "Vendor",
  project: "Project",
  plan: "Plan",
  entity: "Person",
};

// Subject-kind filter strip. KIND_LABEL is the rich label for an
// individual row; this short label is what the filter chip reads.
const FILTER_LABELS: { kind: FactSubjectKind | "all"; label: string }[] = [
  { kind: "all", label: "All" },
  { kind: "user", label: "You" },
  { kind: "client", label: "Clients" },
  { kind: "entity", label: "People" },
  { kind: "vendor", label: "Vendors" },
  { kind: "project", label: "Projects" },
  { kind: "plan", label: "Plans" },
];

// Brain-internal slugs come in snake_case (e.g. pattern_change_payment_method).
// Surface a humanized label in the UI so the editorial tone holds.
//
// ACRONYM_PRESERVE keeps short-form names from mangling under title-case —
// "usd_rate" → "USD rate" (not "Usd rate"), "gcash_pin" → "GCash pin", etc.
// The set lives next to humanizeFactKey because adding a new acronym is the
// only realistic future maintenance.
const ACRONYM_PRESERVE: Record<string, string> = {
  usd: "USD",
  php: "PHP",
  eur: "EUR",
  gcash: "GCash",
  ai: "AI",
  api: "API",
  url: "URL",
  pin: "PIN",
  id: "ID",
  ph: "PH",
  fx: "FX",
  ok: "OK",
};
function humanizeFactKey(key: string): string {
  if (!key) return "";
  return key
    .split("_")
    .filter(Boolean)
    .map((part, i) => {
      const preserved = ACRONYM_PRESERVE[part.toLowerCase()];
      if (preserved) return preserved;
      if (i === 0) return part.charAt(0).toUpperCase() + part.slice(1);
      return part;
    })
    .join(" ");
}

export function AiFactsViewer({ groups }: { groups: FactSubjectGroup[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Fact | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Fact | null>(null);
  const [filter, setFilter] = useState<FactSubjectKind | "all">("all");
  const [query, setQuery] = useState("");
  // Track the fact id currently being mutated so the row can dim and its
  // affordances disable while the server roundtrip + router.refresh()
  // settle. Without this, slow networks leave the row fully bright until
  // the refresh lands — which reads as "nothing happened".
  const [pendingFactId, setPendingFactId] = useState<string | null>(null);
  const [, start] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups.filter((g) => {
      if (filter !== "all" && g.subjectKind !== filter) return false;
      if (!q) return true;
      return (
        g.subjectLabel.toLowerCase().includes(q) ||
        g.facts.some(
          (f) =>
            f.key.toLowerCase().includes(q) ||
            humanizeFactKey(f.key).toLowerCase().includes(q),
        )
      );
    });
  }, [groups, filter, query]);

  function runDelete(fact: Fact) {
    setPendingFactId(fact.id);
    start(async () => {
      const result = await deleteFact(fact.id);
      if (!result.ok) {
        toast.error(result.error);
        setPendingFactId(null);
        return;
      }
      toast.success("Fact forgotten");
      setConfirmDelete(null);
      router.refresh();
      // router.refresh() resolves once the server payload lands. Clear the
      // pending id so a freshly-replaced row doesn't stay dimmed if the
      // user immediately re-edits another row.
      setPendingFactId(null);
    });
  }

  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 p-6 text-center text-sm text-muted-foreground">
        Nothing yet. The AI starts gathering facts as you write notes about
        clients, projects, and people.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter strip + search — keeps long lists navigable once facts
          accumulate. Cmd+K integration is already in scope per the design
          memory; the in-page search is the closest-to-hand affordance. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1">
          {FILTER_LABELS.map((f) => {
            const active = filter === f.kind;
            return (
              <button
                key={f.kind}
                type="button"
                onClick={() => setFilter(f.kind)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border/60 text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
              </button>
            );
          })}
        </div>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter…"
          className="h-8 max-w-xs"
        />
      </div>

      <div className="space-y-5">
        {filtered.length === 0 && (
          <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 p-6 text-center text-xs text-muted-foreground">
            No facts match this filter.
          </div>
        )}
        {filtered.map((g) => (
          <div key={`${g.subjectKind}::${g.subjectId ?? ""}`}>
            <div className="mb-2 flex items-baseline justify-between">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {KIND_LABEL[g.subjectKind] ?? g.subjectKind}
                </span>
                {g.subjectLabel && (
                  <span className="ml-2 text-sm font-medium">
                    {g.subjectLabel}
                  </span>
                )}
              </div>
              <span className="text-[11px] tabular text-muted-foreground">
                {g.facts.length} fact{g.facts.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="overflow-hidden rounded-xl border border-border/60">
              {g.facts.map((fact, i) => (
                <FactRow
                  key={fact.id}
                  fact={fact}
                  last={i === g.facts.length - 1}
                  pending={pendingFactId === fact.id}
                  onEdit={() => setEditing(fact)}
                  onDelete={() => setConfirmDelete(fact)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <Dialog open onOpenChange={(o) => !o && setEditing(null)}>
          <FactDialog
            fact={editing}
            onSubmit={async (patch) => {
              setPendingFactId(editing.id);
              const result = await editFact(editing.id, patch);
              if (!result.ok) {
                toast.error(result.error);
                setPendingFactId(null);
                return;
              }
              toast.success("Fact updated");
              setEditing(null);
              router.refresh();
              setPendingFactId(null);
            }}
          />
        </Dialog>
      )}

      <AlertDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Forget {confirmDelete ? humanizeFactKey(confirmDelete.key) : "this fact"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The fact is soft-archived — the brain stops reading it, and the
              audit history remains. You can rewrite it later by editing your
              notes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && runDelete(confirmDelete)}
            >
              Forget
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FactRow({
  fact,
  last,
  pending,
  onEdit,
  onDelete,
}: {
  fact: Fact;
  last: boolean;
  pending: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const structured = isStructuredValue(fact.value);
  const structuredEntries = structured
    ? formatStructuredEntries(fact.value)
    : null;
  const display = structured ? null : formatFactValue(fact.value);
  return (
    <div
      className={cn(
        "group flex items-start gap-3 px-4 py-3 transition-opacity",
        !last && "border-b border-border/50",
        // Dim + block pointer events on the row that's currently being
        // mutated so the user gets immediate feedback that the action
        // landed and a second click can't double-fire while the network
        // roundtrip + router.refresh() is in flight.
        pending && "pointer-events-none opacity-50",
      )}
      aria-busy={pending || undefined}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">
            {humanizeFactKey(fact.key)}
          </span>
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {fact.source}
          </span>
          {structured && (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              structured
            </span>
          )}
          <span className="shrink-0 text-[10px] tabular text-muted-foreground">
            conf {(fact.confidence ?? 0).toFixed(2)}
          </span>
        </div>
        {structuredEntries ? (
          // Editorial-tone key: value list — one line per top-level key.
          // Beats the JSON.stringify blob the row used to render.
          <ul className="mt-0.5 space-y-0.5 text-xs text-muted-foreground">
            {structuredEntries.map((entry) => (
              <li key={entry.key} className="break-words">
                <span className="font-medium">
                  {humanizeFactKey(entry.key)}:
                </span>{" "}
                <span className="text-muted-foreground/80">
                  {entry.display}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-0.5 break-words text-xs text-muted-foreground">
            {display}
          </div>
        )}
        {fact.evidence && (
          <div className="mt-0.5 break-words text-[10px] italic leading-snug text-muted-foreground/70">
            “{fact.evidence}”
          </div>
        )}
      </div>
      <div
        className={cn(
          "flex shrink-0 items-center gap-0.5 transition-opacity",
          "opacity-40 group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100",
        )}
      >
        {/* Structured facts get a read-only badge instead of an edit
            affordance — round-tripping them through the {answer:string}
            fast path would destroy the original shape. */}
        {!structured && (
          <IconBtn label="Edit" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
          </IconBtn>
        )}
        <IconBtn label="Forget" danger onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" />
        </IconBtn>
      </div>
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
      type="button"
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

// A fact value is "structured" when it carries shape beyond the
// {answer:string} fast path — for example {amount:1000, currency:'PHP'}.
// The Edit dialog only handles the fast path; structured rows expose the
// JSON for read-only review but block direct editing to avoid silent
// shape corruption.
function isStructuredValue(value: Record<string, unknown> | null): boolean {
  if (!value || typeof value !== "object") return false;
  const keys = Object.keys(value);
  if (keys.length === 0) return false;
  if (keys.length === 1 && keys[0] === "answer" && typeof value.answer === "string") {
    return false;
  }
  return true;
}

function formatFactValue(value: Record<string, unknown>): string {
  if (!value || typeof value !== "object") return String(value ?? "");
  if (typeof value.answer === "string") return value.answer;
  try {
    return JSON.stringify(value);
  } catch {
    return "(unreadable)";
  }
}

// Render structured ({amount: 1000, currency: 'PHP'}) values as a compact
// key: value list — one line per top-level key — instead of a brittle
// JSON.stringify blob. Keeps the editorial Fraunces-tone consistent with
// the rest of the surface. Falls back to JSON when nothing top-level
// parses cleanly (defensive — should never trigger on real fact rows).
function formatStructuredEntries(
  value: Record<string, unknown>,
): { key: string; display: string }[] {
  const out: { key: string; display: string }[] = [];
  for (const [key, raw] of Object.entries(value)) {
    let display: string;
    if (raw === null || raw === undefined) display = "—";
    else if (typeof raw === "string") display = raw;
    else if (typeof raw === "number" || typeof raw === "boolean")
      display = String(raw);
    else {
      try {
        display = JSON.stringify(raw);
      } catch {
        display = "(unreadable)";
      }
    }
    out.push({ key, display });
  }
  return out;
}

function FactDialog({
  fact,
  onSubmit,
}: {
  fact: Fact;
  onSubmit: (patch: {
    value?: Record<string, unknown> | string;
    confidence?: number;
    evidence?: string | null;
  }) => Promise<void>;
}) {
  // We only edit fast-path facts inline. Structured facts route here only
  // when the user explicitly opens the JSON editor — surface a clear
  // affordance so they know they're editing raw shape.
  const initialIsStructured = isStructuredValue(fact.value);
  const initialJson = (() => {
    try {
      return JSON.stringify(fact.value, null, 2);
    } catch {
      return "{}";
    }
  })();
  const [v, setV] = useState({
    value: initialIsStructured ? initialJson : formatFactValue(fact.value),
    confidence: Number(fact.confidence ?? 0.7),
    evidence: fact.evidence ?? "",
  });
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const trimmedValue = v.value.trim();
  const confidenceValid = Number.isFinite(v.confidence);
  const submitDisabled =
    pending || !trimmedValue || !confidenceValid || !!jsonError;

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Edit fact · {humanizeFactKey(fact.key)}</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <Label className="text-xs">
            {initialIsStructured ? "Value (JSON)" : "Value"}
          </Label>
          <Textarea
            value={v.value}
            onChange={(e) => {
              const next = e.target.value;
              setV({ ...v, value: next });
              if (initialIsStructured) {
                try {
                  JSON.parse(next);
                  setJsonError(null);
                } catch {
                  setJsonError("Not valid JSON.");
                }
              }
            }}
            rows={initialIsStructured ? 6 : 3}
            placeholder="What's true about this subject?"
            className={initialIsStructured ? "font-mono text-xs" : undefined}
          />
          {jsonError && (
            <p className="mt-1 text-[11px] text-destructive">{jsonError}</p>
          )}
          {initialIsStructured && !jsonError && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Structured fact — edit the JSON directly. The shape must
              round-trip cleanly or save is blocked.
            </p>
          )}
        </div>
        <div>
          {/* Single-column — the grid-cols-2 wrapper was leaving an empty
              second cell that read as a visual gap. Confidence alone is
              the only knob here; the source/audit hint below provides
              the context the empty slot used to imply. */}
          <Label className="text-xs">Confidence (0–1)</Label>
          <Input
            type="number"
            inputMode="decimal"
            step="0.05"
            min="0"
            max="1"
            value={Number.isFinite(v.confidence) ? v.confidence : ""}
            onChange={(e) => {
              // Empty / NaN should NOT silently collapse to 0 (which
              // tanks the brain's trust in the fact). Hold the prior
              // value until the user types a usable number.
              const raw = e.target.value;
              if (raw === "") {
                setV({ ...v, confidence: Number.NaN });
                return;
              }
              const next = Number(raw);
              if (Number.isFinite(next)) setV({ ...v, confidence: next });
            }}
          />
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            Saving marks this fact as user-answered — the brain stops
            overwriting it on the next extraction pass.
          </p>
        </div>
        <div>
          <Label className="text-xs">Evidence</Label>
          <Textarea
            value={v.evidence ?? ""}
            onChange={(e) => setV({ ...v, evidence: e.target.value })}
            placeholder="A short quote or note the fact came from."
            rows={2}
          />
        </div>
        <Button
          className="w-full"
          disabled={submitDisabled}
          onClick={() =>
            start(async () => {
              // Round-trip structured edits through JSON.parse so the
              // original shape is preserved. Fast-path edits stay as a
              // raw string and get wrapped by the server action.
              let nextValue: Record<string, unknown> | string = trimmedValue;
              if (initialIsStructured) {
                try {
                  nextValue = JSON.parse(trimmedValue) as Record<
                    string,
                    unknown
                  >;
                } catch {
                  setJsonError("Not valid JSON.");
                  return;
                }
              }
              await onSubmit({
                value: nextValue,
                confidence: confidenceValid
                  ? Math.max(0, Math.min(1, v.confidence))
                  : undefined,
                evidence: v.evidence?.trim() || null,
              });
            })
          }
        >
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </DialogContent>
  );
}
