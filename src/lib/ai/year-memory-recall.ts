import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { phtDateString, phtToday } from "@/lib/utils";
import type {
  EditorialLetter,
  LifeShift,
  Milestone,
  Payment,
  Spend,
  UserMemoryEntry,
} from "@/lib/supabase/types";

// Year-Long Memory Recall (#21) — Hatim 2026-06-01: "MAYBE. Hmmm that
// might be nice."
//
// Pure-math; no Gemini. Surfaces ONE bullet of "one year ago today" data
// drawn from user_memory_entries / letters / milestones / life shifts /
// payments / spends. The Today card hides when nothing notable surfaces.

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 2;  // ±2 days around the anchor

export interface YearMemoryRecall {
  oneYearAgoDate: string;
  items: YearRecallItem[];
}

export interface YearRecallItem {
  kind: "memory" | "letter" | "milestone" | "life_shift" | "payment" | "spend";
  date: string;
  label: string;
  detail?: string;
  href?: string;
}

export async function buildYearMemoryRecall(): Promise<YearMemoryRecall | null> {
  const user = await getAuthUser();
  if (!user) return null;
  const supabase = await createClient();
  const today = new Date(phtToday());
  const oneYearAgo = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
  const oneYearAgoStr = phtDateString(oneYearAgo);
  const windowStart = phtDateString(new Date(oneYearAgo.getTime() - WINDOW_DAYS * DAY_MS));
  const windowEnd = phtDateString(new Date(oneYearAgo.getTime() + WINDOW_DAYS * DAY_MS));

  const [{ data: memory }, { data: letters }, { data: milestones }, { data: shifts }, { data: payments }, { data: spends }] = await Promise.all([
    supabase
      .from("user_memory_entries")
      .select("*")
      .eq("user_id", user.id)
      .gte("created_at", `${windowStart}T00:00:00`)
      .lte("created_at", `${windowEnd}T23:59:59`)
      .order("created_at", { ascending: false }),
    supabase
      .from("letters")
      .select("id,headline,period_key,kind")
      .eq("user_id", user.id)
      .gte("generated_at", `${windowStart}T00:00:00`)
      .lte("generated_at", `${windowEnd}T23:59:59`),
    supabase
      .from("milestones")
      .select("*")
      .eq("user_id", user.id)
      .gte("achieved_at", windowStart)
      .lte("achieved_at", windowEnd),
    supabase
      .from("life_shifts")
      .select("*")
      .eq("user_id", user.id)
      .gte("occurred_at", windowStart)
      .lte("occurred_at", windowEnd),
    supabase
      .from("payments")
      .select("id,paid_at,net_amount_base,amount,currency")
      .eq("user_id", user.id)
      .gte("paid_at", windowStart)
      .lte("paid_at", windowEnd)
      .order("net_amount_base", { ascending: false })
      .limit(3),
    supabase
      .from("spends")
      .select("id,spent_at,amount_base,description")
      .eq("user_id", user.id)
      .gte("spent_at", windowStart)
      .lte("spent_at", windowEnd)
      .order("amount_base", { ascending: false })
      .limit(3),
  ]);

  const items: YearRecallItem[] = [];
  for (const m of ((memory ?? []) as UserMemoryEntry[]).slice(0, 2)) {
    items.push({
      kind: "memory",
      date: m.created_at.slice(0, 10),
      label: m.content.length > 140 ? `${m.content.slice(0, 138)}…` : m.content,
    });
  }
  for (const l of ((letters ?? []) as Array<Pick<EditorialLetter, "id" | "headline" | "period_key" | "kind">>)) {
    items.push({
      kind: "letter",
      date: oneYearAgoStr,
      label: l.headline,
      detail: `${l.kind} · ${l.period_key}`,
      href: `/letters/${l.id}`,
    });
  }
  for (const ms of ((milestones ?? []) as Milestone[])) {
    items.push({
      kind: "milestone",
      date: ms.achieved_at,
      label: ms.label,
      detail: ms.narrative,
    });
  }
  for (const ls of ((shifts ?? []) as LifeShift[])) {
    items.push({
      kind: "life_shift",
      date: ls.occurred_at,
      label: ls.label,
      detail: ls.narrative,
    });
  }
  for (const p of ((payments ?? []) as Array<Pick<Payment, "id" | "paid_at" | "net_amount_base" | "amount" | "currency">>)) {
    items.push({
      kind: "payment",
      date: p.paid_at,
      label: `Landing · ${p.currency} ${Number(p.amount).toFixed(0)} (≈ ₱${Math.round(Number(p.net_amount_base ?? 0))})`,
    });
  }
  for (const s of ((spends ?? []) as Array<Pick<Spend, "id" | "spent_at" | "amount_base" | "description">>)) {
    if (Number(s.amount_base ?? 0) < 1000) continue;
    items.push({
      kind: "spend",
      date: s.spent_at,
      label: `Spent ₱${Math.round(Number(s.amount_base ?? 0))} · ${s.description ?? "no description"}`,
    });
  }

  if (items.length === 0) return null;

  // Sort by importance: letters + milestones + life_shifts first, then memory, then payments, then spends.
  const kindWeight: Record<YearRecallItem["kind"], number> = {
    letter: 0,
    milestone: 1,
    life_shift: 2,
    memory: 3,
    payment: 4,
    spend: 5,
  };
  items.sort((a, b) => kindWeight[a.kind] - kindWeight[b.kind]);

  return {
    oneYearAgoDate: oneYearAgoStr,
    items: items.slice(0, 5),
  };
}
