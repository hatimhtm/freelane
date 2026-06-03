// Per-source mappers that translate a raw DB row from one of the 13 source
// tables the virtual feed unions into an ActivityRow. Kept in a sibling
// file from feed.ts so the categorization + summarization logic can be
// tested + tweaked without touching the union query layer.

import { formatMoney } from "@/lib/money";
import { categoryForSource, type ActivityCategory } from "./categories";
import type { CurrencyCode } from "@/lib/supabase/types";

export type ActivityActor = "user" | "ai" | "system";

export type ActivityRow = {
  // Stable identity. Composite of source_table + source_id keeps the row
  // unique even when two tables collide on id space.
  id: string;
  // Raw kind string from the source row (e.g. sadaka_ledger.kind,
  // chat_messages.role). Loose by design — the view doesn't switch on it,
  // just surfaces it as a debug tooltip.
  kind: string | null;
  category: ActivityCategory;
  actor: ActivityActor;
  // ISO timestamp. Used for sort + day grouping. Stored as-is from the
  // source row; the view applies the PHT helper at render time.
  timestamp: string;
  source_table: string;
  source_id: string | null;
  // One-line plain-language summary rendered in the M-widget body.
  summary: string;
  // Free-form payload for downstream consumers (sourceDetailHref,
  // tooltips, future row-type-specific affordances). Optional.
  payload: Record<string, unknown> | null;
};

// PHP is the base currency for all *_base fields; mappers feed straight
// into formatMoney for consistent "₱123" output.
const BASE: CurrencyCode = "PHP";

function php(n: number | string | null | undefined): string {
  const num = Number(n ?? 0);
  return formatMoney(num, BASE, { compact: true });
}

// ── spends ────────────────────────────────────────────────────────────

export type SpendSourceRow = {
  id: string;
  spent_at: string;
  amount_base: number;
  description: string | null;
  // Resolved via spend_vendor_links → vendors.canonical_name at the
  // query layer (feed.ts). Optional: the vendor link may be missing
  // for raw spends not yet linked, in which case the row falls back to
  // the user-typed description.
  vendor_name?: string | null;
};

export function mapSpend(row: SpendSourceRow): ActivityRow {
  const where = row.vendor_name || row.description || "a spend";
  return {
    id: `spends:${row.id}`,
    kind: "spend",
    category: categoryForSource("spends"),
    actor: "user",
    timestamp: row.spent_at,
    source_table: "spends",
    source_id: row.id,
    summary: `Spent ${php(row.amount_base)} at ${where}`,
    payload: null,
  };
}

// ── withdrawals ───────────────────────────────────────────────────────

export type WithdrawalSourceRow = {
  id: string;
  withdrawn_at: string;
  gross_base: number;
  net_base: number;
  from_method_id: string | null;
  to_method_id: string | null;
  // Resolved from the payment_methods join at the query layer (feed.ts)
  // so the row can read "GCash → Coin.ph" instead of an anonymous
  // "between wallets". Optional — older withdrawals or future ones
  // missing the link fall back to the generic phrasing.
  from_method_name?: string | null;
  to_method_name?: string | null;
  notes: string | null;
};

export function mapWithdrawal(row: WithdrawalSourceRow): ActivityRow {
  const from = row.from_method_name || "";
  const to = row.to_method_name || "";
  const summary =
    from && to
      ? `Transferred ${php(row.net_base)} from ${from} to ${to}`
      : from
        ? `Transferred ${php(row.net_base)} from ${from}`
        : to
          ? `Transferred ${php(row.net_base)} to ${to}`
          : `Transferred ${php(row.net_base)} between wallets`;
  return {
    id: `withdrawals:${row.id}`,
    kind: "withdrawal",
    category: categoryForSource("withdrawals"),
    actor: "user",
    timestamp: row.withdrawn_at,
    source_table: "withdrawals",
    source_id: row.id,
    summary,
    // Carry from/to ids so the feed-level wallet-name resolver can
    // splice in real names after the per-source pass. Names are not
    // stored here because the per-source mapper doesn't have access
    // to the user's payment_methods lookup.
    payload: {
      notes: row.notes,
      from_method_id: row.from_method_id,
      to_method_id: row.to_method_id,
    },
  };
}

// ── sadaka_ledger ─────────────────────────────────────────────────────

