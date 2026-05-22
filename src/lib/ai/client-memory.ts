import "server-only";
import { Type } from "@google/genai";
import { gemini, MODEL, hasGemini } from "./gemini";
import { createClient } from "@/lib/supabase/server";
import { toBase, formatMoney } from "@/lib/money";
import type {
  ClientMemoryConsolidated,
  CurrencyCode,
  ExchangeRate,
  Payment,
  PaymentMethod,
  PaymentStep,
  Project,
} from "@/lib/supabase/types";
import { chainSignature, sortedSteps } from "@/lib/payment-chain";

const SYSTEM = `You maintain a living memory document about a single freelance client, for a solo freelancer's money-tracking app.

You receive the client's name + description, the CURRENT consolidated memory (JSON), any raw notes the user wrote, AND the client's full transaction history (projects, payments, fees, how they pay, how fast). Merge ALL of it into one updated memory — you are expected to learn from the data itself, not just the notes.

RULES:
- Keep it factual and concise. No flattery, no filler.
- "summary": 1-2 sentences — who this client is and how they pay (cadence, currency, route, reliability).
- "facts": durable truths. Mine these from the transaction history too: typical payment cadence/lateness, preferred currency + payout route, average fee on their payments, their biggest project, total landed. Dedupe; newer overrides older.
- "watch": current risks. Derive from data — e.g. "no payment in 90 days", "last 2 invoices paid 3+ weeks late", "outstanding ₱X aging N days". Drop items the data shows resolved.
- "preferences": small key/value pairs (language, tone) when known.
- Never invent specifics not supported by the notes or the data.
- If a note and the data conflict, prefer the more recent signal.`;

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING },
    facts: { type: Type.ARRAY, items: { type: Type.STRING } },
    watch: { type: Type.ARRAY, items: { type: Type.STRING } },
    preferences: {
      type: Type.OBJECT,
      properties: {
        language: { type: Type.STRING },
        tone: { type: Type.STRING },
      },
    },
  },
  required: ["summary", "facts", "watch"],
  propertyOrdering: ["summary", "facts", "watch", "preferences"],
};

