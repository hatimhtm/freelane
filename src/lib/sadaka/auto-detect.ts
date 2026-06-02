import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { insertSadakaLedgerRowResult, type InsertLedgerRowResult } from "./ledger";
import { getSadakaConfig } from "./config";
import { classifySpendForSadaka } from "@/lib/ai/brains/spend-sadaka-classifier";

// Freelane Sadaka — on-spend auto-detect hook.
//
// Invoked from createSpend AFTER the spend row + money_ledger outflow land.
// Runs four checks in order; first match wins via the partial unique index
// on (user_id, source_kind, source_id) WHERE archived_at IS NULL:
//
//   1. Entity flag (entities.sadaka_recipient) — fastest, no AI.
//   2. Named charity vendor (vendors.is_charity) — also fast, no AI.
//   3. Pattern match against sadaka_auto_rules (vendor_pattern / category /
//      note_pattern).
//   4. AI classifier (spend_sadaka_classifier brain) — only when the note
//      is ≥ 8 chars AND no earlier check fired. Tentative=true.
//
// Denylist scope: denylist_note rules suppress mechanism 4 (the AI
// classifier) only. Mechanisms 1-3 are deterministic user-flagged signals
// and are NOT gated by the denylist — the user already said "transfers to
// this person are sadaka" / "this vendor is a charity" / "this pattern is
// charity", so a denylist note shouldn't second-guess those explicit
// declarations. This matches the migration 0072 comment.
//
// Skips entirely when the spend was already marked is_sadaka=true (the
// explicit toggle wrote its own payment row in createSpend's branch).
// Best-effort: never throws. On insert failure (other than unique-conflict)
// the next mechanism gets a chance; the last attempt's failure stays
// observable via the conflict-swallow warning + reconcile pass.

type SpendForDetection = {
  id: string;
  user_id: string;
  amount_base: number;
  description: string | null;
  notes: string | null;
  is_sadaka: boolean;
  spent_at: string;
};

function tokensFromString(s: string | null | undefined): string[] {
  if (!s) return [];
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((t) => t.length >= 3);
}

// Word-boundary match — both haystack and pattern get tokenised, then we
// check whether every pattern token appears as a standalone token in the
// haystack. A pattern of "cat" no longer matches "category" or "vacation";
// "pet shop" requires both "pet" AND "shop" as tokens. Denylist + category
// use the same logic so a single short word like "groceries" still works
// (single token == single token equality). Patterns shorter than the
// 3-char tokeniser cutoff (e.g. a 2-char rule) fall back to substring
// matching as a safety net.
function matchesPattern(haystack: string, pattern: string): boolean {
  const p = pattern.trim().toLowerCase();
  if (!p) return false;
  const patternTokens = tokensFromString(p);
  if (patternTokens.length === 0) {
    // Pattern was below the token threshold (e.g. "ai"). Fall back to
    // substring match so an intentionally short seed still fires.
    return haystack.toLowerCase().includes(p);
  }
  const haystackTokens = new Set(tokensFromString(haystack));
  return patternTokens.every((t) => haystackTokens.has(t));
}

// Decide whether to keep going to the next mechanism after an insert
// attempt. ok → done (we landed the row). unique → done (a peer mechanism
// already landed a row for this source). error → try the next mechanism.
function shouldStopAfter(result: InsertLedgerRowResult): boolean {
  return result.ok || result.reason === "unique";
}

