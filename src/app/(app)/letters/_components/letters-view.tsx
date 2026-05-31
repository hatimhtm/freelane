"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bookmark, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { motion } from "motion/react";

import { Button } from "@/components/ui/button";
import { CenterModal, CenterModalBody, CenterModalFooter } from "@/components/ui/center-modal";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  deleteLetterAction,
  deleteLifeShiftAction,
  deleteMilestoneAction,
  deleteQuietReceiptAction,
  dismissMilestoneSurfacingAction,
  logLifeShiftAction,
  pinLetterAction,
  refreshLetterAction,
  runMilestoneSweepAction,
} from "@/lib/data/actions";
import { cn } from "@/lib/utils";
import type {
  EditorialLetter,
  EditorialLetterKind,
  LifeShift,
  Milestone,
  QuietReceipt,
} from "@/lib/supabase/types";

const TABS = ["letters", "milestones", "receipts", "what-changed"] as const;
type TabId = (typeof TABS)[number];

const KIND_LABEL: Record<EditorialLetterKind, string> = {
  end_of_month: "End of month",
  spotlight: "Spotlight",
  sunday: "Sunday",
  year: "Year",
  anniversary: "Anniversary",
  regret_mark: "Two-month mark",
};

const REFRESHABLE: EditorialLetterKind[] = [
  "end_of_month",
  "spotlight",
  "sunday",
  "year",
  "anniversary",
  "regret_mark",
];

interface LettersViewProps {
  letters: EditorialLetter[];
  milestones: Milestone[];
  receipts: QuietReceipt[];
  shifts: LifeShift[];
}

export function LettersView({ letters, milestones, receipts, shifts }: LettersViewProps) {
  const [tab, setTab] = useState<TabId>("letters");
  const [generateModal, setGenerateModal] = useState(false);
  const [logShiftModal, setLogShiftModal] = useState(false);

  return (
    <div className="mx-auto flex max-w-[1080px] flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="font-display text-lg leading-tight">Letters</h1>
          <p className="text-xs text-muted-foreground">
            Quiet writing back to you. Pin one, reply, let the corpus learn.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {tab === "letters" && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setGenerateModal(true)}
              className="h-8 gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Generate
            </Button>
          )}
          {tab === "what-changed" && (
            <Button size="sm" onClick={() => setLogShiftModal(true)} className="h-8 gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Log a shift
            </Button>
          )}
        </div>
      </header>

      <div className="flex gap-1.5 border-b border-border/40">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "border-b-2 px-3 py-1.5 text-[12px] font-medium tracking-wide transition-colors",
              tab === t
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground/80",
            )}
          >
            {tabLabel(t, letters, milestones, receipts, shifts)}
          </button>
        ))}
      </div>

      {tab === "letters" && <LettersTab letters={letters} />}
      {tab === "milestones" && <MilestonesTab milestones={milestones} />}
      {tab === "receipts" && <ReceiptsTab receipts={receipts} />}
      {tab === "what-changed" && <WhatChangedTab shifts={shifts} />}

      <GenerateLetterModal open={generateModal} onOpenChange={setGenerateModal} />
      <LogLifeShiftModal open={logShiftModal} onOpenChange={setLogShiftModal} />
    </div>
  );
}

function tabLabel(
  id: TabId,
  letters: EditorialLetter[],
  milestones: Milestone[],
  receipts: QuietReceipt[],
  shifts: LifeShift[],
): string {
  const map = {
    letters: `Letters · ${letters.length}`,
    milestones: `Milestones · ${milestones.length}`,
    receipts: `Quiet receipts · ${receipts.length}`,
    "what-changed": `What changed · ${shifts.length}`,
  } as const;
  return map[id];
}

