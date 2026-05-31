import "server-only";
import { Type } from "@google/genai";
import { gemini, hasGemini } from "./gemini";
import { HEAVY_MODEL } from "./models";
import type { Spend } from "@/lib/supabase/types";

// Late-Night Spend Cluster (#32) — needs Tier 1 spent_time on spends.
// Detects how often the user spends between 22:00 and 04:00 (PHT local
// hours of the day). Surfaces a one-line read when the count crosses
// 3 entries in the last 30 days OR > 8% of all timed spends.
//
// Voice: mirror only. NEVER "stop staying up". Just count.

const LATE_NIGHT_START = 22;
const LATE_NIGHT_END_EXCLUSIVE = 4;
const WINDOW_DAYS = 30;
const MIN_COUNT_TO_SURFACE = 3;
const MIN_FRACTION_TO_SURFACE = 0.08;
const DAY_MS = 86_400_000;

export interface LateNightClusterRead {
  totalTimedSpends: number;
  lateNightCount: number;
  lateNightShare: number;
  totalLateNightPhp: number;
  surface: boolean;
  line: string;
  fromAi: boolean;
}

const SYSTEM_PROMPT = `You write ONE line about Hatim's late-night spending pattern.

HARD RULES (NON-NEGOTIABLE):
- 10-22 words.
- FORBIDDEN PHRASES: "try to", "should", "consider", "remember", "make sure", "stop staying up", "rest more", "you might want to", "moralize", "be careful", "watch out".
- Voice: dry, observational. Mirror, never advise.
- Cite REAL numbers from the snapshot.
- Acceptable shapes:
  - "Six late-night spends in 30 days — about ₱1,400 between 22h and 04h."
  - "Late-night spends quiet this stretch — two in 30 days."

Return JSON: { "line": "<sentence>" }`;

const SCHEMA = {
  type: Type.OBJECT,
  properties: { line: { type: Type.STRING } },
  required: ["line"],
};

function isLateHour(spentTime: string | null): boolean {
  if (!spentTime) return false;
  const h = parseInt(spentTime.slice(0, 2), 10);
  if (Number.isNaN(h)) return false;
  return h >= LATE_NIGHT_START || h < LATE_NIGHT_END_EXCLUSIVE;
}

export async function generateLateNightRead(args: {
  spends: Spend[];
  now?: Date;
}): Promise<LateNightClusterRead> {
  const now = args.now ?? new Date();
  const cutoff = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);
  const recent = args.spends.filter((s) => {
    const d = new Date(s.spent_at);
    return d >= cutoff && d <= now;
  });
  const timed = recent.filter((s) => !!s.spent_time);
  const lateNight = timed.filter((s) => isLateHour(s.spent_time));
  const totalLateNightPhp = lateNight.reduce((sum, s) => sum + Number(s.amount_base ?? 0), 0);
  const totalTimed = timed.length;
  const fraction = totalTimed > 0 ? lateNight.length / totalTimed : 0;
  const surface = lateNight.length >= MIN_COUNT_TO_SURFACE || fraction >= MIN_FRACTION_TO_SURFACE;

  if (!surface) {
    return {
      totalTimedSpends: totalTimed,
      lateNightCount: lateNight.length,
      lateNightShare: fraction,
      totalLateNightPhp,
      surface: false,
      line: "",
      fromAi: false,
    };
  }

  let line = `${lateNight.length} late-night spend${lateNight.length === 1 ? "" : "s"} in ${WINDOW_DAYS} days — about ₱${Math.round(totalLateNightPhp).toLocaleString()} between 22h and 04h.`;
  let fromAi = false;
  if (hasGemini()) {
    try {
      const snapshot = `late_night_count=${lateNight.length}\ntotal_timed=${totalTimed}\nfraction=${fraction.toFixed(2)}\ntotal_php=${Math.round(totalLateNightPhp)}\nwindow_days=${WINDOW_DAYS}`;
      const res = await gemini().models.generateContent({
        model: HEAVY_MODEL,
        contents: `Late-night cluster snapshot:\n${snapshot}\n\nReturn JSON.`,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0.4,
          responseMimeType: "application/json",
          responseSchema: SCHEMA,
        },
      });
      const parsed = JSON.parse((res.text ?? "{}").trim()) as { line?: string };
      if (parsed.line?.trim()) {
        line = parsed.line.trim();
        fromAi = true;
      }
    } catch {
      // keep fallback
    }
  }

  return {
    totalTimedSpends: totalTimed,
    lateNightCount: lateNight.length,
    lateNightShare: fraction,
    totalLateNightPhp,
    surface,
    line,
    fromAi,
  };
}
