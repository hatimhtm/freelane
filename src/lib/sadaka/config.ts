import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getAuthUser } from "@/lib/auth";

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

// Writer (updateSadakaConfig) lives in ./config-actions.ts so that file can
// carry the "use server" pragma without forcing the rest of this module
// (which exports a type + an object constant) to be Server-Action-only.
// Server-Action files cannot export non-function values per Next.js 16.
