"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { safeRunLabeled, type ActionResult } from "@/lib/data/actions";
import { getAuthUser } from "@/lib/auth";
import {
  insertSadakaLedgerRow,
  archiveSadakaLedgerRow,
  readPoolBalance,
} from "@/lib/sadaka/ledger";
import { insertLedger } from "@/lib/data/money-ledger";

// Server-action surface for the Sadaka tab.
//
// markSadakaGiven: writes a sadaka_ledger payment row (no source spend) AND
// a money_ledger sadaka_payment outflow on the picked wallet. This is the
// "stand-alone" giving path — distinct from the Spend modal toggle, which
// goes through createSpend and already has its parent outflow row covering
// the wallet debit.
//
// Failure handling: the two writes are not in a single DB transaction. If
// the money_ledger mirror fails after the sadaka row landed, we archive
// the sadaka row so the pool snaps back and the user sees the failure
// surface (toast). Reconciliation still catches drift if both writes
// land but on different intervals — this guard handles the common case
// where the user expects the toast to mean "nothing happened."

const POOL_OVERAGE_GRACE_BASE = 1; // tolerate ≤ 1 cent rounding drift

export async function markSadakaGiven(input: {
  amountBase: number;
  walletId: string;
  note?: string | null;
}): Promise<ActionResult<{ id: string }>> {
  return safeRunLabeled("freelane-sadaka", "markSadakaGiven", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const amount = Number(input.amountBase);
    if (!(amount > 0)) throw new Error("Amount must be greater than 0.");
    if (!input.walletId) throw new Error("Pick a wallet.");

    // Pool overage guard — block a marked payment greater than the display
    // pool. The rawBase math allows negative excursions for adjustment
    // surgery, but the user-facing CTA should refuse to ride into a
    // negative pool silently.
    const pool = await readPoolBalance();
    if (amount > pool.displayBase + POOL_OVERAGE_GRACE_BASE) {
      throw new Error(
        `You can't give more than your pool (${Math.round(pool.displayBase)}).`,
      );
    }

    const nowIso = new Date().toISOString();
    const sadakaRowId = await insertSadakaLedgerRow({
      kind: "payment",
      amount_base: -1 * Math.abs(amount),
      source_kind: "manual",
      source_id: null,
      reasoning: input.note ?? "Marked sadaka",
      event_at: nowIso,
      note: input.note ?? null,
    });
    if (!sadakaRowId) throw new Error("Couldn't write the sadaka payment row.");

    // Mirror onto money_ledger so the wallet snaps down. insertLedger logs
    // its own failure to money_ledger_write_failures but returns void; we
    // re-read the ledger row to confirm the mirror landed, and roll back
    // the sadaka row when it didn't.
    const supabase = await createClient();
    await insertLedger({
      client: supabase,
      kind: "sadaka_payment",
      amount_base: -1 * Math.abs(amount),
      wallet_id: input.walletId,
      related_kind: "sadaka",
      related_id: sadakaRowId,
      event_at: nowIso,
      note: "markSadakaGiven",
    });

    // Verify the mirror landed. A missing live row means the mirror
    // failed silently; archive the sadaka row so the surface state is
    // consistent and surface the error to the user.
    const { data: mirrorRow } = await supabase
      .from("money_ledger")
      .select("id")
      .eq("user_id", user.id)
      .eq("related_kind", "sadaka")
      .eq("related_id", sadakaRowId)
      .is("archived_at", null)
      .maybeSingle();
    if (!mirrorRow) {
      await archiveSadakaLedgerRow(sadakaRowId, "mirror failed");
      throw new Error(
        "Couldn't debit the wallet. The sadaka payment was rolled back.",
      );
    }

    revalidatePath("/sadaka");
    revalidatePath("/today");
    revalidatePath("/dashboard");
    return { id: sadakaRowId };
  });
}
