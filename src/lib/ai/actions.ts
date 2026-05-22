"use server";

import { Type } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { gemini, MODEL, hasGemini } from "./gemini";
import { methodLeaderboard } from "@/lib/payment-chain";
import { cashflowMetrics, outstanding } from "@/lib/dashboard-calc";
import { formatMoney } from "@/lib/money";
import type {
  Client,
  CurrencyCode,
  ExchangeRate,
  Payment,
  PaymentMethod,
  PaymentStep,
  Project,
  Settings,
} from "@/lib/supabase/types";

export type MoneyInsight = { title: string; detail: string; kind: "routing" | "anomaly" | "forecast" | "chase" | "note" };

const INSIGHT_SYSTEM = `You are a sharp, plain-spoken financial co-pilot for a SOLO freelancer who invoices clients abroad in various currencies and settles into one base currency (shown in the snapshot — use that currency's symbol/code, never assume).

You get a snapshot: landed income this/last month, outstanding balances, fees per payment chain (including any fixed monthly fees), top clients, and per-client watch flags. Surface 1–3 CONCRETE insights worth acting on today.

HARD RULES:
1. 1 to 3 insights. Quality over quantity. If nothing's notable, return 1 calm "note".
2. Reference REAL numbers from the snapshot (amounts in the base currency, %, client/method names). Never invent figures.
3. title ≤ 8 words. detail ≤ 24 words, imperative or diagnostic, no filler ("I recommend", "you should consider").
4. Prefer: routing tips (cheaper payment chain — account for monthly fees, not just %), fee anomalies, who to chase (use watch flags + aging), or a one-line cashflow read.
5. No tax advice. No flattery.`;

const INSIGHT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    insights: {
      type: Type.ARRAY,
      minItems: 1,
      maxItems: 3,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          detail: { type: Type.STRING },
          kind: { type: Type.STRING, enum: ["routing", "anomaly", "forecast", "chase", "note"] },
        },
        required: ["title", "detail", "kind"],
        propertyOrdering: ["title", "detail", "kind"],
      },
    },
  },
  required: ["insights"],
  propertyOrdering: ["insights"],
};

export async function generateMoneyInsights(): Promise<{ ok: boolean; insights: MoneyInsight[]; error?: string }> {
  if (!hasGemini()) return { ok: false, insights: [], error: "Gemini isn't configured." };
  const user = await getAuthUser();
  if (!user) return { ok: false, insights: [], error: "Unauthenticated" };
  const supabase = await createClient();

  const [settingsR, paymentsR, projectsR, clientsR, ratesR, methodsR] = await Promise.all([
    supabase.from("settings").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("payments").select("*").eq("user_id", user.id).order("paid_at", { ascending: false }),
    supabase.from("projects").select("*").eq("user_id", user.id),
    supabase.from("clients").select("*").eq("user_id", user.id),
    supabase.from("exchange_rates").select("*").eq("user_id", user.id),
    supabase.from("payment_methods").select("*").eq("user_id", user.id),
  ]);

  const settings = settingsR.data as Settings | null;
  const currency = (settings?.base_currency ?? "PHP") as CurrencyCode;
  const payments = (paymentsR.data ?? []) as Payment[];
  const projects = (projectsR.data ?? []) as Project[];
  const clients = (clientsR.data ?? []) as Client[];
  const rates = (ratesR.data ?? []) as ExchangeRate[];
  const methods = (methodsR.data ?? []) as PaymentMethod[];

  // steps for the leaderboard
  const stepsRes = await supabase.from("payment_steps").select("*").in("payment_id", payments.map((p) => p.id).length ? payments.map((p) => p.id) : ["00000000-0000-0000-0000-000000000000"]);
  const stepsByPayment = new Map<string, PaymentStep[]>();
  ((stepsRes.data ?? []) as PaymentStep[]).forEach((s) => {
    const arr = stepsByPayment.get(s.payment_id) ?? [];
    arr.push(s);
    stepsByPayment.set(s.payment_id, arr);
  });

  const metrics = cashflowMetrics(payments);
  const rows = outstanding(projects, payments, clients, rates);
  const methodsById = new Map(methods.map((m) => [m.id, m]));
  const leaderboard = methodLeaderboard(payments, stepsByPayment, methodsById);

  const snapshot = `Currency: ${currency}
Landed this month: ${formatMoney(metrics.mtd, currency)}
Landed last month: ${formatMoney(metrics.lastMonth, currency)}
This week: ${formatMoney(metrics.wtd, currency)} (last week ${formatMoney(metrics.lastWeek, currency)})
Fees this month: ${formatMoney(metrics.feesMtd, currency)}

Outstanding (top 5 by urgency):
${rows.slice(0, 5).map((r) => `- ${r.client?.name ?? "?"} · ${r.project.title}: ${formatMoney(r.outstandingNative, r.project.currency as CurrencyCode)} (${r.daysAged}d${r.project.flagged_overdue ? ", FLAGGED" : ""})`).join("\n") || "- none"}

Payment chains by effective fee (cheapest first):
${leaderboard.slice(0, 6).map((l) => `- ${l.signature}: ${(l.effectivePct * 100).toFixed(1)}% over ${l.count} payments (${formatMoney(l.volumeBase, currency, { compact: true })})${l.monthlyFeesBase > 0 ? ` + ${formatMoney(l.monthlyFeesBase, currency, { compact: true })}/mo fixed fee` : ""}`).join("\n") || "- none tagged yet"}

Per-client watch flags (from memory):
${clients.flatMap((c) => (c.memory_consolidated?.watch ?? []).map((w) => `- ${c.name}: ${w}`)).slice(0, 8).join("\n") || "- none"}`;

  try {
    const res = await gemini().models.generateContent({
      model: MODEL,
      contents: `Snapshot:\n\n${snapshot}\n\nReturn 1–3 insights as JSON.`,
      config: {
        systemInstruction: INSIGHT_SYSTEM,
        temperature: 0.4,
        responseMimeType: "application/json",
        responseSchema: INSIGHT_SCHEMA,
      },
    });
    const parsed = JSON.parse((res.text ?? "{}").trim());
    return { ok: true, insights: (parsed.insights ?? []).slice(0, 3) as MoneyInsight[] };
  } catch (err) {
    return { ok: false, insights: [], error: (err as Error).message };
  }
}

