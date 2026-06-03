"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { safeRunLabeled, type ActionResult } from "@/lib/data/actions";
import { createPersonalLoan } from "./actions";

// Freelane Loans — accept/reject for the loan_proposal notification.
//
// acceptLoanProposal: reads payload.kind_specific.proposed_loan from the
// inbox row and forwards to createPersonalLoan. On success marks the
// notification read.
//
// rejectLoanProposal: stamps spends.non_loan=true on the source spend so
// the brain doesn't re-propose the same row in the next sweep, then
// marks the notification read.

type ProposedLoanPayload = {
  direction: "given" | "received";
  counterparty_entity_id: string;
  origin_wallet_id?: string | null;
  principal_base: number;
  source_kind?: "spend" | string;
  source_id?: string | null;
};

async function readProposedLoan(
  notificationId: string,
): Promise<{ payload: ProposedLoanPayload; userId: string } | null> {
  const user = await getAuthUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("notifications_inbox")
    .select("id, kind, payload")
    .eq("id", notificationId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!row) return null;
  const payload = (row.payload ?? {}) as {
    kind_specific?: { proposed_loan?: ProposedLoanPayload };
  };
  const proposed = payload.kind_specific?.proposed_loan;
  if (!proposed) return null;
  return { payload: proposed, userId: user.id };
}

async function markNotificationRead(notificationId: string): Promise<void> {
  const user = await getAuthUser();
  if (!user) return;
  const supabase = await createClient();
  await supabase
    .from("notifications_inbox")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("user_id", user.id);
}

export async function acceptLoanProposal(
  notificationId: string,
): Promise<ActionResult<{ loan_id: string }>> {
  return safeRunLabeled("freelane-loans", "acceptLoanProposal", async () => {
    const proposed = await readProposedLoan(notificationId);
    if (!proposed) {
      throw new Error("Couldn't read the loan proposal payload.");
    }
    const p = proposed.payload;
    if (!p.origin_wallet_id) {
      throw new Error("Proposal is missing the origin wallet.");
    }
    const res = await createPersonalLoan({
      direction: p.direction,
      counterparty_entity_id: p.counterparty_entity_id,
      origin_wallet_id: p.origin_wallet_id,
      principal_base: p.principal_base,
      source_spend_id: p.source_kind === "spend" ? p.source_id ?? null : null,
      is_for_someone_else: true,
    });
    if (!res.ok) throw new Error(res.error);
    await markNotificationRead(notificationId);
    revalidatePath("/notifications");
    revalidatePath("/spending");
    return { loan_id: res.data.id };
  });
}

export async function rejectLoanProposal(
  notificationId: string,
): Promise<ActionResult<{ stamped_spend_id: string | null }>> {
  return safeRunLabeled("freelane-loans", "rejectLoanProposal", async () => {
    const proposed = await readProposedLoan(notificationId);
    if (!proposed) {
      // Even if we can't read the payload, still mark the notification
      // read so it doesn't linger.
      await markNotificationRead(notificationId);
      return { stamped_spend_id: null };
    }
    const p = proposed.payload;
    let stampedSpendId: string | null = null;
    if (p.source_kind === "spend" && p.source_id) {
      const supabase = await createClient();
      const { error } = await supabase
        .from("spends")
        .update({ non_loan: true })
        .eq("id", p.source_id)
        .eq("user_id", proposed.userId);
      if (!error) stampedSpendId = p.source_id;
    }
    await markNotificationRead(notificationId);
    revalidatePath("/notifications");
    return { stamped_spend_id: stampedSpendId };
  });
}