export type SadakaSourceRow = {
  id: string;
  event_at: string;
  kind: string;
  amount_base: number;
  reasoning: string | null;
  note: string | null;
};

export function mapSadaka(row: SadakaSourceRow): ActivityRow {
  const verb =
    row.kind === "contribution"
      ? "Sadaka contribution"
      : row.kind === "payment"
        ? "Sadaka payment"
        : row.kind === "auto_detected"
          ? "Sadaka auto-detected"
          : row.kind === "decay"
            ? "Sadaka decay"
            : "Sadaka adjustment";
  const amount = php(Math.abs(Number(row.amount_base ?? 0)));
  const actor: ActivityActor =
    row.kind === "auto_detected" || row.kind === "decay" ? "ai" : "user";
  return {
    id: `sadaka_ledger:${row.id}`,
    kind: row.kind,
    category: categoryForSource("sadaka_ledger", row.kind),
    actor,
    timestamp: row.event_at,
    source_table: "sadaka_ledger",
    source_id: row.id,
    summary: `${verb} ${amount}`,
    payload: { reasoning: row.reasoning, note: row.note },
  };
}

// ── planned_spends ────────────────────────────────────────────────────

export type PlannedSpendSourceRow = {
  id: string;
  label: string;
  expected_base: number;
  status: string;
  created_at: string;
  updated_at: string;
  bought_at: string | null;
  done_at: string | null;
};

export function mapPlannedSpend(row: PlannedSpendSourceRow): ActivityRow {
  // Single-row collapsed view of the planned spend. Kept around for any
  // caller that wants only the latest signal — the feed itself now uses
  // mapPlannedSpendLifecycle so the full create → bought → done arc
  // surfaces row-by-row. Anchor on created_at to match the feed's
  // cursor column for the same source.
  const verb =
    row.status === "bought" || row.status === "done"
      ? "Bought plan"
      : row.status === "cancelled" || row.status === "abandoned"
        ? "Plan cancelled"
        : row.updated_at && row.updated_at !== row.created_at
          ? "Plan updated"
          : "Plan created";
  return {
    id: `planned_spends:${row.id}`,
    kind: row.status,
    category: categoryForSource("planned_spends"),
    actor: "user",
    timestamp: row.created_at,
    source_table: "planned_spends",
    source_id: row.id,
    summary: `${verb}: ${row.label} (${php(row.expected_base)})`,
    payload: null,
  };
}

// One feed row per lifecycle transition: created → (bought) → (done). A
// plan that goes created→bought→done in 3 events surfaces as 3 rows so
// history isn't lost. The row id suffix distinguishes lifecycle stages
// so the composite (id) cursor stays unique. Stages emit at their own
// timestamp (created_at / bought_at / done_at) and the feed's per-source
// cursor anchors on created_at — so a fresh page never accidentally
// drops a created row whose bought_at moved later.
export function mapPlannedSpendLifecycle(
  row: PlannedSpendSourceRow,
): ActivityRow[] {
  const rows: ActivityRow[] = [];
  rows.push({
    id: `planned_spends:${row.id}:created`,
    kind: "created",
    category: categoryForSource("planned_spends"),
    actor: "user",
    timestamp: row.created_at,
    source_table: "planned_spends",
    source_id: row.id,
    summary: `Plan created: ${row.label} (${php(row.expected_base)})`,
    payload: null,
  });
  if (row.bought_at) {
    rows.push({
      id: `planned_spends:${row.id}:bought`,
      kind: "bought",
      category: categoryForSource("planned_spends"),
      actor: "user",
      timestamp: row.bought_at,
      source_table: "planned_spends",
      source_id: row.id,
      summary: `Bought plan: ${row.label} (${php(row.expected_base)})`,
      payload: null,
    });
  }
  if (row.done_at && row.done_at !== row.bought_at) {
    rows.push({
      id: `planned_spends:${row.id}:done`,
      kind: "done",
      category: categoryForSource("planned_spends"),
      actor: "user",
      timestamp: row.done_at,
      source_table: "planned_spends",
      source_id: row.id,
      summary: `Plan completed: ${row.label}`,
      payload: null,
    });
  }
  return rows;
}

// ── notifications_inbox ───────────────────────────────────────────────

export type NotificationSourceRow = {
  id: string;
  kind: string;
  subject: string;
  body: string | null;
  link_url: string | null;
  created_at: string;
};

