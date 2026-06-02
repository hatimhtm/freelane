"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { safeRunLabeled, type ActionResult } from "@/lib/data/actions";
import { archiveSadakaLedgerRow, findLiveLedgerRowBySource } from "./ledger";
import type {
  AutoRuleRow,
  CreateAutoRuleInput,
} from "./auto-rules";

// Freelane Sadaka — auto-rules CRUD + the "Not sadaka" reject affordance.
//
// The auto-rules table powers 3 of the 4 detection mechanisms (pattern,
// category, note pattern) plus a denylist note pattern that suppresses the
// AI classifier. This module is the client-callable server-action surface;
// types live in the sibling auto-rules.ts (Next 16 forbids non-async
// exports here).

export async function listAutoRules(): Promise<AutoRuleRow[]> {
  const user = await getAuthUser();
  if (!user) return [];
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("sadaka_auto_rules")
      .select("id,user_id,match_kind,pattern,active,label,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });
    if (error || !data) return [];
    return data as AutoRuleRow[];
  } catch {
    return [];
  }
}

export async function createAutoRule(
  input: CreateAutoRuleInput,
): Promise<ActionResult<{ id: string }>> {
  return safeRunLabeled("freelane-sadaka", "createAutoRule", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const pattern = (input.pattern ?? "").trim();
    if (!pattern) throw new Error("Pattern can't be empty.");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("sadaka_auto_rules")
      .insert({
        user_id: user.id,
        match_kind: input.match_kind,
        pattern,
        label: input.label ?? null,
        active: input.active ?? true,
      })
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("Couldn't save the rule.");
    revalidatePath("/sadaka");
    return { id: (data as { id: string }).id };
  });
}

export async function toggleAutoRule(
  id: string,
  active: boolean,
): Promise<ActionResult<true>> {
  return safeRunLabeled("freelane-sadaka", "toggleAutoRule", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const supabase = await createClient();
    const { error } = await supabase
      .from("sadaka_auto_rules")
      .update({ active })
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) throw error;
    revalidatePath("/sadaka");
    return true as const;
  });
}

export async function deleteAutoRule(id: string): Promise<ActionResult<true>> {
  return safeRunLabeled("freelane-sadaka", "deleteAutoRule", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const supabase = await createClient();
    const { error } = await supabase
      .from("sadaka_auto_rules")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) throw error;
    revalidatePath("/sadaka");
    return true as const;
  });
}

// Extract a disambiguating phrase from a note for the denylist seed. The
// goal: a short, currency-/digit-free token chain that future spends
// matching the SAME shape will trip. "Gave Ahmed ₱500 for school fees" →
// "gave ahmed for school fees" → trimmed to first 4 tokens of length ≥ 3.
// Returns null when the note has nothing meaningful to learn from.
function denylistSeedFromNote(note: string): string | null {
  const stripped = note
    .toLowerCase()
    // Drop currency symbols, digits, and punctuation.
    .replace(/[₱$€£¥]/g, " ")
    .replace(/[0-9]+/g, " ")
    .replace(/[^a-z\s]/g, " ");
  const tokens = stripped
    .split(/\s+/)
    .filter((t) => t.length >= 3);
  if (tokens.length === 0) return null;
  const top = tokens.slice(0, 4).join(" ");
  if (top.length < 4) return null;
  return top;
}

