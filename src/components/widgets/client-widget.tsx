"use client";

import { MWidget } from "./m-widget";
import { resolveClientAccent } from "@/lib/brand/client-accent";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  OVERDUE_BG_CLASS,
  OVERDUE_RING_CLASS,
  OVERDUE_TEXT_CLASS,
  QUIET_PILL_BG_CLASS,
  QUIET_PILL_RING_CLASS,
  QUIET_PILL_TEXT_CLASS,
  TERRACOTTA_BG_CLASS,
  TERRACOTTA_RING_CLASS,
  TERRACOTTA_TEXT_CLASS,
} from "@/lib/design/tokens";
import type { CurrencyCode } from "@/lib/supabase/types";

// Freelane M widget — Client card variant.
//
// Restyle, NOT a content cut: the design memo (clients-design) says Hatim
// is happy with the amount of info on the existing card. We preserve:
//   - avatar initials with the warm-band accent
//   - hero name (Fraunces display via MWidget's display-headline class)
//   - landed total + outstanding (stat row)
//   - active project count
//   - last-paid time-ago (right column)
//   - up-to-2 warning pills (pattern_changed terracotta, quiet_14d slate,
//     overdue_X rose) at the bottom
//
// Whole-card click → router.push(`/clients/${id}`). AI dot top-right via
// the MWidget aiDot prop (chatbot scoped to this client via the
// setActiveCardContext bridge inside ai-dot.tsx).

export type ClientWidgetWarning = {
  kind: "pattern_changed" | "quiet_14d" | "overdue";
  label: string;
};

export type ClientWidgetData = {
  id: string;
  name: string;
  company: string | null;
  // Has-notes indicator only (boolean) — raw note content is private and
  // doesn't surface on the card to keep a shared screen / screenshot /
  // demo from leaking the first 80 chars of free-form notes. The card
  // surfaces the top AI fact instead (see ClientWidgetProps.facts).
  hasNotes: boolean;
  archived: boolean;
  paidBase: number;
  outstandingBase: number;
  projectCount: number;
  openProjectCount: number;
  lastPaidAt: string | null;
  defaultCurrency: CurrencyCode | null;
};

const TONE_PRIORITY: Record<ClientWidgetWarning["kind"], number> = {
  overdue: 0,
  pattern_changed: 1,
  quiet_14d: 2,
};

function pickTone(
  warnings: ClientWidgetWarning[],
): "default" | "lime" | "terracotta" | "rose" | "muted" {
  if (warnings.length === 0) return "default";
  // The most urgent warning paints the ring; lowest priority number wins.
  const sorted = [...warnings].sort(
    (a, b) => TONE_PRIORITY[a.kind] - TONE_PRIORITY[b.kind],
  );
  switch (sorted[0].kind) {
    case "overdue":
      return "rose";
    case "pattern_changed":
      return "terracotta";
    case "quiet_14d":
      // Quiet-channel is one of the three signals the widget exists to
      // surface; the "muted" tone (ring-foreground/5) renders fainter than
      // the default ring (foreground/10) and would invert the priority on
      // screen. Skip the ring tone entirely and let the pill carry the
      // signal — that keeps a quiet client from visually receding below a
      // fine one.
      return "default";
  }
}

