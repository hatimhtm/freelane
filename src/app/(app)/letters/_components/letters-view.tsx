"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  CenterModal,
  CenterModalBody,
  CenterModalFooter,
} from "@/components/ui/center-modal";
import { Label } from "@/components/ui/label";
import { useNotificationModal } from "@/components/app/notification-modal-host";
import { LetterReader } from "@/components/letters/letter-reader";
import {
  loadMoreLettersAction,
  type LoadMoreLettersFilters,
} from "@/lib/data/letters-actions";
import { refreshLetterAction } from "@/lib/data/actions";
import { cn, phtDateString } from "@/lib/utils";
import type {
  EditorialLetter,
  EditorialLetterKind,
} from "@/lib/supabase/types";

// Letters archive page (freelane-letters-design 2026-06-02). Paginated
// list, most recent first, 12 letters per page. Filter chips: year +
// theme. Letters live forever — no archive cutoff. Whole-card click
// opens the letter-reader modal (NOT navigation), unless the user wants
// a deep link to /letters/[id] (browser back button still works because
// the modal is a transient overlay).
//
// The page no longer surfaces milestones / receipts / what-changed tabs
// — those moved to the /activity feed (single source of truth for
// editorial activity). The Generate button stays for manual one-off
// letter writing (the worth-saying gate doesn't apply to manual generation;
// the user explicitly asked for it).

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

const PAGE_SIZE = 12;

interface LettersViewProps {
  letters: EditorialLetter[];
  hasMore: boolean;
  // Server-derived distinct PHT years across the user's full letter
  // archive. Drives the year-filter chip set so a user with letters in
  // 2024 can still filter to 2024 before paginating past the 2026
  // initial page.
  availableYears: number[];
  // Seeded from /letters?year=YYYY (Stats RecentLettersWidget see-all).
  initialYear?: number | null;
  // Seeded from /letters?client=<id>. The archive applies a client
  // narrowing through the same LettersScope the Stats subtab uses.
  initialClientId?: string | null;
}

