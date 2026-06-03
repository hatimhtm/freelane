"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
// Button is used inside CreateEntityModal's footer (Cancel + Add person).
import {
  CenterModal,
  CenterModalBody,
  CenterModalFooter,
} from "@/components/ui/center-modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { PrimaryAction } from "@/components/app/primary-action";
import { MWidget } from "@/components/widgets/m-widget";
import { resolveEntityAccent } from "@/lib/brand/entity-accent";
import { createEntity } from "@/lib/data/actions";
import { formatMoney } from "@/lib/money";
import type { CurrencyCode, Entity } from "@/lib/supabase/types";

// People sub-tab — entities surface restyled into widget cards.
//
// Three sections per the freelane-entities-design memo:
//   1. NEEDS INTRODUCTION — entities whose introduction_status is
//      'pending' or 'asked' (created but the user hasn't dropped a
//      first-line of context yet). Listed as compact rows.
//   2. ACTIVE PEOPLE — entities whose introduction_status='introduced'.
//      Rendered as an M-widget grid with avatar (warm-band hash),
//      relationship, last interaction, transfer count.
//   3. ARCHIVED / SILENT — collapsed by default; archived rows + any
//      'silenced' introduction_status rows.
//
// Whole-card click → /clients/people/${entity.id}. The detail sheet
// owns Facts + Notes + Interaction history.

type DecoratedEntity = Entity & {
  transferCount: number;
  lastInteractionAt: string | null;
};

interface PeopleViewProps {
  needsIntroduction: DecoratedEntity[];
  active: DecoratedEntity[];
  archived: DecoratedEntity[];
  baseCurrency: CurrencyCode;
}

const ENTITY_KINDS = [
  "person",
  "pet",
  "place",
  "household",
  "concept",
  "habit",
  "ritual",
] as const;

