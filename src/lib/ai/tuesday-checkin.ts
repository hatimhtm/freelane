import "server-only";
import { Type } from "@google/genai";
import { gemini, hasGemini } from "./gemini";
import { HEAVY_MODEL } from "./models";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { phtDateString, phtToday } from "@/lib/utils";
import { logEvent } from "@/lib/data/events";
import type { WellbeingCheckin } from "@/lib/supabase/types";

// Tuesday Check-In (#15) — Hatim 2026-06-01: "Weekly soft footer prompt
// under safe-to-spend. Private emotional ledger." Not therapy. Not a mood
// tracker. A small place to write a line about the week as it actually
// felt — money + life + body.
//
// Two AI passes:
//   1. promptForWeek() — pick a thoughtful question for the current week.
//   2. echoCheckin() — after Hatim answers, write ONE observational line
//      back. The echo gets persisted on the row + folded into user_memory.

const DAY_MS = 86_400_000;

const PROMPT_SCHEMA = {
  type: Type.OBJECT,
  properties: { prompt: { type: Type.STRING } },
  required: ["prompt"],
};

const ECHO_SCHEMA = {
  type: Type.OBJECT,
  properties: { echo: { type: Type.STRING } },
  required: ["echo"],
};

const VOICE_FLOOR = `You speak to Hatim — solo freelancer in San Pablo, PHT. Soft voice. He wants observation, not therapy, not pep talks.

HARD RULES (NON-NEGOTIABLE):
- FORBIDDEN PHRASES: "you should", "try to", "consider", "remember", "make sure", "stay positive", "stay strong", "you got this", "well done", "great job", "amazing", "I'm here for you", "you're doing great", "everything will be ok", "well-being check-in".
- Voice: warm, dry, observational. NEVER preachy. NEVER cheerleading.
- No emojis. No motivational fluff.
- Family-building frame allowed sparingly. Religious practice (Sadaka, Ramadan) respected, never quantified.`;

const PROMPT_PROMPT = `${VOICE_FLOOR}

Today is Tuesday. Write ONE soft, specific question for Hatim to answer about the week so far. It can touch money, body, mind, or relationships — but it should feel personal and grounded, not generic.

HARD RULES:
- 8-16 words, ending with a question mark.
- Vary the topic week-to-week based on the past prompts list provided. DON'T repeat themes too often.
- Acceptable shapes:
  - "What's the smallest thing that landed well this week?"
  - "Where did money feel like it cost more than the number?"
  - "Anything you've been carrying in your head that hasn't reached the page?"
  - "How's the sleep been since the MacBook switch?"

Return JSON: { "prompt": "<question>" }`;

const ECHO_PROMPT = `${VOICE_FLOOR}

You receive Hatim's Tuesday Check-In response + the week's money snapshot. Write ONE observational sentence (12-26 words) that mirrors what he wrote without advising. The echo is HIS to read; it folds into user_memory so the long-form letters can reference it.

HARD RULES:
- 12-26 words. ONE sentence.
- FORBIDDEN: any directive. Mirror, never advise. NEVER "you should do X". NEVER "next week, try Y".
- If he names a difficult feeling, NAME it back simply ("the weight you described is real").
- If he names a small win, acknowledge it factually ("the wide stretch you noticed shows in the numbers too").
- Cite a real number from the snapshot ONLY when it adds substance.

Return JSON: { "echo": "<sentence>" }`;

// ─────────────────────────── Period helpers ──

function mondayOf(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = x.getDay() || 7;
  x.setDate(x.getDate() - (dow - 1));
  return x;
}

export function currentWeekStarts(now: Date = new Date()): string {
  return phtDateString(mondayOf(new Date(phtToday())));
}

export function isCheckinDay(now: Date = new Date()): boolean {
  // Tuesday in PHT (where Sunday = 0, Tuesday = 2).
  const today = new Date(phtToday());
  return today.getDay() === 2;
}

// ─────────────────────────── Brain calls ──