export async function onSpendCreated(spend: SpendForDetection): Promise<void> {
  try {
    // Explicit toggle overrides every auto rule.
    if (spend.is_sadaka) return;
    if (!(spend.amount_base > 0)) return;

    const supabase = await createClient();
    const user = await getAuthUser();
    if (!user) return;
    const userId = user.id;

    // ── 1. Entity flag — resolve through spend_entity_links ───────────
    const { data: entityLinks } = await supabase
      .from("spend_entity_links")
      .select("entity_id")
      .eq("spend_id", spend.id);
    const entityIds = (entityLinks ?? []).map(
      (r) => (r as { entity_id: string }).entity_id,
    );
    if (entityIds.length > 0) {
      const { data: flagged } = await supabase
        .from("entities")
        .select("id,name")
        .in("id", entityIds)
        .eq("user_id", userId)
        .eq("sadaka_recipient", true)
        .limit(1);
      const first = (flagged ?? [])[0] as { id: string; name: string } | undefined;
      if (first) {
        const r = await insertSadakaLedgerRowResult({
          kind: "auto_detected",
          amount_base: -1 * Math.abs(spend.amount_base),
          source_kind: "spend",
          source_id: spend.id,
          reasoning: `Auto-detected · transfer to ${first.name}`,
          event_at: spend.spent_at,
        });
        if (shouldStopAfter(r)) return;
        // Transient failure — fall through to the next mechanism.
      }
    }

    // ── 2. Named charity vendor ──────────────────────────────────────
    const { data: vendorLinks } = await supabase
      .from("spend_vendor_links")
      .select("vendor_id")
      .eq("spend_id", spend.id);
    const vendorIds = (vendorLinks ?? []).map(
      (r) => (r as { vendor_id: string }).vendor_id,
    );
    if (vendorIds.length > 0) {
      const { data: charityVendors } = await supabase
        .from("vendors")
        .select("id,name")
        .in("id", vendorIds)
        .eq("user_id", userId)
        .eq("is_charity", true)
        .limit(1);
      const charity = (charityVendors ?? [])[0] as { id: string; name: string } | undefined;
      if (charity) {
        const r = await insertSadakaLedgerRowResult({
          kind: "auto_detected",
          amount_base: -1 * Math.abs(spend.amount_base),
          source_kind: "spend",
          source_id: spend.id,
          reasoning: `Auto-detected · charity vendor ${charity.name}`,
          event_at: spend.spent_at,
        });
        if (shouldStopAfter(r)) return;
      }
    }

    // ── 3. Pattern rules ─────────────────────────────────────────────
    const { data: rules } = await supabase
      .from("sadaka_auto_rules")
      .select("id,match_kind,pattern,active,label")
      .eq("user_id", userId)
      .eq("active", true);
    const ruleRows = (rules ?? []) as Array<{
      id: string;
      match_kind: string;
      pattern: string;
      label: string | null;
    }>;

    const noteHay = [spend.notes ?? "", spend.description ?? ""].join(" ");
    const denylistRules = ruleRows.filter((r) => r.match_kind === "denylist_note");
    const denyHit = denylistRules.some((r) => matchesPattern(noteHay, r.pattern));

    // Vendor pattern match (token equality against vendor names).
    if (vendorIds.length > 0) {
      const { data: vendorRows } = await supabase
        .from("vendors")
        .select("id,name")
        .in("id", vendorIds)
        .eq("user_id", userId);
      const vendorNames = (vendorRows ?? [])
        .map((v) => (v as { name: string }).name ?? "")
        .join(" ");
      const vendorPatternRules = ruleRows.filter(
        (r) => r.match_kind === "vendor_pattern",
      );
      for (const r of vendorPatternRules) {
        if (matchesPattern(vendorNames, r.pattern)) {
          const res = await insertSadakaLedgerRowResult({
            kind: "auto_detected",
            amount_base: -1 * Math.abs(spend.amount_base),
            source_kind: "spend",
            source_id: spend.id,
            reasoning: `Auto-detected · ${r.label ?? r.pattern}`,
            event_at: spend.spent_at,
          });
          if (shouldStopAfter(res)) return;
        }
      }
    }

    // Category rule match. Pull category names through spend_category_links.
    const { data: catLinks } = await supabase
      .from("spend_category_links")
      .select("category_id")
      .eq("spend_id", spend.id);
    const categoryIds = (catLinks ?? []).map(
      (r) => (r as { category_id: string }).category_id,
    );
    if (categoryIds.length > 0) {
      const { data: cats } = await supabase
        .from("spend_categories")
        .select("id,name")
        .in("id", categoryIds)
        .eq("user_id", userId);
      const catNames = (cats ?? [])
        .map((c) => (c as { name: string }).name ?? "")
        .join(" ");
      const categoryRules = ruleRows.filter((r) => r.match_kind === "category");
      for (const r of categoryRules) {
        if (matchesPattern(catNames, r.pattern)) {
          const res = await insertSadakaLedgerRowResult({
            kind: "auto_detected",
            amount_base: -1 * Math.abs(spend.amount_base),
            source_kind: "spend",
            source_id: spend.id,
            reasoning: `Auto-detected · ${r.label ?? r.pattern}`,
            event_at: spend.spent_at,
          });
          if (shouldStopAfter(res)) return;
        }
      }
    }

    // Note-pattern rule match.
    const notePatternRules = ruleRows.filter((r) => r.match_kind === "note_pattern");
    for (const r of notePatternRules) {
      if (matchesPattern(noteHay, r.pattern)) {
        const res = await insertSadakaLedgerRowResult({
          kind: "auto_detected",
          amount_base: -1 * Math.abs(spend.amount_base),
          source_kind: "spend",
          source_id: spend.id,
          reasoning: `Auto-detected · ${r.label ?? r.pattern}`,
          event_at: spend.spent_at,
        });
        if (shouldStopAfter(res)) return;
      }
    }

    // ── 4. AI classifier ─────────────────────────────────────────────
    // Skip entirely when a denylist_note already hit — the user has said
    // "don't classify this shape" and the brain shouldn't second-guess.
    if (denyHit) return;
    const cfg = await getSadakaConfig();
    const noteForClassifier = (spend.notes ?? spend.description ?? "").trim();
    // Note: the brain itself also enforces the 8-char guard and threshold
    // gate (defence in depth — any future caller is safe).
    const result = await classifySpendForSadaka({
      spendId: spend.id,
      note: noteForClassifier,
      amountBase: spend.amount_base,
      confidenceThreshold: cfg.classifier_confidence_threshold,
    });
    if (result.is_sadaka_likely) {
      await insertSadakaLedgerRowResult({
        kind: "auto_detected",
        amount_base: -1 * Math.abs(spend.amount_base),
        source_kind: "spend",
        source_id: spend.id,
        reasoning: result.reasoning,
        tentative: true,
        event_at: spend.spent_at,
      });
    }
  } catch {
    // Best-effort. Spend stays logged; the reserve side stays at whatever
    // the last successful event left it.
  }
}