export function LettersView({
  letters,
  hasMore,
  availableYears,
  initialYear = null,
  initialClientId = null,
}: LettersViewProps) {
  const [rows, setRows] = useState<EditorialLetter[]>(letters);
  const [more, setMore] = useState(hasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const [generateModal, setGenerateModal] = useState(false);
  const [yearFilter, setYearFilter] = useState<number | null>(initialYear);
  const [themeFilter, setThemeFilter] = useState<EditorialLetterKind | null>(
    null,
  );
  // Client narrowing is a read-only badge (no chip in the bar — the link
  // came from a Stats scope; the user clears it via Cmd+K / back nav).
  const [clientIdFilter] = useState<string | null>(initialClientId);

  // Year chip set comes from the server so the user can filter to a
  // year that exists in the archive even before paginating past it.
  // We also fold in any years discovered in the currently-loaded rows
  // (server may add new ones after a future write while the page is
  // still open).
  const years = useMemo(() => {
    const set = new Set<number>(availableYears);
    for (const r of rows) {
      // PHT year — matches the server-side bucketing the load-more
      // query applies (gte/lt on PHT-anchored UTC bounds).
      const y = Number(phtDateString(new Date(r.generated_at)).slice(0, 4));
      if (!Number.isNaN(y)) set.add(y);
    }
    return Array.from(set).sort((a, b) => b - a);
  }, [rows, availableYears]);

  // Client-side filter pass for the chip set. The server load-more
  // applies the SAME filters server-side so the next page returns rows
  // that already match. Keeping the client filter mirrored means
  // toggling a chip is instant for letters already loaded.
  //
  // Year is bucketed by PHT date — matches the server's
  // gte('${year}-01-01') / lt('${year+1}-01-01') predicates so we don't
  // drift around the UTC↔PHT day boundary.
  const visible = useMemo(() => {
    return rows.filter((r) => {
      if (themeFilter && r.kind !== themeFilter) return false;
      if (yearFilter) {
        const y = Number(phtDateString(new Date(r.generated_at)).slice(0, 4));
        if (y !== yearFilter) return false;
      }
      return true;
    });
  }, [rows, themeFilter, yearFilter]);

  const filters: LoadMoreLettersFilters = {
    year: yearFilter,
    theme: themeFilter,
    clientId: clientIdFilter,
  };

  // Refetch from offset 0 whenever the user changes a filter chip. The
  // initial page-load rows are unfiltered, so combining them with a
  // post-filter load-more (which IS filtered) would skip filtered rows
  // at server positions 0-11 and surface duplicate already-loaded rows.
  // Resetting the row list on filter change keeps the ordinal stream
  // aligned with the server query.
  //
  // The skipFirstRunRef guards against running on the initial mount —
  // the parent already fetched the unfiltered first page server-side
  // and re-fetching client-side on mount would double-fetch + flash.
  //
  // Sequence guard — when the user clicks Load More then immediately
  // toggles a filter, the later refetch wins even if the earlier append
  // resolves second. Without this the older append could corrupt the
  // row list ordering.
  const skipFirstRunRef = useRef(true);
  const sequenceRef = useRef(0);
  useEffect(() => {
    if (skipFirstRunRef.current) {
      skipFirstRunRef.current = false;
      return;
    }
    const seq = ++sequenceRef.current;
    let cancelled = false;
    setLoadingMore(true);
    (async () => {
      const res = await loadMoreLettersAction(0, PAGE_SIZE, {
        year: yearFilter,
        theme: themeFilter,
        clientId: clientIdFilter,
      });
      if (cancelled || seq !== sequenceRef.current) return;
      if (!res.ok) {
        toast.error(res.error || "Couldn't apply filter.");
        setLoadingMore(false);
        return;
      }
      setRows(res.data.letters);
      setMore(res.data.hasMore);
      setLoadingMore(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [yearFilter, themeFilter, clientIdFilter]);

  const handleLoadMore = async () => {
    const seq = ++sequenceRef.current;
    setLoadingMore(true);
    try {
      const res = await loadMoreLettersAction(rows.length, PAGE_SIZE, filters);
      if (seq !== sequenceRef.current) {
        // A filter toggle bumped the sequence number — the newer refetch
        // already owns the row list; drop this append.
        return;
      }
      if (!res.ok) {
        toast.error(res.error || "Couldn't load more letters.");
        return;
      }
      // Dedupe by id on append — toggling a filter and back can shuffle
      // server ordinals; the explicit dedup keeps the row list a set
      // even if the server returns an already-loaded row.
      setRows((prev) => {
        const seen = new Set(prev.map((r) => r.id));
        const next = [...prev];
        for (const row of res.data.letters) {
          if (!seen.has(row.id)) {
            next.push(row);
            seen.add(row.id);
          }
        }
        return next;
      });
      setMore(res.data.hasMore);
    } finally {
      if (seq === sequenceRef.current) setLoadingMore(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-[1080px] flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="font-display text-lg leading-tight">Letters</h1>
          <p className="text-xs text-muted-foreground">
            Quiet writing back to you. Letters land here for keeps.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setGenerateModal(true)}
            className="h-8 gap-1.5"
          >
            Generate
          </Button>
        </div>
      </header>

      {/* Filter chips — year + theme */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Year
        </span>
        <button
          type="button"
          onClick={() => setYearFilter(null)}
          className={cn(
            "rounded-full border px-2.5 py-1 text-[11px] font-medium",
            yearFilter === null
              ? "border-foreground bg-foreground text-background"
              : "border-border/70 text-foreground/80 hover:bg-muted",
          )}
        >
          all
        </button>
        {years.map((y) => (
          <button
            key={y}
            type="button"
            onClick={() => setYearFilter(y)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium",
              yearFilter === y
                ? "border-foreground bg-foreground text-background"
                : "border-border/70 text-foreground/80 hover:bg-muted",
            )}
          >
            {y}
          </button>
        ))}
        <span className="ml-3 text-[10px] uppercase tracking-wider text-muted-foreground">
          Theme
        </span>
        <button
          type="button"
          onClick={() => setThemeFilter(null)}
          className={cn(
            "rounded-full border px-2.5 py-1 text-[11px] font-medium",
            themeFilter === null
              ? "border-foreground bg-foreground text-background"
              : "border-border/70 text-foreground/80 hover:bg-muted",
          )}
        >
          all
        </button>
        {REFRESHABLE.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setThemeFilter(k)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium",
              themeFilter === k
                ? "border-foreground bg-foreground text-background"
                : "border-border/70 text-foreground/80 hover:bg-muted",
            )}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/60 px-4 py-12 text-center text-xs text-muted-foreground">
          {rows.length === 0
            ? "No letters yet. They land automatically when something is worth holding up."
            : "No letters match the filter. Try another year or theme."}
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {visible.map((l) => (
            <li key={l.id}>
              <LetterCard letter={l} />
            </li>
          ))}
        </ul>
      )}

      {more && (
        <div className="flex justify-center pt-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleLoadMore}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}

      <GenerateLetterModal
        open={generateModal}
        onOpenChange={setGenerateModal}
      />
    </div>
  );
}

// Strip the small set of markdown markers the editorial brain might emit
// before deriving the excerpt. We're not parsing markdown — the modal
// renders plain editorial paragraphs — but raw **bold** / _italic_ / >
// quote chars look rough sitting under a Fraunces headline. Keep this
// list small; over-stripping changes editorial meaning.
function plainTextExcerpt(body: string, max = 180): string {
  const stripped = body
    .replace(/```[\s\S]*?```/g, " ") // fenced code blocks
    .replace(/\*\*(.+?)\*\*/g, "$1") // bold
    .replace(/\*(.+?)\*/g, "$1") // italic-bold variant
    .replace(/_(.+?)_/g, "$1") // underscore italic
    .replace(/^#{1,6}\s+/gm, "") // headings
    .replace(/^>\s?/gm, "") // blockquotes
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length > max ? stripped.slice(0, max) : stripped;
}

function LetterCard({ letter }: { letter: EditorialLetter }) {
  const { openModal } = useNotificationModal();
  const themeLabel = KIND_LABEL[letter.kind] ?? letter.kind;
  const excerpt = plainTextExcerpt(letter.body, 180);
  // Render as an <a href> so Cmd/Ctrl-click opens the /letters/[id]
  // deep-link in a new tab natively. The default click is intercepted
  // and routed to the in-page modal so the archive's overlay UX stays.
  //
  // Visual tokens mirror the MWidget primitive (rounded-xl, ring-1,
  // hover lift + shadow); we hand-roll the <a> because MWidget is a
  // div-based clickable and we need native Cmd-click semantics. If
  // MWidget grows an `href` prop later this card collapses into a one
  // liner.
  return (
    <a
      href={`/letters/${letter.id}`}
      onClick={(e) => {
        // Allow modifier-clicks (Cmd, Ctrl, Shift, Alt, middle-click) to
        // fall through to the browser — opens the deep link in a new
        // tab / window. Same convention as GitHub commit links.
        if (
          e.metaKey ||
          e.ctrlKey ||
          e.shiftKey ||
          e.altKey ||
          e.button === 1
        )
          return;
        e.preventDefault();
        openModal(<LetterReader letterId={letter.id} />, {
          title: letter.headline,
          size: "reader",
          chromeless: true,
        });
      }}
      className="group relative flex min-h-[160px] w-full flex-col rounded-xl bg-card p-4 text-left ring-1 ring-foreground/10 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_8px_20px_-8px_oklch(0_0_0/0.12)]"
    >
      <div className="flex items-start gap-2">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-foreground/[0.04] text-foreground/70">
          <Mail className="h-4 w-4" />
        </div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {themeLabel} · {phtDateString(new Date(letter.generated_at))}
        </div>
        {letter.pinned && (
          <span className="ml-auto rounded-full border border-acid-lime/50 px-2 py-0.5 text-[9px] uppercase tracking-wider text-acid-lime">
            pinned
          </span>
        )}
      </div>
      <div className="mt-3 font-display text-[16px] leading-tight text-foreground">
        {letter.headline}
      </div>
      <p className="mt-2 line-clamp-3 text-[12px] leading-snug text-muted-foreground">
        {excerpt}
        {letter.body.length > excerpt.length ? "…" : ""}
      </p>
    </a>
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
  const { openModal } = useNotificationModal();
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
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Kind
          </Label>
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
            The letter regenerates if one already exists for the current period
            — pinned letters and existing replies are preserved.
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
                  openModal(<LetterReader letterId={res.id} />, {
                    title: "New letter",
                    size: "reader",
                    chromeless: true,
                  });
                  // Refresh the server data so the new letter appears in
                  // the archive list + year-chip set on the next paint.
                  // Without this the just-generated letter is invisible
                  // in the archive until a hard navigation.
                  router.refresh();
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