// Folds the client's notes AND their full transaction history into the living
// memory doc. Runs after a note is added AND after a payment is logged, so the
// memory keeps itself current as money moves — even with no manual notes.
// Best-effort: if Gemini isn't configured or errors, raw notes/data still stand.
export async function consolidateClientMemory(clientId: string): Promise<void> {
  if (!hasGemini()) return;
  const supabase = await createClient();

  const [{ data: client }, { data: entries }, { data: settings }] = await Promise.all([
    supabase.from("clients").select("*").eq("id", clientId).maybeSingle(),
    supabase.from("client_memory_entries").select("id,content,created_at").eq("client_id", clientId).order("created_at"),
    supabase.from("settings").select("base_currency").maybeSingle(),
  ]);
  if (!client) return;

  const userId = (client as { user_id: string }).user_id;
  const currency = ((settings?.base_currency ?? "PHP") as CurrencyCode);

  const [{ data: projects }, { data: rates }] = await Promise.all([
    supabase.from("projects").select("*").eq("client_id", clientId),
    supabase.from("exchange_rates").select("*").eq("user_id", userId),
  ]);
  const proj = (projects ?? []) as Project[];
  const rateRows = (rates ?? []) as ExchangeRate[];
  const projectIds = proj.map((p) => p.id);

  const { data: payRows } = await supabase
    .from("payments")
    .select("*")
    .in("project_id", projectIds.length ? projectIds : ["00000000-0000-0000-0000-000000000000"])
    .order("paid_at", { ascending: false });
  const payments = (payRows ?? []) as Payment[];

  // No notes AND no transactions yet → nothing to learn from.
  if (!entries?.length && payments.length === 0) return;

  const [{ data: stepRows }, { data: methodRows }] = await Promise.all([
    supabase.from("payment_steps").select("*").in("payment_id", payments.length ? payments.map((p) => p.id) : ["00000000-0000-0000-0000-000000000000"]),
    supabase.from("payment_methods").select("*").eq("user_id", userId),
  ]);
  const stepsByPayment = new Map<string, PaymentStep[]>();
  ((stepRows ?? []) as PaymentStep[]).forEach((s) => {
    const arr = stepsByPayment.get(s.payment_id) ?? [];
    arr.push(s);
    stepsByPayment.set(s.payment_id, arr);
  });
  const methodsById = new Map(((methodRows ?? []) as PaymentMethod[]).map((m) => [m.id, m]));
  const projectsById = new Map(proj.map((p) => [p.id, p]));

  const landed = payments.reduce((s, p) => s + Number(p.net_amount_base ?? 0), 0);
  const fees = payments.reduce((s, p) => s + Number(p.implied_fee_base ?? 0), 0);
  const outstanding = proj
    .filter((p) => p.status === "unpaid" || p.status === "partially_paid")
    .reduce((s, p) => {
      const paid = payments.filter((pay) => pay.project_id === p.id).reduce((a, pay) => a + Number(pay.net_amount_base ?? 0), 0);
      return s + Math.max(0, toBase(Number(p.amount), p.currency as CurrencyCode, rateRows) - paid);
    }, 0);

  const scope = `TRANSACTION HISTORY (base currency ${currency}):
- Projects: ${proj.length} (${proj.filter((p) => p.status === "paid").length} paid, ${proj.filter((p) => p.status === "unpaid" || p.status === "partially_paid").length} open)
- Lifetime landed: ${formatMoney(landed, currency, { compact: true })} · total fees paid: ${formatMoney(fees, currency, { compact: true })} · outstanding now: ${formatMoney(outstanding, currency, { compact: true })}
- Payments (newest first):
${payments.slice(0, 15).map((p) => {
    const sig = chainSignature(sortedSteps(stepsByPayment.get(p.id) ?? []), methodsById);
    const title = projectsById.get(p.project_id)?.title ?? "?";
    const quoted = projectsById.get(p.project_id)?.quoted_at;
    const lag = quoted ? Math.round((new Date(p.paid_at).getTime() - new Date(quoted).getTime()) / 86_400_000) : null;
    const feeStr = p.fee_unknown ? "fee unknown" : `fee ${formatMoney(Number(p.implied_fee_base ?? 0), currency, { compact: true })}`;
    return `   • ${p.paid_at}: ${title} via ${sig} → ${formatMoney(Number(p.net_amount_base ?? 0), currency, { compact: true })} net (${feeStr}${lag !== null ? `, ${lag}d after quote` : ""})`;
  }).join("\n") || "   • none yet"}
- Open balances:
${proj.filter((p) => p.status === "unpaid" || p.status === "partially_paid").map((p) => `   • ${p.title}: ${formatMoney(Number(p.amount), p.currency as CurrencyCode, { compact: true })}${p.quoted_at ? `, quoted ${p.quoted_at}` : ""}`).join("\n") || "   • none"}`;

  const prior = (client.memory_consolidated ?? {}) as ClientMemoryConsolidated;
  const prompt = `Client: ${client.name}${client.short_description ? ` — ${client.short_description}` : ""}

CURRENT MEMORY (JSON):
${JSON.stringify({ summary: prior.summary ?? "", facts: prior.facts ?? [], watch: prior.watch ?? [], preferences: prior.preferences ?? {} }, null, 2)}

NOTES the user wrote (oldest first):
${entries?.length ? entries.map((e) => `- (${String(e.created_at).slice(0, 10)}) ${e.content}`).join("\n") : "- (none)"}

${scope}

Return the updated memory as JSON, folding in everything above.`;

  try {
    const res = await gemini().models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM,
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: SCHEMA,
      },
    });
    const parsed = JSON.parse((res.text ?? "{}").trim());
    const consolidated: ClientMemoryConsolidated = {
      summary: parsed.summary,
      facts: parsed.facts ?? [],
      watch: parsed.watch ?? [],
      preferences: parsed.preferences ?? {},
      updated_at: new Date().toISOString(),
      entry_count: entries?.length ?? 0,
    };
    await supabase.from("clients").update({ memory_consolidated: consolidated }).eq("id", clientId);
    if (entries?.length) {
      await supabase
        .from("client_memory_entries")
        .update({ consolidated_at: new Date().toISOString() })
        .eq("client_id", clientId)
        .is("consolidated_at", null);
    }
  } catch {
    // Leave existing memory as-is; consolidation retries on the next note/payment.
  }
}