// Bare-bones relative time. Days for anything > 24h, hours for < 24h.
// Used inside the supporting strip — sub-day precision isn't useful for a
// client card.
function timeAgo(iso: string | null | undefined): string | null {
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

type ClientWidgetProps = {
  client: ClientWidgetData;
  baseCurrency: CurrencyCode;
  warnings: ClientWidgetWarning[];
  facts: Array<{ key: string; value: string; confidence: number }>;
  onOpen: () => void;
};

export function ClientWidget({
  client,
  baseCurrency,
  warnings,
  facts,
  onOpen,
}: ClientWidgetProps) {
  const accent = resolveClientAccent(client.id);
  const initials = clientInitials(client.name);
  const lastPaid = timeAgo(client.lastPaidAt);
  const tone = pickTone(warnings);

  // Eyebrow: company OR currency, both optional. Keeps the top-left line
  // honest about which scope the avatar belongs to.
  const eyebrow = client.company ?? client.defaultCurrency ?? "Client";

  // Up to two pills — relevance-gated per the widget memo. Empty array
  // collapses the warning slot entirely so a clean client card has zero
  // bottom chrome.
  const pills = warnings.slice(0, 2);

  // Supporting line: top-confidence AI fact (privacy-preserving teaser of
  // what the model has learned) instead of raw notes verbatim. Falls back
  // to a neutral "Notes attached" marker when there are no facts yet but
  // the client has notes, otherwise to "No notes yet".
  const topFact = facts.length > 0 ? facts[0] : null;
  const supportingTeaser = topFact
    ? `${humanizeKey(topFact.key)} · ${truncateValue(topFact.value)}`
    : client.hasNotes
    ? "Notes attached"
    : "No notes yet";

  return (
    <MWidget
      label={client.name}
      tone={tone}
      onOpen={onOpen}
      eyebrow={eyebrow}
      icon={
        <span
          className="grid h-7 w-7 place-items-center rounded-md text-[12px] font-semibold text-white"
          style={{ background: accent.base }}
        >
          {initials || "?"}
        </span>
      }
      // MWidget's hero wrapper applies display-headline text-[36px]
      // leading-none. We deliberately shrink the name to text-[28px] so a
      // long client name fits without truncating to a single glyph; the
      // wrapper's leading-none stays correct for both sizes.
      hero={<span className="block truncate text-[28px]">{client.name}</span>}
      sub={
        <div className="flex items-center justify-between gap-3 text-[12.5px]">
          <span className="tabular text-foreground/85">
            {client.paidBase > 0
              ? formatMoney(client.paidBase, baseCurrency, { compact: true })
              : "—"}
            <span className="ml-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              landed
            </span>
          </span>
          <span className="tabular text-muted-foreground">
            {client.openProjectCount > 0
              ? `${client.openProjectCount} open · ${client.projectCount} total`
              : `${client.projectCount} project${client.projectCount === 1 ? "" : "s"}`}
          </span>
        </div>
      }
      supporting={
        <div className="flex items-center justify-between gap-3">
          <span className="truncate">{supportingTeaser}</span>
          {lastPaid && <span className="shrink-0 tabular">{lastPaid}</span>}
        </div>
      }
      trailing={
        client.outstandingBase > 0 ? (
          <div className="flex flex-col items-end">
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Outstanding
            </div>
            <div className="text-[15px] font-semibold tabular text-[var(--overdue)]">
              {formatMoney(client.outstandingBase, baseCurrency, { compact: true })}
            </div>
          </div>
        ) : undefined
      }
      warning={
        pills.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {pills.map((p, idx) => (
              <WarningPill key={`${p.kind}-${idx}`} warning={p} />
            ))}
          </div>
        ) : undefined
      }
      className={cn(client.archived && "opacity-60")}
      aiDot={{
        key: `client:${client.id}`,
        label: client.name,
        data: { client, facts },
      }}
    />
  );
}

function WarningPill({ warning }: { warning: ClientWidgetWarning }) {
  // Pill palette pulls from lib/design/tokens so a future colour shift
  // updates here and on every other surface (pattern-change-history dot,
  // any other warning-flavoured chip) in one place.
  const palette: Record<
    ClientWidgetWarning["kind"],
    { bg: string; text: string; ring: string }
  > = {
    pattern_changed: {
      bg: TERRACOTTA_BG_CLASS,
      text: TERRACOTTA_TEXT_CLASS,
      ring: TERRACOTTA_RING_CLASS,
    },
    quiet_14d: {
      bg: QUIET_PILL_BG_CLASS,
      text: QUIET_PILL_TEXT_CLASS,
      ring: QUIET_PILL_RING_CLASS,
    },
    overdue: {
      bg: OVERDUE_BG_CLASS,
      text: OVERDUE_TEXT_CLASS,
      ring: OVERDUE_RING_CLASS,
    },
  };
  const p = palette[warning.kind];
  return (
    <span
      className={cn(
        "max-w-full truncate rounded-full px-2 py-0.5 text-[10.5px] font-medium ring-1",
        p.bg,
        p.text,
        p.ring,
      )}
    >
      {warning.label}
    </span>
  );
}

function clientInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
}

function truncateValue(s: string): string {
  const cleaned = s.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 50) return cleaned;
  return cleaned.slice(0, 48) + "…";
}

function humanizeKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
