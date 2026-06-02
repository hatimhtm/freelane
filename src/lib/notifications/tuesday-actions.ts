"use server";

import { promptForWeek } from "@/lib/ai/tuesday-checkin";
import { getCurrentWellbeingCheckin } from "@/lib/data/queries";
import { safeRunLabeled, type ActionResult } from "@/lib/data/actions";
import type { WellbeingCheckin } from "@/lib/supabase/types";

// Server-side fetcher used by the click-routing TuesdayCheckinLoader. The
// loader needs the prompt (LLM call) and the current week's row (DB call)
// before it can render the TuesdayCheckinModal — both are server-only, so
// they have to come through an action rather than a client fetch.

export type TuesdayCheckinData = {
  prompt: string;
  checkin: WellbeingCheckin | null;
};

export async function getTuesdayCheckinDataAction(): Promise<
  ActionResult<TuesdayCheckinData>
> {
  return safeRunLabeled("freelane-notif", "tuesdayData", async () => {
    const [prompt, checkin] = await Promise.all([
      promptForWeek().catch(() => ""),
      getCurrentWellbeingCheckin().catch(() => null),
    ]);
    return { prompt, checkin } as TuesdayCheckinData;
  });
}