function LettersTab({ letters }: { letters: EditorialLetter[] }) {
  const grouped = useMemo(() => {
    const m = new Map<EditorialLetterKind, EditorialLetter[]>();
    for (const l of letters) {
      const arr = m.get(l.kind) ?? [];
      arr.push(l);
      m.set(l.kind, arr);
    }
    return m;
  }, [letters]);

  if (letters.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border/60 px-4 py-12 text-center text-xs text-muted-foreground">
        No letters yet. Click <span className="font-medium">Generate</span> to write the first one.
      </div>
    );
  }

  const order: EditorialLetterKind[] = ["year", "end_of_month", "spotlight", "sunday", "anniversary", "regret_mark"];

  return (
    <div className="flex flex-col gap-5">
      {order
        .filter((k) => (grouped.get(k) ?? []).length > 0)
        .map((kind) => (
          <section key={kind} className="flex flex-col gap-2">
            <h2 className="font-display text-sm font-medium">{KIND_LABEL[kind]}</h2>
            <ul className="flex flex-col divide-y divide-border/40 rounded-[10px] border border-border/50 bg-card/30">
              {(grouped.get(kind) ?? []).map((l) => (
                <LetterRow key={l.id} letter={l} />
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}

function LetterRow({ letter }: { letter: EditorialLetter }) {
  const router = useRouter();
  return (
    <li className="grid grid-cols-[1fr_auto] items-start gap-3 px-3 py-2.5 hover:bg-muted/40">
      <Link href={`/letters/${letter.id}`} className="block min-w-0">
        <div className="flex flex-wrap items-baseline gap-1.5">
          <span className="text-sm font-medium text-foreground">{letter.headline}</span>
          {letter.pinned && (
            <span className="rounded-full border border-acid-lime/50 px-2 py-0.5 text-[10px] uppercase tracking-wider text-acid-lime">
              pinned
            </span>
          )}
          {letter.reply && (
            <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              replied
            </span>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {letter.period_key} · {letter.generated_at.slice(0, 10)}
        </div>
      </Link>
      <div className="flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={letter.pinned ? `Unpin letter ${letter.headline}` : `Pin letter ${letter.headline}`}
          onClick={async () => {
            try {
              await pinLetterAction(letter.id, !letter.pinned);
              router.refresh();
            } catch (err) {
              toast.error((err as Error).message);
            }
          }}
        >
          <Bookmark className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete letter ${letter.headline}`}
          onClick={async () => {
            try {
              await deleteLetterAction(letter.id);
              toast.success("Letter removed");
              router.refresh();
            } catch (err) {
              toast.error((err as Error).message);
            }
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </li>
  );
}

function MilestonesTab({ milestones }: { milestones: Milestone[] }) {
  const router = useRouter();
  if (milestones.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border/60 px-4 py-12 text-center text-xs text-muted-foreground">
        No milestones yet. Run the sweep to look for crossings.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <Button
        size="sm"
        variant="secondary"
        className="h-8 w-fit gap-1.5"
        onClick={async () => {
          try {
            const res = await runMilestoneSweepAction();
            toast.success(`${res.recorded} new milestone${res.recorded === 1 ? "" : "s"}.`);
            router.refresh();
          } catch (err) {
            toast.error((err as Error).message);
          }
        }}
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Sweep for new milestones
      </Button>
      <ul className="flex flex-col divide-y divide-border/40 rounded-[10px] border border-border/50 bg-card/30">
        {milestones.map((m) => (
          <li key={m.id} className="grid grid-cols-[1fr_auto] items-start gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">{m.label}</div>
              <div className="text-[12px] leading-snug text-muted-foreground">{m.narrative}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                {m.achieved_at} · {m.kind}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {m.surfaced && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Dismiss milestone from Today"
                  onClick={async () => {
                    await dismissMilestoneSurfacingAction(m.id);
                    router.refresh();
                  }}
                  title="Dismiss from Today"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete milestone ${m.label}`}
                onClick={async () => {
                  await deleteMilestoneAction(m.id);
                  router.refresh();
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReceiptsTab({ receipts }: { receipts: QuietReceipt[] }) {
  const router = useRouter();
  if (receipts.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border/60 px-4 py-12 text-center text-xs text-muted-foreground">
        No quiet receipts yet. They'll appear when a loan closes, a recurring rule pauses, a plan commits, etc.
      </div>
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-border/40 rounded-[10px] border border-border/50 bg-card/30">
      {receipts.map((r) => (
        <li key={r.id} className="grid grid-cols-[1fr_auto] items-start gap-3 px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-sm leading-snug text-foreground">{r.narrative}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
              {r.occurred_at} · {r.kind}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Delete receipt"
            onClick={async () => {
              await deleteQuietReceiptAction(r.id);
              router.refresh();
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </li>
      ))}
    </ul>
  );
}

function WhatChangedTab({ shifts }: { shifts: LifeShift[] }) {
  const router = useRouter();
  if (shifts.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border/60 px-4 py-12 text-center text-xs text-muted-foreground">
        No life shifts yet. They'll appear when something structurally changes — rent moves, a rule pauses, a new currency lands.
      </div>
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-border/40 rounded-[10px] border border-border/50 bg-card/30">
      {shifts.map((s) => (
        <li key={s.id} className="grid grid-cols-[1fr_auto] items-start gap-3 px-3 py-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">{s.label}</div>
            {(s.before_value || s.after_value) && (
              <div className="text-[11px] text-muted-foreground">
                {s.before_value ?? "—"} → {s.after_value ?? "—"}
              </div>
            )}
            <p className="mt-1 text-[12px] leading-relaxed text-foreground/80">{s.narrative}</p>
            <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground/70">
              {s.occurred_at} · {s.kind}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete life shift ${s.label}`}
            onClick={async () => {
              await deleteLifeShiftAction(s.id);
              router.refresh();
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </li>
      ))}
    </ul>
  );
}

function GenerateLetterModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [kind, setKind] = useState<EditorialLetterKind>("end_of_month");

  return (
    <CenterModal
      open={open}
      onOpenChange={onOpenChange}
      title="Generate a letter"
      description="Pick the kind. The AI writes it; you read, pin, reply."
      size="md"
    >
      <CenterModalBody>
        <div className="flex flex-col gap-1.5">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Kind</Label>
          <div className="flex flex-wrap gap-1.5">
            {REFRESHABLE.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium",
                  kind === k
                    ? "border-foreground bg-foreground text-background"
                    : "border-border/70 text-foreground/80 hover:bg-muted",
                )}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            The letter regenerates if one already exists for the current period — pinned letters and existing replies are preserved.
          </p>
        </div>
      </CenterModalBody>
      <CenterModalFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              try {
                const res = await refreshLetterAction({ kind, force: true });
                if (res?.id) {
                  toast.success("Letter written.");
                  onOpenChange(false);
                  router.push(`/letters/${res.id}`);
                } else {
                  toast.error("Generation failed — try again.");
                }
              } catch (err) {
                toast.error((err as Error).message);
              }
            })
          }
        >
          {pending ? "Writing…" : "Write it"}
        </Button>
      </CenterModalFooter>
    </CenterModal>
  );
}

function LogLifeShiftModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState("rent_changed");
  const [before, setBefore] = useState("");
  const [after, setAfter] = useState("");
  const [narrative, setNarrative] = useState("");

  function reset() {
    setLabel("");
    setKind("rent_changed");
    setBefore("");
    setAfter("");
    setNarrative("");
  }

  return (
    <CenterModal
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
      title="Log a life shift"
      description="Something structural changed — rent moved, a rule paused, a new currency landed."
      size="md"
    >
      <CenterModalBody>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Label
            </Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Rent shifted ₱3,500 → ₱4,200"
              className="h-9 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Kind
            </Label>
            <Input
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              placeholder="rent_changed"
              className="h-9 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Before
              </Label>
              <Input
                value={before}
                onChange={(e) => setBefore(e.target.value)}
                placeholder="₱3,500"
                className="h-9 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                After
              </Label>
              <Input
                value={after}
                onChange={(e) => setAfter(e.target.value)}
                placeholder="₱4,200"
                className="h-9 text-sm"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Narrative <span className="ml-1 normal-case tracking-normal text-muted-foreground/60">optional — AI writes if blank</span>
            </Label>
            <Textarea
              value={narrative}
              onChange={(e) => setNarrative(e.target.value)}
              placeholder="A short paragraph naming the change."
              rows={3}
              className="resize-none text-sm"
            />
          </div>
        </motion.div>
      </CenterModalBody>
      <CenterModalFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          disabled={pending || !label.trim() || !kind.trim()}
          onClick={() =>
            start(async () => {
              try {
                await logLifeShiftAction({
                  kind: kind.trim(),
                  label: label.trim(),
                  beforeValue: before.trim() || undefined,
                  afterValue: after.trim() || undefined,
                  narrative: narrative.trim() || undefined,
                });
                toast.success("Shift recorded.");
                onOpenChange(false);
                reset();
                router.refresh();
              } catch (err) {
                toast.error((err as Error).message);
              }
            })
          }
        >
          {pending ? "Recording…" : "Record"}
        </Button>
      </CenterModalFooter>
    </CenterModal>
  );
}
