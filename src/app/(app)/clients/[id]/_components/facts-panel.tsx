"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { editFact, deleteFact } from "@/lib/ai/facts-actions";
import type { ClientFactRow } from "@/lib/data/queries";

// How long the inline "Delete?" affordance stays armed before reverting
// to the trash icon. Matches the verifier suggestion (~3s) — long enough
// to read and confirm without leaving a destructive button in reach.
const DELETE_ARM_MS = 3_000;

// Facts panel — transparent view into the AI's per-client memory.
//
// Hatim sees every row the chatbot stored about this client, the source
// (user_answered vs. inferred), the confidence pip, and the evidence
// excerpt that triggered the inference. Each row is editable inline OR
// archive-able (soft-delete via deleteFact).
//
// Empty state is hidden by the parent — the widget memo says
// "relevance-gated". When no facts exist the panel doesn't render at all.

type FactsPanelProps = {
  facts: ClientFactRow[];
};

export function FactsPanel({ facts }: FactsPanelProps) {
  if (facts.length === 0) {
    // Modular relevance-gating: empty panels hide entirely so a clean
    // client surface stays clean.
    return null;
  }
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium">What the AI has learned</h2>
      <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
        <ul className="divide-y divide-border/60">
          {facts.map((f) => (
            <FactRow key={f.id} fact={f} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function FactRow({ fact }: { fact: ClientFactRow }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(extractValueString(fact.value));
  const [pending, start] = useTransition();
  // Inline confirm-in-place — first click arms, second click commits.
  // Replaces a browser-native confirm() that clashed with the rest of
  // the design language (Sonner toasts + CenterModal). Auto-disarms
  // after DELETE_ARM_MS so a stray click can't sit waiting to delete.
  const [armed, setArmed] = useState(false);
  const disarmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const labelKey = humanizeKey(fact.key);
  const sourceLabel = fact.source === "user_answered" ? "you confirmed" : "learned from note";

  useEffect(() => {
    return () => {
      if (disarmTimer.current) clearTimeout(disarmTimer.current);
    };
  }, []);

  function onSave() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    start(async () => {
      const res = await editFact(fact.id, { value: trimmed });
      if (!res.ok) {
        toast.error(res.error || "Couldn't save.");
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  function onDeleteClick() {
    if (!armed) {
      setArmed(true);
      if (disarmTimer.current) clearTimeout(disarmTimer.current);
      disarmTimer.current = setTimeout(() => setArmed(false), DELETE_ARM_MS);
      return;
    }
    if (disarmTimer.current) clearTimeout(disarmTimer.current);
    setArmed(false);
    start(async () => {
      const res = await deleteFact(fact.id);
      if (!res.ok) {
        toast.error(res.error || "Couldn't delete.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              {labelKey}
            </span>
            <ConfidencePip confidence={fact.confidence} />
            <span className="text-[10px] text-muted-foreground/70">
              · {sourceLabel}
            </span>
          </div>
          {editing ? (
            <div className="mt-1.5 flex items-center gap-2">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="flex-1 rounded-md border border-border/70 bg-background px-2 py-1 text-sm"
                autoFocus
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={onSave}
                disabled={pending}
                aria-label="Save"
              >
                <Check className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraft(extractValueString(fact.value));
                  setEditing(false);
                }}
                disabled={pending}
                aria-label="Cancel"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="mt-1 text-sm text-foreground">
              {extractValueString(fact.value)}
            </div>
          )}
          {fact.evidence && !editing && (
            <div className="mt-1 truncate text-[11px] italic text-muted-foreground/70">
              &ldquo;{fact.evidence}&rdquo;
            </div>
          )}
        </div>
        {!editing && (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setEditing(true)}
              aria-label="Edit fact"
              className="h-7 w-7 p-0"
              disabled={pending}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onDeleteClick}
              aria-label={armed ? `Confirm delete "${labelKey}"` : "Delete fact"}
              className={cn(
                "h-7 px-2 text-rose-500 hover:text-rose-600",
                armed ? "text-[11px] font-medium" : "w-7 p-0",
              )}
              disabled={pending}
            >
              {armed ? "Delete?" : <Trash2 className="h-3.5 w-3.5" />}
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

function ConfidencePip({ confidence }: { confidence: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, confidence)) * 100);
  const tone =
    pct >= 80 ? "bg-foreground" : pct >= 50 ? "bg-foreground/60" : "bg-foreground/30";
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"
      title={`Confidence ${pct}%`}
    >
      <span className={cn("inline-block h-1.5 w-1.5 rounded-full", tone)} />
      {pct}%
    </span>
  );
}

function humanizeKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractValueString(value: Record<string, unknown> | null): string {
  if (!value) return "";
  // The facts schema stores values as { answer: string } most of the time
  // (open-questions-actions writes that shape; the extraction brain does
  // too). For unknown shapes — rather than leak raw JSON into the panel —
  // surface a neutral placeholder. The fact id + key remain in the row so
  // the user can still edit/delete; the value itself stays opaque until a
  // future brain establishes a renderer.
  const v = value as { answer?: unknown };
  if (typeof v.answer === "string") return v.answer;
  return "Complex value";
}
