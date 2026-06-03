import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import type { FaithSettings } from "@/lib/supabase/types";

// Returns the user's faith settings row, or null when the user hasn't
// opened the Faith subtab yet. The Faith page treats null as "render the
// onboarding shell" (asks for location + method) rather than blowing up.

export async function getFaithSettings(): Promise<FaithSettings | null> {
  const user = await getAuthUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("faith_settings")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  return ((data as unknown) as FaithSettings) ?? null;
}
