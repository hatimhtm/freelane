"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { resolveEntityAccent } from "@/lib/brand/entity-accent";
import { formatMoney } from "@/lib/money";
import { updateEntity } from "@/lib/data/actions";
import { extractEntityFactsAction } from "@/lib/ai/entity-facts-actions";
import { AiDot } from "@/components/widgets/ai-dot";
import type {
  CurrencyCode,
  Entity,
  Spend,
  SpendEntityLink,
} from "@/lib/supabase/types";
import type { Fact } from "@/lib/ai/facts";
import type { ClientPatternHistoryRow } from "@/lib/data/queries";

// Entity detail sheet — Header + Facts + Notes (debounced extraction)
// + Interaction history + Pattern-change timeline + scoped AI dot.
//
// Facts panel mirrors the Clients facts panel (transparent view + edit
// affordances). Notes save fires extractEntityFactsAction 30s after the
// last keystroke (debounce) — same pattern as Clients. Interaction
// history pulls beneficiary spends + legacy spend_entity_links rows so
// both money paths surface. Pattern-change timeline mirrors the Clients
// surface — entity_pattern_change notifications + answered open-questions
// merged in chronological order.

const NOTES_DEBOUNCE_MS = 30_000;

interface EntityDetailSheetProps {
  entity: Entity;
  links: SpendEntityLink[];
  spends: Spend[];
  facts: Fact[];
  patternHistory: ClientPatternHistoryRow[];
  baseCurrency: CurrencyCode;
}

