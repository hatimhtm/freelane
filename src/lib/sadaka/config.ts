"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getAuthUser } from "@/lib/auth";
import { safeRunLabeled, type ActionResult } from "@/lib/data/actions";

// Freelane Sadaka — per-user config.
//
// Defaults come from migration 0071; this module reads with a fallback so a
// missing row (slow trigger, race on first signup) never breaks downstream
// brains. Updates clamp into safe ranges so a typo in Settings can't sink
// the algorithm.

export type SadakaConfig = {
  base_contribution_pct: number;
  decay_pct_monthly: number;
  nudge_silence_days: number;
  classifier_confidence_threshold: number;
};

export const DEFAULT_SADAKA_CONFIG: SadakaConfig = {
  base_contribution_pct: 2.5,
  decay_pct_monthly: 4,
  nudge_silence_days: 5,
  classifier_confidence_threshold: 0.7,
};

export async function getSadakaConfig(): Promise<SadakaConfig> {
  const user = await getAuthUser();
  if (!user) return DEFAULT_SADAKA_CONFIG;
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("sadaka_config")
      .select(
        "base_contribution_pct,decay_pct_monthly,nudge_silence_days,classifier_confidence_threshold",
      )
      .eq("user_id", user.id)
      .maybeSingle();
    if (!data) return DEFAULT_SADAKA_CONFIG;
    return {
      base_contribution_pct: Number(
        (data as { base_contribution_pct: number | string }).base_contribution_pct ??
          DEFAULT_SADAKA_CONFIG.base_contribution_pct,
      ),
      decay_pct_monthly: Number(
        (data as { decay_pct_monthly: number | string }).decay_pct_monthly ??
          DEFAULT_SADAKA_CONFIG.decay_pct_monthly,
      ),
      nudge_silence_days: Number(
        (data as { nudge_silence_days: number | string }).nudge_silence_days ??
          DEFAULT_SADAKA_CONFIG.nudge_silence_days,
      ),
      classifier_confidence_threshold: Number(
        (data as { classifier_confidence_threshold: number | string })
          .classifier_confidence_threshold ??
          DEFAULT_SADAKA_CONFIG.classifier_confidence_threshold,
      ),
    };
  } catch {
    return DEFAULT_SADAKA_CONFIG;
  }
}

// Trusted-server variant — uses the service client so it works outside a
// request context (cron, nudge dispatcher, decay). Name matches semantics:
// "ForUser" means "no auth, you already supplied the userId."
export async function getSadakaConfigForUser(userId: string): Promise<SadakaConfig> {
  if (!userId) return DEFAULT_SADAKA_CONFIG;
  try {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("sadaka_config")
      .select(
        "base_contribution_pct,decay_pct_monthly,nudge_silence_days,classifier_confidence_threshold",
      )
      .eq("user_id", userId)
      .maybeSingle();
    if (!data) return DEFAULT_SADAKA_CONFIG;
    return {
      base_contribution_pct: Number(
        (data as { base_contribution_pct: number | string }).base_contribution_pct ??
          DEFAULT_SADAKA_CONFIG.base_contribution_pct,
      ),
      decay_pct_monthly: Number(
        (data as { decay_pct_monthly: number | string }).decay_pct_monthly ??
          DEFAULT_SADAKA_CONFIG.decay_pct_monthly,
      ),
      nudge_silence_days: Number(
        (data as { nudge_silence_days: number | string }).nudge_silence_days ??
          DEFAULT_SADAKA_CONFIG.nudge_silence_days,
      ),
      classifier_confidence_threshold: Number(
        (data as { classifier_confidence_threshold: number | string })
          .classifier_confidence_threshold ??
          DEFAULT_SADAKA_CONFIG.classifier_confidence_threshold,
      ),
    };
  } catch {
    return DEFAULT_SADAKA_CONFIG;
  }
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
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
    const next: SadakaConfig = {
      // Anchored at Islamic-zakat 2.5%, hard-capped at 10 to match the
      // contribution-rate brain's clamp. A typo of 50 would mint a 50%
      // contribution row — bound it at the setter so the brain never sees
      // an out-of-range base.
      base_contribution_pct:
        patch.base_contribution_pct !== undefined
          ? clamp(Number(patch.base_contribution_pct), 0, 10)
          : (await getSadakaConfig()).base_contribution_pct,
      decay_pct_monthly:
        patch.decay_pct_monthly !== undefined
          ? clamp(Number(patch.decay_pct_monthly), 0, 100)
          : (await getSadakaConfig()).decay_pct_monthly,
      nudge_silence_days:
        patch.nudge_silence_days !== undefined
          ? Math.max(0, Math.floor(Number(patch.nudge_silence_days)))
          : (await getSadakaConfig()).nudge_silence_days,
      classifier_confidence_threshold:
        patch.classifier_confidence_threshold !== undefined
          ? clamp(Number(patch.classifier_confidence_threshold), 0, 1)
          : (await getSadakaConfig()).classifier_confidence_threshold,
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