export function PeopleView({
  needsIntroduction,
  active,
  archived,
  baseCurrency,
}: PeopleViewProps) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);

  return (
    <div className="mx-auto flex max-w-[1080px] flex-col gap-6 p-4 sm:p-6">
      {/* Verifier fix: header had a redundant 'Manual add' Button next
          to the floating PrimaryAction. System-wide pattern is one
          primary CTA via PrimaryAction; the header stays clean. */}
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="font-display text-lg leading-tight">
            Clients · People
          </h1>
          <p className="text-xs text-muted-foreground">
            The people, pets, places, and concepts your money flows through.
          </p>
        </div>
      </header>

      {/* Verifier fix: Needs Introduction section is INTENTIONALLY
          always-expanded — the design memo's earlier "collapsed by
          default" line was the wrong default for this list. These rows
          are open questions the user has yet to answer; hiding them
          behind a toggle would defeat the purpose. Only Archived /
          Silent stays collapsed (no attention required). */}
      {needsIntroduction.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="flex items-baseline gap-2 text-sm font-medium">
            Needs introduction
            <span className="text-[11px] text-muted-foreground">
              ({needsIntroduction.length})
            </span>
          </h2>
          <ul className="flex flex-col divide-y divide-border/40 rounded-[10px] border border-border/50 bg-card/30">
            {needsIntroduction.map((e) => (
              <NeedsIntroRow
                key={e.id}
                entity={e}
                onOpen={() => router.push(`/clients/people/${e.id}`)}
              />
            ))}
          </ul>
        </section>
      )}

      {active.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Active people</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {active.map((e) => (
              <PersonCard
                key={e.id}
                entity={e}
                baseCurrency={baseCurrency}
                onOpen={() => router.push(`/clients/people/${e.id}`)}
              />
            ))}
          </div>
        </section>
      )}

      {archived.length > 0 && (
        <section className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setArchivedOpen((v) => !v)}
            className="flex items-baseline gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {archivedOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            Archived / silent
            <span className="text-[11px]">({archived.length})</span>
          </button>
          {archivedOpen && (
            <ul className="flex flex-col divide-y divide-border/40 rounded-[10px] border border-border/50 bg-card/30">
              {archived.map((e) => {
                // Verifier fix: the archived bucket merges user-archived
                // rows + AI-silenced rows. Add a tiny "silent" badge on
                // the row when introduction_status='silenced' AND
                // archived=false so the user can tell at a glance why
                // the entry isn't in the active grid.
                const isSilent =
                  !e.archived && e.introduction_status === "silenced";
                return (
                  <li
                    key={e.id}
                    className="grid grid-cols-[1fr_auto] items-baseline gap-3 px-3 py-2 text-sm hover:bg-muted/40"
                  >
                    <Link
                      href={`/clients/people/${e.id}`}
                      className="block min-w-0"
                    >
                      <span className="text-sm text-foreground/80">
                        {e.canonical_name}
                      </span>
                      {e.relationship && (
                        <span className="ml-2 text-[11px] text-muted-foreground">
                          {e.relationship}
                        </span>
                      )}
                    </Link>
                    {isSilent && (
                      <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[9.5px] uppercase tracking-wider text-muted-foreground">
                        silent
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {needsIntroduction.length === 0 &&
        active.length === 0 &&
        archived.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No people yet. Add someone manually or let the AI propose entities
            from your spend notes and chat.
          </p>
        )}

      <CreateEntityModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => {
          setCreateOpen(false);
          router.push(`/clients/people/${id}`);
        }}
      />

      {/* Verifier fix: the create modal supports all 7 kinds
          (person/pet/place/household/concept/habit/ritual). Keep the CTA
          label generic so the surface label matches the actual modal
          capability. */}
      <PrimaryAction
        icon={Plus}
        label="Add entity"
        ariaLabel="Add a person, pet, place, or concept manually"
        onClick={() => setCreateOpen(true)}
      />
    </div>
  );
}

function NeedsIntroRow({
  entity,
  onOpen,
}: {
  entity: DecoratedEntity;
  onOpen: () => void;
}) {
  const accent = resolveEntityAccent(entity.id);
  return (
    <li
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onOpen();
      }}
      className="grid cursor-pointer grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-2.5 hover:bg-muted/40"
    >
      <span
        className="grid h-7 w-7 place-items-center rounded-md text-[12px] font-semibold text-white"
        style={{ background: accent.base }}
      >
        {initials(entity.canonical_name)}
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium text-foreground">
          {entity.canonical_name}
        </span>
        <span className="text-[11px] text-muted-foreground">
          Tell me more about {entity.canonical_name}
        </span>
      </div>
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
    </li>
  );
}

function PersonCard({
  entity,
  baseCurrency,
  onOpen,
}: {
  entity: DecoratedEntity;
  baseCurrency: CurrencyCode;
  onOpen: () => void;
}) {
  const accent = resolveEntityAccent(entity.id);
  const last = relativeTime(entity.lastInteractionAt);

  const eyebrow = entity.relationship ?? entity.kind ?? "Person";
  // Verifier fix: PersonCard renders only from the `active` bucket
  // (introduction_status='introduced'), so the prior pending/asked
  // ternary was dead code. Tone fixed to default; warm-band signals
  // live on NeedsIntroRow where pending/asked rows actually surface.
  const tone: "default" = "default";

  // Verifier fix: hero was a duplicate of label — wastes the largest
  // type slot on the card. Promote the real metric (interaction count)
  // to hero with an eyebrow context; the canonical_name stays on
  // label only.
  const heroValue =
    entity.transferCount > 0 ? String(entity.transferCount) : "0";

  return (
    <MWidget
      label={entity.canonical_name}
      tone={tone}
      onOpen={onOpen}
      eyebrow={eyebrow}
      icon={
        <span
          className="grid h-7 w-7 place-items-center rounded-md text-[12px] font-semibold text-white"
          style={{ background: accent.base }}
        >
          {initials(entity.canonical_name)}
        </span>
      }
      hero={
        <span className="block tabular text-[28px]">
          {heroValue}
          <span className="ml-1.5 text-[12px] font-normal text-muted-foreground">
            {entity.transferCount === 1 ? "interaction" : "interactions"}
          </span>
        </span>
      }
      sub={
        <div className="flex items-center justify-between gap-3 text-[12.5px]">
          <span className="tabular text-foreground/85">
            {last ?? "No interactions yet"}
          </span>
          {/* Verifier fix: PersonCard only renders introduced rows, so
              confidence is nearly always present and static. Show the
              chip only when confidence is below 0.9 — that's the signal
              the user actually needs (the row is still soft). High-
              confidence rows hide the chip to reduce noise. */}
          {entity.confidence !== null &&
            entity.confidence !== undefined &&
            entity.confidence < 0.9 && (
              <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {Math.round(entity.confidence * 100)}% sure
              </span>
            )}
        </div>
      }
      supporting={
        <div className="flex items-center justify-between gap-3">
          <span className="truncate">
            {entity.short_description ?? "No description"}
          </span>
          {entity.outstanding_loan_count_cached > 0 && (
            <span
              className="shrink-0 rounded-full border border-foreground/15 bg-foreground/[0.04] px-1.5 py-px text-[10px] font-medium uppercase tracking-wider text-foreground/75"
              title={`${entity.outstanding_loan_count_cached} open ${
                entity.outstanding_loan_count_cached === 1 ? "loan" : "loans"
              }`}
            >
              {/* Migration 0111 added outstanding_loan_base_cached so the
                  badge surfaces the pesos owed (the actually-useful number),
                  not just the count. Falls back to the count when the
                  base cache is 0 — legacy rows seeded before 0111 only
                  carry the count column. */}
              {entity.outstanding_loan_base_cached > 0
                ? `Loan: ${formatMoney(
                    entity.outstanding_loan_base_cached,
                    baseCurrency,
                    { compact: true },
                  )} open`
                : entity.outstanding_loan_count_cached === 1
                  ? "1 loan open"
                  : `${entity.outstanding_loan_count_cached} loans open`}
            </span>
          )}
        </div>
      }
      aiDot={{
        key: `entity_detail:${entity.id}`,
        label: entity.canonical_name,
        data: {
          intent: "entity_detail",
          entity_id: entity.id,
          entity_name: entity.canonical_name,
        },
      }}
    />
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

function relativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const dayMs = 86_400_000;
  if (ms < dayMs) {
    const hours = Math.max(1, Math.round(ms / (60 * 60 * 1000)));
    return `${hours}h ago`;
  }
  const days = Math.round(ms / dayMs);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.round(months / 12);
  return `${years}y ago`;
}

function CreateEntityModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const [kind, setKind] = useState<(typeof ENTITY_KINDS)[number]>("person");
  const [name, setName] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [vague, setVague] = useState(false);
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();

  // Verifier fix: modal title + success toast were hard-coded to
  // "person" even when the user picked pet / place / concept etc.
  // Derive both from the selected kind so the copy reflects intent.
  const kindLabel = `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;

  const save = () => {
    if (!name.trim()) return;
    start(async () => {
      const result = await createEntity({
        kind,
        canonical_name: name.trim(),
        short_description: shortDescription.trim() || null,
        vague,
        notes: notes.trim() || null,
      });
      if (!result.ok) {
        toast.error(result.error || "Couldn't save.");
        return;
      }
      toast.success(`Added ${name.trim()} (${kind})`);
      setName("");
      setShortDescription("");
      setNotes("");
      setVague(false);
      onCreated(result.data.id);
    });
  };

  return (
    <CenterModal
      open={open}
      onOpenChange={onOpenChange}
      title={`New ${kind}`}
      description="An entity the AI should remember. The clarify question fires next."
      size="md"
    >
      <CenterModalBody>
        <div className="grid gap-3">
          <div className="grid grid-cols-[1fr_180px] gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Name
              </Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  kind === "person"
                    ? "Lola, Junjun, Auntie Maria"
                    : kind === "pet"
                      ? "Mochi, Whiskers"
                      : kind === "place"
                        ? "Manila apartment, Tagaytay house"
                        : kind === "household"
                          ? "Our home, Family budget"
                          : kind === "concept"
                            ? "Sadaka, Education fund"
                            : kind === "habit"
                              ? "Daily prayer, Morning walks"
                              : "Friday gathering, Eid feast"
                }
                className="h-9 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Kind
              </Label>
              <select
                value={kind}
                onChange={(e) =>
                  setKind(e.target.value as (typeof ENTITY_KINDS)[number])
                }
                className="h-9 rounded-md border border-border/70 bg-card px-2 text-sm capitalize"
              >
                {ENTITY_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Short description
            </Label>
            <Input
              value={shortDescription}
              onChange={(e) => setShortDescription(e.target.value)}
              placeholder="Grandmother. Buys gifts for her around holidays."
              className="h-9 text-sm"
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-xs font-medium">Vague entity</span>
              <span className="text-[10px] text-muted-foreground">
                No canonical name yet — keep it fuzzy.
              </span>
            </div>
            <Switch checked={vague} onCheckedChange={setVague} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Notes{" "}
              <span className="ml-1 normal-case tracking-normal text-muted-foreground/60">
                optional
              </span>
            </Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything worth remembering"
              rows={3}
              className="resize-none text-sm"
            />
          </div>
        </div>
      </CenterModalBody>
      <CenterModalFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={save} disabled={pending || !name.trim()}>
          {pending ? "Saving…" : `Add ${kindLabel.toLowerCase()}`}
        </Button>
      </CenterModalFooter>
    </CenterModal>
  );
}