export function mapNotification(row: NotificationSourceRow): ActivityRow {
  return {
    id: `notifications_inbox:${row.id}`,
    kind: row.kind,
    category: categoryForSource("notifications_inbox"),
    actor: "system",
    timestamp: row.created_at,
    source_table: "notifications_inbox",
    source_id: row.id,
    summary: `Notification: ${row.subject}`,
    payload: { link_url: row.link_url, body: row.body },
  };
}

// ── chat_messages ─────────────────────────────────────────────────────

export type ChatMessageSourceRow = {
  id: string;
  session_id: string;
  page_key: string;
  role: string;
  content: string;
  created_at: string;
};

export function mapChatMessage(row: ChatMessageSourceRow): ActivityRow {
  const snippet =
    row.content.length > 80 ? `${row.content.slice(0, 77)}...` : row.content;
  const actor: ActivityActor = row.role === "assistant" ? "ai" : "user";
  return {
    id: `chat_messages:${row.id}`,
    kind: row.role,
    category: categoryForSource("chat_messages"),
    actor,
    timestamp: row.created_at,
    source_table: "chat_messages",
    source_id: row.id,
    summary: `Chat on ${row.page_key}: ${snippet}`,
    payload: { page_key: row.page_key, session_id: row.session_id },
  };
}

// ── letters ───────────────────────────────────────────────────────────

export type LetterSourceRow = {
  id: string;
  kind: string;
  headline: string;
  generated_at: string;
};

export function mapLetter(row: LetterSourceRow): ActivityRow {
  return {
    id: `letters:${row.id}`,
    kind: row.kind,
    category: categoryForSource("letters"),
    actor: "ai",
    timestamp: row.generated_at,
    source_table: "letters",
    source_id: row.id,
    summary: `Letter: ${row.headline}`,
    payload: null,
  };
}

// ── loans / loan_returns / loan_forgivals ─────────────────────────────

export type LoanSourceRow = {
  id: string;
  direction: string;
  principal_base: number;
  borrowed_at: string;
  counterparty: string | null;
};

export function mapLoan(row: LoanSourceRow): ActivityRow {
  const dir =
    row.direction === "lent" || row.direction === "given"
      ? "Lent"
      : "Borrowed";
  const who = row.counterparty ? ` ${dir === "Lent" ? "to" : "from"} ${row.counterparty}` : "";
  return {
    id: `loans:${row.id}`,
    kind: row.direction,
    category: categoryForSource("loans"),
    actor: "user",
    timestamp: row.borrowed_at,
    source_table: "loans",
    source_id: row.id,
    summary: `${dir} ${php(row.principal_base)}${who}`,
    payload: null,
  };
}

export type LoanReturnSourceRow = {
  id: string;
  loan_id: string;
  amount_base: number;
  returned_at: string;
};

export function mapLoanReturn(row: LoanReturnSourceRow): ActivityRow {
  return {
    id: `loan_returns:${row.id}`,
    kind: "return",
    category: categoryForSource("loan_returns"),
    actor: "user",
    timestamp: row.returned_at,
    source_table: "loan_returns",
    source_id: row.loan_id,
    summary: `Returned ${php(row.amount_base)} on a loan`,
    payload: { loan_id: row.loan_id },
  };
}

export type LoanForgivalSourceRow = {
  id: string;
  loan_id: string;
  forgiven_at: string;
  reason: string | null;
};

export function mapLoanForgival(row: LoanForgivalSourceRow): ActivityRow {
  return {
    id: `loan_forgivals:${row.id}`,
    kind: "forgive",
    category: categoryForSource("loan_forgivals"),
    actor: "user",
    timestamp: row.forgiven_at,
    source_table: "loan_forgivals",
    source_id: row.loan_id,
    summary: `Forgave a loan${row.reason ? ` — ${row.reason}` : ""}`,
    payload: { loan_id: row.loan_id },
  };
}

// ── ai_user_facts ─────────────────────────────────────────────────────

export type AiFactSourceRow = {
  id: string;
  key: string;
  subject_kind: string | null;
  created_at: string;
  updated_at: string;
};

