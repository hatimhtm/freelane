"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { safeRunLabeled, type ActionResult } from "@/lib/data/actions";

// Vendors workflow — always-ask canonicalize intent handler.
//
// Called from postChatMessage when activeCard.data.intent === "clarify_vendor".
// Two paths converge here:
//   1. User picked one of the brain's chips OR typed a canonical name →
//      writes finance.vendors.canonical_name + brand_key + pushes
//      raw_user_typed_name onto aliases (so the next time the user types
//      that raw form the spend matches without re-asking).
//   2. User typed "skip" (exact, case-insensitive, trimmed) →
//      identification_skipped = true so the dispatcher never re-asks for
//      this vendor row.
//
// Per Next.js 16 use-server rule: this module exports only async
// server actions. Constants + type guards live in chat-context-registry.

export async function clarifyVendorAction(args: {
  vendorId: string;
  vendorName: string;
  reply: string;
}): Promise<ActionResult<{ id: string; skipped: boolean }>> {
  return safeRunLabeled(
    "freelane-vendors",
    "clarify-vendor",
    async () => {
      const user = await getAuthUser();
      if (!user) throw new Error("Unauthenticated");
      const supabase = await createClient();
      const reply = args.reply.trim();
      const isSkip = reply.toLowerCase() === "skip";

      if (isSkip) {
        const { error } = await supabase
          .from("vendors")
          .update({
            identification_skipped: true,
            needs_identification: false,
          })
          .eq("id", args.vendorId)
          .eq("user_id", user.id);
        if (error) throw error;
        revalidatePath("/spending");
        revalidatePath("/spending/vendors");
        return { id: args.vendorId, skipped: true };
      }

      if (!reply) throw new Error("Empty reply.");

      // Read current row so we can merge aliases without overwriting.
      const { data: existing } = await supabase
        .from("vendors")
        .select("aliases, raw_user_typed_name, canonical_name")
        .eq("id", args.vendorId)
        .eq("user_id", user.id)
        .maybeSingle();

      const aliases = new Set<string>(
        Array.isArray(existing?.aliases)
          ? (existing!.aliases as string[])
          : [],
      );
      const raw = (existing as { raw_user_typed_name?: string | null } | null)
        ?.raw_user_typed_name;
      if (typeof raw === "string" && raw && raw !== reply) {
        aliases.add(raw);
      }
      // Pre-existing canonical that the user is now overriding becomes
      // an alias of its own.
      const priorCanonical = (existing as { canonical_name?: string | null } | null)
        ?.canonical_name;
      if (typeof priorCanonical === "string" && priorCanonical && priorCanonical !== reply) {
        aliases.add(priorCanonical);
      }

      // brand_key resolved from a simple normalize. The Brand Identity
      // resolver consults brand_key first; if the user typed a known
      // chain name the curated registry kicks in and the glyph paints
      // immediately on next render.
      const brandKey = reply
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");

      const { error } = await supabase
        .from("vendors")
        .update({
          canonical_name: reply,
          brand_key: brandKey || null,
          aliases: Array.from(aliases),
          needs_identification: false,
          identification_skipped: false,
          confidence: 1,
        })
        .eq("id", args.vendorId)
        .eq("user_id", user.id);
      if (error) throw error;

      // Persist the user's pick via the vendor-icon resolver so the
      // glyph cache lands too. Best-effort — the canonical_name write
      // above is the durable truth and is enough on its own.
      try {
        const { identifyVendorIconAction } = await import(
          "@/lib/ai/vendor-icon-actions"
        );
        await identifyVendorIconAction(reply).catch(() => {});
      } catch {
        /* dynamic-import safety net */
      }

      revalidatePath("/spending");
      revalidatePath("/spending/vendors");
      return { id: args.vendorId, skipped: false };
    },
  );
}
