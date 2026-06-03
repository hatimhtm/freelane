"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { safeRunLabeled, type ActionResult } from "@/lib/data/actions";
import type { FaithMadhab } from "@/lib/supabase/types";

// Faith settings upsert. PK is user_id, so the upsert collapses
// create / update into a single round-trip. Cache tag invalidation flushes
// the aladhan day-cache when location or method change so the next render
// fetches fresh prayer times.

export type SaveFaithSettingsInput = {
  latitude: number | null;
  longitude: number | null;
  calculation_method: number;
  madhab: FaithMadhab;
  ramadan_enabled: boolean;
};

// Whitelist mirrors the CHECK constraint in 0108 + the picker catalogue in
// src/lib/faith/calculation-methods.ts. Skipping 6 / 7 keeps the value out
// of aladhan's institution-only fallback path that returns a silent
// substitute instead of an error.
const ALLOWED_CALCULATION_METHODS = new Set([
  0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 14, 15,
]);

export async function saveFaithSettings(
  input: SaveFaithSettingsInput,
): Promise<ActionResult<null>> {
  return safeRunLabeled("freelane-faith", "save", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");

    // Friendly client-side validation so a malformed call surfaces in the
    // toast as a readable message rather than a raw Postgres CHECK error.
    if (input.madhab !== "shafi" && input.madhab !== "hanafi") {
      throw new Error("Invalid madhab — pick Shafi'i or Hanafi.");
    }

    const lat =
      input.latitude == null || !Number.isFinite(input.latitude)
        ? null
        : Math.max(-90, Math.min(90, Number(input.latitude)));
    const lng =
      input.longitude == null || !Number.isFinite(input.longitude)
        ? null
        : Math.max(-180, Math.min(180, Number(input.longitude)));
    // Round to a candidate integer first, then snap unknowns back to ISNA
    // (2) so a stale client never lands a CHECK violation. 6 and 7 also
    // get snapped — see ALLOWED_CALCULATION_METHODS for why.
    const candidate = Math.max(
      0,
      Math.min(15, Math.floor(input.calculation_method ?? 2)),
    );
    const method = ALLOWED_CALCULATION_METHODS.has(candidate) ? candidate : 2;

    const supabase = await createClient();
    const { error } = await supabase
      .from("faith_settings")
      .upsert(
        {
          user_id: user.id,
          latitude: lat,
          longitude: lng,
          calculation_method: method,
          madhab: input.madhab,
          ramadan_enabled: !!input.ramadan_enabled,
        },
        { onConflict: "user_id" },
      );
    if (error) throw new Error(error.message);

    // The cache tag is GLOBAL — a single revalidateTag call flushes the
    // aladhan day-cache for ALL cached (lat, lng, date, method, madhab)
    // tuples. That's intentional: the user only ever rewrites THEIR row
    // so only their next render hits the network, and the cost of an
    // over-broad invalidation is one extra fetch per cached location.
    // Next.js 16: revalidateTag now requires a profile argument. "max"
    // gives stale-while-revalidate semantics — exactly what we want here:
    // the next visit shows the previous prayer times while fresh data is
    // fetched in the background. (updateTag would be wrong; it blocks.)
    revalidateTag("freelane-faith-prayer-times", "max");
    revalidatePath("/settings/faith");
    revalidatePath("/today");
    return null;
  });
}