export function EntityDetailSheet({
  entity,
  links,
  spends,
  facts,
  patternHistory,
  baseCurrency,
}: EntityDetailSheetProps) {
  const accent = resolveEntityAccent(entity.id);
  const router = useRouter();

  // Build the interaction-history list — union beneficiary_entity_id
  // spends + spend_entity_links rows. The Spend rows queried by
  // getEntityDetail are user-wide, so we narrow by the union of:
  //   1. links.spend_id for this entity
  //   2. spend.beneficiary_entity_id === entity.id
  const linkedSpendIds = new Set(links.map((l) => l.spend_id));
  const interactions = spends
    .filter(
      (s) =>
        linkedSpendIds.has(s.id) ||
        (s as Spend & { beneficiary_entity_id?: string | null })
          .beneficiary_entity_id === entity.id,
    )
    .sort((a, b) => b.spent_at.localeCompare(a.spent_at));
  const totalBase = interactions.reduce(
    (sum, s) => sum + Number(s.amount_base ?? 0),
    0,
  );

  return (
    <div className="group relative flex flex-col gap-5">
      {/* AI dot scoped to this entity — opens the chatbot with
          entity_detail context. */}
      <AiDot
        card={{
          key: `entity_detail:${entity.id}`,
          label: entity.canonical_name,
          data: {
            intent: "entity_detail",
            entity_id: entity.id,
            entity_name: entity.canonical_name,
          },
        }}
      />

      {/* Header */}
      <header className="flex items-baseline gap-3">
        <span
          className="grid h-12 w-12 place-items-center rounded-lg text-[16px] font-semibold text-white"
          style={{ background: accent.base }}
        >
          {initials(entity.canonical_name)}
        </span>
        <div className="flex flex-col">
          <h1 className="font-display text-xl leading-tight">
            {entity.canonical_name}
          </h1>
          <span className="text-xs text-muted-foreground">
            {entity.relationship ?? entity.kind ?? "Person"}
            {entity.short_description ? ` — ${entity.short_description}` : ""}
          </span>
        </div>
      </header>

      {/* Facts panel */}
      {facts.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium">
            What the AI has learned
          </h2>
          <ul className="divide-y divide-border/40 overflow-hidden rounded-xl border border-border/60 bg-card">
            {facts.map((f) => (
              <li key={f.id} className="grid grid-cols-[1fr_auto] gap-2 px-3 py-2">
                <div className="flex min-w-0 flex-col">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {humanizeKey(f.key)}
                  </span>
                  <span className="text-sm text-foreground">
                    {readFactValue(f.value)}
                  </span>
                  {f.evidence && (
                    <span className="text-[11px] italic text-muted-foreground">
                      “{f.evidence}”
                    </span>
                  )}
                </div>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {Math.round(f.confidence * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Notes with debounced extraction */}
      <NotesPanel
        entityId={entity.id}
        initialNotes={entity.notes ?? ""}
        onSaved={() => router.refresh()}
      />

      {/* Interaction history */}
      <section>
        <h2 className="mb-2 flex items-baseline justify-between gap-2 text-sm font-medium">
          <span>Interaction history</span>
          <span className="text-[11px] text-muted-foreground">
            {interactions.length} entries ·{" "}
            {formatMoney(totalBase, baseCurrency, { compact: true })}
          </span>
        </h2>
        {interactions.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No money has flowed through {entity.canonical_name} yet.
          </p>
        ) : (
          <ul className="divide-y divide-border/40 overflow-hidden rounded-xl border border-border/60 bg-card">
            {interactions.slice(0, 50).map((s) => (
              <li
                key={s.id}
                className="grid grid-cols-[auto_1fr_auto] items-baseline gap-3 px-3 py-2 text-sm"
              >
                <span className="text-[11px] tabular text-muted-foreground">
                  {s.spent_at}
                </span>
                <span className="truncate text-foreground/85">
                  {s.description ?? "—"}
                </span>
                <span className="tabular text-foreground/85">
                  {formatMoney(Number(s.amount_base ?? 0), baseCurrency, {
                    compact: true,
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Pattern-change timeline — mirrors the Clients surface. Each
          row shows what the brain noticed + (if answered) what the user
          chose. Hidden when empty so a fresh entity isn't cluttered. */}
      {patternHistory.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-baseline justify-between gap-2 text-sm font-medium">
            <span>Pattern shifts</span>
            <span className="text-[11px] text-muted-foreground">
              {patternHistory.length}{" "}
              {patternHistory.length === 1 ? "entry" : "entries"}
            </span>
          </h2>
          <ul className="divide-y divide-border/40 overflow-hidden rounded-xl border border-border/60 bg-card">
            {patternHistory.slice(0, 20).map((row) => (
              <li
                key={row.id}
                className="flex flex-col gap-1 px-3 py-2 text-sm"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[10.5px] uppercase tracking-wider text-muted-foreground">
                    {row.pattern_kind ?? "shift"}
                  </span>
                  <span className="text-[10.5px] tabular text-muted-foreground">
                    {row.created_at.slice(0, 10)}
                  </span>
                </div>
                {row.summary && (
                  <span className="text-[13px] text-foreground/85">
                    {row.summary}
                  </span>
                )}
                {row.question && (
                  <span className="text-[12px] italic text-muted-foreground">
                    {row.question}
                  </span>
                )}
                {row.answer && (
                  <span className="text-[12px] text-foreground/85">
                    You said: {row.answer}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// Notes textarea with 30s debounced auto-save + extraction. Mirrors the
// Clients notes panel pattern — save → updateEntity then fire-and-forget
// extractEntityFactsAction.
function NotesPanel({
  entityId,
  initialNotes,
  onSaved,
}: {
  entityId: string;
  initialNotes: string;
  onSaved: () => void;
}) {
  const [notes, setNotes] = useState(initialNotes);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(initialNotes);

  useEffect(() => {
    if (notes === lastSaved.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      start(async () => {
        try {
          await updateEntity(entityId, { notes: notes.trim() || null });
          lastSaved.current = notes;
          onSaved();
          // Verifier fix: extraction is fire-and-forget — don't await.
          // The prior `await` held the pending/"Saving…" UI state open
          // through the AI extraction round-trip (seconds), not just
          // the DB write (milliseconds). `void` here lets the brain
          // run in the background as the comment intends; facts
          // appear on the next render.
          void extractEntityFactsAction(entityId, notes).catch(() => {});
        } catch (err) {
          toast.error((err as Error).message);
        }
      });
    }, NOTES_DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [notes, entityId, onSaved]);

  return (
    <section>
      <h2 className="mb-2 flex items-baseline justify-between gap-2 text-sm font-medium">
        <span>Notes</span>
        <span className="text-[11px] text-muted-foreground">
          {pending ? "Saving…" : notes === lastSaved.current ? "Saved" : "Auto-saves in 30s"}
        </span>
      </h2>
      <Textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={5}
        placeholder="Anything worth remembering. The AI reads this and extracts structured facts."
        className="w-full resize-none text-sm"
      />
      <div className="mt-2 flex justify-end">
        <Button
          size="sm"
          variant="ghost"
          disabled={pending || notes === lastSaved.current}
          onClick={() => {
            if (timer.current) clearTimeout(timer.current);
            start(async () => {
              try {
                await updateEntity(entityId, { notes: notes.trim() || null });
                lastSaved.current = notes;
                onSaved();
                // Same fire-and-forget pattern as the debounced auto-save.
                void extractEntityFactsAction(entityId, notes).catch(() => {});
              } catch (err) {
                toast.error((err as Error).message);
              }
            });
          }}
        >
          Save now
        </Button>
      </div>
    </section>
  );
}

function initials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (parts.length === 0) return "?";
  return parts.map((p) => p[0]!.toUpperCase()).join("");
}

function humanizeKey(key: string): string {
  return key.replace(/_/g, " ");
}

function readFactValue(v: Record<string, unknown>): string {
  if (typeof v.answer === "string") return v.answer;
  return JSON.stringify(v);
}