export function mapAiFact(row: AiFactSourceRow): ActivityRow {
  // Treat updated_at as the activity timestamp so AI re-learning shows up
  // as a fresh row instead of getting buried under the original creation
  // moment. The feed query anchors on updated_at too — keep these in
  // sync or cursor pagination silently drops re-learned rows.
  //
  // `kind` is the row-level event noun (matches the other ai-actor
  // sources: 'canonicalize' on vendors, 'session' on collapsed chats).
  // `subject_kind` is the entity kind of the fact's SUBJECT (vendor /
  // entity / etc.) — it lives in the payload only so the debug tooltip
  // doesn't mislabel the row.
  return {
    id: `ai_user_facts:${row.id}`,
    kind: "fact_learned",
    category: categoryForSource("ai_user_facts"),
    actor: "ai",
    timestamp: row.updated_at || row.created_at,
    source_table: "ai_user_facts",
    source_id: row.id,
    summary: `AI learned ${row.key}`,
    payload: { subject_kind: row.subject_kind },
  };
}

// ── vendors (canonicalization) ────────────────────────────────────────

export type VendorSourceRow = {
  id: string;
  canonical_name: string;
  updated_at: string;
  created_at: string;
};

export function mapVendor(row: VendorSourceRow): ActivityRow {
  return {
    id: `vendors:${row.id}`,
    kind: "canonicalize",
    category: categoryForSource("vendors"),
    actor: "ai",
    timestamp: row.updated_at || row.created_at,
    source_table: "vendors",
    source_id: row.id,
    summary: `Vendor canonicalized: ${row.canonical_name}`,
    payload: null,
  };
}

// ── entities ──────────────────────────────────────────────────────────

export type EntitySourceRow = {
  id: string;
  canonical_name: string;
  kind: string;
  created_at: string;
};

export function mapEntity(row: EntitySourceRow): ActivityRow {
  return {
    id: `entities:${row.id}`,
    kind: row.kind,
    category: categoryForSource("entities"),
    actor: "user",
    timestamp: row.created_at,
    source_table: "entities",
    source_id: row.id,
    summary: `Met ${row.canonical_name}`,
    payload: null,
  };
}

// ── morning_log ───────────────────────────────────────────────────────

export type MorningLogSourceRow = {
  id: string;
  recorded_at: string;
  mood_band: number | null;
  slept_hours: number | null;
};

export function mapMorningLog(row: MorningLogSourceRow): ActivityRow {
  const parts: string[] = [];
  if (row.mood_band != null) parts.push(`mood ${row.mood_band}`);
  if (row.slept_hours != null) parts.push(`slept ${row.slept_hours}h`);
  const detail = parts.length ? ` (${parts.join(", ")})` : "";
  return {
    id: `morning_log:${row.id}`,
    kind: "morning",
    category: categoryForSource("morning_log"),
    actor: "user",
    timestamp: row.recorded_at,
    source_table: "morning_log",
    source_id: row.id,
    summary: `Morning log${detail}`,
    payload: null,
  };
}

// ── wellbeing_checkins ────────────────────────────────────────────────

export type WellbeingSourceRow = {
  id: string;
  week_starts: string;
  generated_at: string | null;
  created_at: string;
  response: string | null;
};

export function mapWellbeing(row: WellbeingSourceRow): ActivityRow {
  return {
    id: `wellbeing_checkins:${row.id}`,
    kind: "checkin",
    category: categoryForSource("wellbeing_checkins"),
    actor: "user",
    timestamp: row.generated_at || row.created_at,
    source_table: "wellbeing_checkins",
    source_id: row.id,
    summary: row.response
      ? `Wellbeing check-in answered`
      : `Wellbeing check-in saved`,
    payload: { week_starts: row.week_starts },
  };
}

// ── diary_entries ─────────────────────────────────────────────────────

export type DiarySourceRow = {
  id: string;
  entry_date: string;
  body: string;
  created_at: string;
};

export function mapDiary(row: DiarySourceRow): ActivityRow {
  const snippet =
    row.body.length > 80 ? `${row.body.slice(0, 77)}...` : row.body;
  return {
    id: `diary_entries:${row.id}`,
    kind: "diary",
    category: categoryForSource("diary_entries"),
    actor: "user",
    timestamp: row.created_at,
    source_table: "diary_entries",
    source_id: row.id,
    summary: `Diary: ${snippet}`,
    payload: { entry_date: row.entry_date },
  };
}
