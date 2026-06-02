"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { safeRunLabeled, type ActionResult } from "@/lib/data/actions";
import {
  type SadakaConfig,
  getSadakaConfig,
} from "./config";

// Settings → Sadaka writer. Lives in its own "use server" module so the
// surrounding config.ts (which carries types + DEFAULT_SADAKA_CONFIG
// constant + server-only helpers) stays importable as a plain server-only
// module from server contexts without dragging Server-Action machinery into
// the client bundle.
//
// Anchored at Islamic-zakat 2.5%, hard-capped at 10 to match the
// contribution-rate brain's clamp. A typo of 50 would mint a 50%
// contribution row — bound it at the setter so the brain never sees an
// out-of-range base.

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

export async function updateSadakaConfig(
  patch: Partial<SadakaConfig>,
): Promise<ActionResult<SadakaConfig>> {
  return safeRunLabeled("freelane-sadaka", "updateSadakaConfig", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const current = await getSadakaConfig();
    const next: SadakaConfig = {
      base_contribution_pct:
        patch.base_contribution_pct !== undefined
          ? clamp(Number(patch.base_contribution_pct), 0, 10)
          : current.base_contribution_pct,
      decay_pct_monthly:
        patch.decay_pct_monthly !== undefined
          ? clamp(Number(patch.decay_pct_monthly), 0, 100)
          : current.decay_pct_monthly,
      nudge_silence_days:
        patch.nudge_silence_days !== undefined
          ? Math.max(0, Math.floor(Number(patch.nudge_silence_days)))
          : current.nudge_silence_days,
      classifier_confidence_threshold:
        patch.classifier_confidence_threshold !== undefined
          ? clamp(Number(patch.classifier_confidence_threshold), 0, 1)
          : current.classifier_confidence_threshold,
    };
    const supabase = await createClient();
    const { error } = await supabase
      .from("sadaka_config")
      .upsert(
        {
          user_id: user.id,
          base_contribution_pct: next.base_contribution_pct,
          decay_pct_monthly: next.decay_pct_monthly,
          nudge_silence_days: next.nudge_silence_days,
          classifier_confidence_threshold: next.classifier_confidence_threshold,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
    if (error) throw error;
    revalidatePath("/settings");
    revalidatePath("/sadaka");
    return next;
  });
}
