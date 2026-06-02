"use server";

// Client-callable Server Actions for the vendor-identification flow
// (Spendings workflow). Lives in a dedicated *-actions.ts file per
// Next.js 16 use-server rule: a "use server" module may only export
// async functions, so non-async helpers (constants, query-builders, the
// notification dedup/cap math) stay in src/lib/notifications/dispatcher.ts
// + src/lib/data/actions.ts.
//
// Two surfaces:
//   - skipVendorIdentificationAction — user replied "skip" in the chat.
//     Flips identification_skipped=true so the dispatcher never queues
//     another vendor_identify_request for that vendor row.
//   - completeVendorIdentificationAction — user gave a description.
//     Defers to identifyVendorFromChat which runs the brain + writes
//     vendor_icon_cache + clears needs_identification.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import {
  safeRunLabeled,
  type ActionResult,
} from "@/lib/data/actions";
import { completeVendorIdentificationFromChat } from "@/lib/ai/identify-vendor-from-chat";

export async function skipVendorIdentificationAction(
  vendorId: string,
): Promise<ActionResult<{ id: string }>> {
  return safeRunLabeled(
    "freelane-spending",
    "skip-vendor-identification",
    async () => {
      const user = await getAuthUser();
      if (!user) throw new Error("Unauthenticated");
      const supabase = await createClient();
      const { error } = await supabase
        .from("vendors")
        .update({
          identification_skipped: true,
          needs_identification: false,
        })
        .eq("id", vendorId)
        .eq("user_id", user.id);
      if (error) throw error;
      revalidatePath("/spending");
      return { id: vendorId };
    },
  );
}

export async function completeVendorIdentificationAction(args: {
  vendorId: string;
  vendorName: string;
  userDescription: string;
}): Promise<ActionResult<{ id: string }>> {
  return safeRunLabeled(
    "freelane-spending",
    "complete-vendor-identification",
    async () => {
      const result = await completeVendorIdentificationFromChat(args);
      if (!result.ok) {
        throw new Error(result.error || "Identification failed.");
      }
      revalidatePath("/spending");
      return { id: args.vendorId };
    },
  );
}