// "Not sadaka" — archives the auto-detected ledger row AND mints a
// denylist_note rule from the source spend's note so the classifier learns.
// Best-effort on the rule-mint side: a missing note still archives the row.
//
// Behaviour by source mechanism (read from the row's reasoning prefix):
//   • entity-flag rejection (mechanism 1) → the denylist note is useless
//     because mechanism 1 doesn't consult notes. We still archive the row
//     and surface a hint in the rule label, but we ALSO clear the entity's
//     sadaka_recipient flag so future transfers to the same person stop
//     firing mechanism 1.
//   • charity-vendor rejection (mechanism 2) → same shape, but the flag
//     to clear is the vendor's is_charity column.
//   • pattern / classifier rejection (mechanisms 3, 4) → mint a sharp
//     denylist_note seed extracted from the note (digits/currency
//     stripped, tokens ≥ 3 chars, first 4 tokens).
export async function rejectAutoDetected(
  ledgerRowId: string,
): Promise<ActionResult<true>> {
  return safeRunLabeled("freelane-sadaka", "rejectAutoDetected", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const supabase = await createClient();
    // Pull the row first so we can extract the source spend note + the
    // reasoning prefix that tells us which mechanism fired.
    const { data: row } = await supabase
      .from("sadaka_ledger")
      .select("id,source_kind,source_id,kind,reasoning")
      .eq("id", ledgerRowId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!row) throw new Error("Ledger row not found.");
    const rowKind = (row as { kind: string }).kind;
    if (rowKind !== "auto_detected") {
      // Only auto_detected rows are subject to the "Not sadaka" affordance.
      throw new Error("Only auto-detected rows can be rejected.");
    }
    const archived = await archiveSadakaLedgerRow(
      ledgerRowId,
      "rejected · Not sadaka",
    );
    if (!archived) throw new Error("Couldn't archive the row.");

    const sourceKind = (row as { source_kind: string | null }).source_kind;
    const sourceId = (row as { source_id: string | null }).source_id;
    const reasoning = ((row as { reasoning: string | null }).reasoning ?? "").toLowerCase();
    if (sourceKind === "spend" && sourceId) {
      // Mechanism 1 — entity transfer. Clear the entity flag so future
      // transfers to this person stop tripping the same path. A
      // denylist_note seed off the note wouldn't help here (mechanism 1
      // doesn't consult notes).
      if (reasoning.startsWith("auto-detected · transfer to")) {
        const { data: links } = await supabase
          .from("spend_entity_links")
          .select("entity_id")
          .eq("spend_id", sourceId);
        const entityIds = (links ?? []).map(
          (r) => (r as { entity_id: string }).entity_id,
        );
        if (entityIds.length > 0) {
          await supabase
            .from("entities")
            .update({ sadaka_recipient: false })
            .in("id", entityIds)
            .eq("user_id", user.id)
            .eq("sadaka_recipient", true);
        }
      } else if (reasoning.startsWith("auto-detected · charity vendor")) {
        // Mechanism 2 — charity-vendor flag. Clear is_charity for the
        // same reason.
        const { data: links } = await supabase
          .from("spend_vendor_links")
          .select("vendor_id")
          .eq("spend_id", sourceId);
        const vendorIds = (links ?? []).map(
          (r) => (r as { vendor_id: string }).vendor_id,
        );
        if (vendorIds.length > 0) {
          await supabase
            .from("vendors")
            .update({ is_charity: false })
            .in("id", vendorIds)
            .eq("user_id", user.id)
            .eq("is_charity", true);
        }
      } else {
        // Mechanism 3 or 4 — note-driven. Mint a sharp denylist seed.
        const { data: spend } = await supabase
          .from("spends")
          .select("notes,description")
          .eq("id", sourceId)
          .eq("user_id", user.id)
          .maybeSingle();
        const noteSeed = (
          (spend as { notes: string | null; description: string | null } | null)
            ?.notes ??
          (spend as { notes: string | null; description: string | null } | null)
            ?.description ??
          ""
        ).trim();
        const pattern = denylistSeedFromNote(noteSeed);
        if (pattern) {
          // Skip if a covering active denylist already exists for this
          // user to keep the rules table tidy.
          const { data: existing } = await supabase
            .from("sadaka_auto_rules")
            .select("id")
            .eq("user_id", user.id)
            .eq("match_kind", "denylist_note")
            .eq("active", true)
            .eq("pattern", pattern)
            .limit(1);
          if ((existing ?? []).length === 0) {
            await supabase.from("sadaka_auto_rules").insert({
              user_id: user.id,
              match_kind: "denylist_note",
              pattern,
              active: true,
              label: "Learned from rejection",
            });
          }
        }
      }
    }
    // Keep findLiveLedgerRowBySource referenced for future callers that
    // want to re-resolve before archiving.
    void findLiveLedgerRowBySource;
    revalidatePath("/sadaka");
    return true as const;
  });
}