const ASK_SYSTEM = `You are the personal money analyst for a SOLO freelancer who invoices abroad in various currencies and settles into one base currency (shown in the snapshot — use that currency, never assume PHP). Answer their question using ONLY the snapshot provided.

RULES:
- Be concise: 1–4 sentences. Lead with the answer.
- Cite real numbers (amounts in the base currency, %, dates, client/method names) straight from the snapshot.
- If the snapshot can't answer it, say so plainly and suggest what to log.
- Plain, warm, sharp. No tax advice, no disclaimers, no "as an AI".`;

// "Ask your money" — natural-language Q&A grounded in a full snapshot of the
// ledger. The creative front door to everything the data knows.
export async function askYourMoney(question: string): Promise<{ ok: boolean; answer?: string; error?: string }> {
  if (!hasGemini()) return { ok: false, error: "Gemini isn't configured." };
  const q = question.trim();
  if (!q) return { ok: false, error: "Ask something first." };
  const user = await getAuthUser();
  if (!user) return { ok: false, error: "Unauthenticated" };
  const supabase = await createClient();

  const [settingsR, paymentsR, projectsR, clientsR, ratesR, methodsR] = await Promise.all([
    supabase.from("settings").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("payments").select("*").eq("user_id", user.id).order("paid_at", { ascending: false }),
    supabase.from("projects").select("*").eq("user_id", user.id),
    supabase.from("clients").select("*").eq("user_id", user.id),
    supabase.from("exchange_rates").select("*").eq("user_id", user.id),
    supabase.from("payment_methods").select("*").eq("user_id", user.id),
  ]);
  const settings = settingsR.data as Settings | null;
  const currency = (settings?.base_currency ?? "PHP") as CurrencyCode;
  const payments = (paymentsR.data ?? []) as Payment[];
  const projects = (projectsR.data ?? []) as Project[];
  const clients = (clientsR.data ?? []) as Client[];
  const rates = (ratesR.data ?? []) as ExchangeRate[];
  const methods = (methodsR.data ?? []) as PaymentMethod[];

  const metrics = cashflowMetrics(payments);
  const rows = outstanding(projects, payments, clients, rates);
  const projectsById = new Map(projects.map((p) => [p.id, p]));

  // Per-client rollup
  const perClient = clients.map((c) => {
    const ids = new Set(projects.filter((p) => p.client_id === c.id).map((p) => p.id));
    const landed = payments.filter((p) => ids.has(p.project_id)).reduce((s, p) => s + Number(p.net_amount_base ?? 0), 0);
    const owed = rows.filter((r) => r.client?.id === c.id).reduce((s, r) => s + r.outstandingBase, 0);
    const last = payments.filter((p) => ids.has(p.project_id)).map((p) => p.paid_at).sort().pop();
    const mem = c.memory_consolidated ?? {};
    return `- ${c.name}: landed ${formatMoney(landed, currency, { compact: true })}, owes ${formatMoney(owed, currency, { compact: true })}, last paid ${last ?? "never"}${c.short_description ? ` · ${c.short_description}` : ""}${mem.summary ? ` · memory: ${mem.summary}` : ""}`;
  });

  const recent = payments.slice(0, 10).map((p) => {
    const proj = projectsById.get(p.project_id);
    return `- ${p.paid_at}: ${proj?.title ?? "?"} → ${formatMoney(Number(p.net_amount_base ?? 0), currency)} net (fee ${formatMoney(Number(p.implied_fee_base ?? 0), currency, { compact: true })})`;
  });

  const snapshot = `Base currency: ${currency}. Today: ${new Date().toISOString().slice(0, 10)}.
This month landed: ${formatMoney(metrics.mtd, currency)} | last month: ${formatMoney(metrics.lastMonth, currency)} | YTD: ${formatMoney(metrics.ytd, currency)} | fees this month: ${formatMoney(metrics.feesMtd, currency)}.
Total outstanding: ${formatMoney(rows.reduce((s, r) => s + r.outstandingBase, 0), currency)} across ${rows.length} projects.

CLIENTS:
${perClient.join("\n") || "- none"}

OUTSTANDING (urgent first):
${rows.slice(0, 8).map((r) => `- ${r.client?.name ?? "?"}: ${r.project.title} ${formatMoney(r.outstandingNative, r.project.currency as CurrencyCode)} (${r.daysAged}d)`).join("\n") || "- none"}

METHODS: ${methods.map((m) => m.name).join(", ") || "none"}

RECENT PAYMENTS:
${recent.join("\n") || "- none"}`;

  try {
    const res = await gemini().models.generateContent({
      model: MODEL,
      contents: `Snapshot:\n${snapshot}\n\nQuestion: ${q}`,
      config: { systemInstruction: ASK_SYSTEM, temperature: 0.4 },
    });
    return { ok: true, answer: (res.text ?? "").trim() };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

const FOLLOWUP_SYSTEM = `You draft a short follow-up message a freelancer sends a client about an unpaid balance.

RULES:
- 2–4 sentences. Warm, professional, never pushy or guilt-trippy.
- Match the tone implied by the client memory (e.g. casual with a long-time boss, more formal with a new client).
- Mention the project and amount naturally; reference how long it's been only if it helps.
- Write in the relationship's language if the memory says so (e.g. French), else English.
- Return ONLY the message text — no preamble, no signature placeholder, no quotes.`;

export async function draftFollowUp(clientId: string): Promise<{ ok: boolean; message?: string; error?: string }> {
  if (!hasGemini()) return { ok: false, error: "Gemini isn't configured." };
  const user = await getAuthUser();
  if (!user) return { ok: false, error: "Unauthenticated" };
  const supabase = await createClient();

  const [clientR, projectsR, paymentsR, ratesR, settingsR] = await Promise.all([
    supabase.from("clients").select("*").eq("id", clientId).eq("user_id", user.id).maybeSingle(),
    supabase.from("projects").select("*").eq("user_id", user.id).eq("client_id", clientId),
    supabase.from("payments").select("*").eq("user_id", user.id),
    supabase.from("exchange_rates").select("*").eq("user_id", user.id),
    supabase.from("settings").select("*").eq("user_id", user.id).maybeSingle(),
  ]);
  const client = clientR.data as Client | null;
  if (!client) return { ok: false, error: "Client not found" };
  const projects = (projectsR.data ?? []) as Project[];
  const payments = (paymentsR.data ?? []) as Payment[];
  const rates = (ratesR.data ?? []) as ExchangeRate[];

  const rows = outstanding(projects, payments, [client], rates);
  const top = rows[0];
  if (!top) return { ok: false, error: "Nothing outstanding for this client." };

  const mem = client.memory_consolidated ?? {};
  const memText = [mem.summary, ...(mem.facts ?? []), ...(mem.watch ?? [])].filter(Boolean).join("; ");

  const prompt = `Client: ${client.name}${client.short_description ? ` (${client.short_description})` : ""}
Memory: ${memText || "none"}
Unpaid: ${top.project.title} — ${formatMoney(top.outstandingNative, top.project.currency as CurrencyCode)}, ${top.daysAged} days since quoted.

Draft the follow-up message.`;

  try {
    const res = await gemini().models.generateContent({
      model: MODEL,
      contents: prompt,
      config: { systemInstruction: FOLLOWUP_SYSTEM, temperature: 0.6 },
    });
    return { ok: true, message: (res.text ?? "").trim() };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