export async function promptForWeek(): Promise<string> {
  const user = await getAuthUser();
  if (!user) return "How did the week land for you so far?";
  const supabase = await createClient();
  const weekStarts = currentWeekStarts();

  const { data: existing } = await supabase
    .from("wellbeing_checkins")
    .select("*")
    .eq("user_id", user.id)
    .eq("week_starts", weekStarts)
    .maybeSingle();
  if (existing?.prompt) return existing.prompt as string;

  // Read the last 6 prompts to encourage variety.
  const { data: pastRows } = await supabase
    .from("wellbeing_checkins")
    .select("prompt,week_starts")
    .eq("user_id", user.id)
    .order("week_starts", { ascending: false })
    .limit(6);
  const past = ((pastRows ?? []) as Array<{ prompt: string | null }>)
    .map((r) => r.prompt)
    .filter((p): p is string => !!p);

  let prompt = "What's the smallest thing that landed well this week?";
  if (hasGemini()) {
    try {
      const snapshot = `past_prompts=${past.length ? past.map((p) => `"${p}"`).join("; ") : "(none yet)"}`;
      const res = await gemini().models.generateContent({
        model: HEAVY_MODEL,
        contents: `Tuesday Check-In prompt context:\n${snapshot}\n\nReturn JSON.`,
        config: {
          systemInstruction: PROMPT_PROMPT,
          temperature: 0.7,
          responseMimeType: "application/json",
          responseSchema: PROMPT_SCHEMA,
        },
      });
      const parsed = JSON.parse((res.text ?? "{}").trim()) as { prompt?: string };
      if (parsed.prompt?.trim()) prompt = parsed.prompt.trim();
    } catch {
      // keep fallback
    }
  }

  // Persist the prompt up front so the user sees the same one each load.
  await supabase
    .from("wellbeing_checkins")
    .upsert({ user_id: user.id, week_starts: weekStarts, prompt }, { onConflict: "user_id,week_starts" });

  return prompt;
}

export interface CheckinEchoArgs {
  response: string;
  mood?: number | null;
  energy?: number | null;
  weekMoneyShape?: {
    landed?: number;
    spent?: number;
    surplus?: number;
  };
}

export async function echoCheckin(args: CheckinEchoArgs): Promise<WellbeingCheckin | null> {
  const user = await getAuthUser();
  if (!user) return null;
  const supabase = await createClient();
  const weekStarts = currentWeekStarts();

  const responseTrimmed = args.response.trim();
  if (!responseTrimmed) return null;

  let echo = "";
  if (hasGemini()) {
    try {
      const snapshot = `response="${responseTrimmed.replace(/"/g, "'")}"\nmood=${args.mood ?? "(n/a)"}\nenergy=${args.energy ?? "(n/a)"}\nmoney_landed=${args.weekMoneyShape?.landed ?? "(n/a)"}\nmoney_spent=${args.weekMoneyShape?.spent ?? "(n/a)"}\nsurplus=${args.weekMoneyShape?.surplus ?? "(n/a)"}`;
      const res = await gemini().models.generateContent({
        model: HEAVY_MODEL,
        contents: `Tuesday Check-In echo snapshot:\n${snapshot}\n\nReturn JSON.`,
        config: {
          systemInstruction: ECHO_PROMPT,
          temperature: 0.5,
          responseMimeType: "application/json",
          responseSchema: ECHO_SCHEMA,
        },
      });
      const parsed = JSON.parse((res.text ?? "{}").trim()) as { echo?: string };
      if (parsed.echo?.trim()) echo = parsed.echo.trim();
    } catch {
      // keep fallback (empty)
    }
  }

  const { data, error } = await supabase
    .from("wellbeing_checkins")
    .upsert(
      {
        user_id: user.id,
        week_starts: weekStarts,
        response: responseTrimmed,
        mood: args.mood ?? null,
        energy: args.energy ?? null,
        echo: echo || null,
        generated_at: echo ? new Date().toISOString() : null,
      },
      { onConflict: "user_id,week_starts" },
    )
    .select("*")
    .single();
  if (error || !data) return null;

  await logEvent({
    userId: user.id,
    kind: "wellbeing.checkin_saved",
    title: "Tuesday check-in saved",
    entityType: "wellbeing_checkin",
    entityId: (data as WellbeingCheckin).id,
    metadata: { week_starts: weekStarts, has_echo: !!echo },
  });

  if (echo) {
    // Fold into user_memory so the editorial letters can read it.
    try {
      await supabase.from("user_memory_entries").insert({
        user_id: user.id,
        content: `Tuesday check-in (${weekStarts}) — Q: ${(data as WellbeingCheckin).prompt ?? "(no prompt)"} A: ${responseTrimmed} | Echo: ${echo}`,
        source: "user_note",
      });
    } catch {
      // Best-effort.
    }
    await logEvent({
      userId: user.id,
      kind: "wellbeing.echo_generated",
      title: "Echo written",
      entityType: "wellbeing_checkin",
      entityId: (data as WellbeingCheckin).id,
    });
  }

  return data as WellbeingCheckin;
}

export async function getCurrentCheckin(): Promise<WellbeingCheckin | null> {
  const user = await getAuthUser();
  if (!user) return null;
  const supabase = await createClient();
  const weekStarts = currentWeekStarts();
  const { data } = await supabase
    .from("wellbeing_checkins")
    .select("*")
    .eq("user_id", user.id)
    .eq("week_starts", weekStarts)
    .maybeSingle();
  return (data ?? null) as WellbeingCheckin | null;
}

void DAY_MS;
