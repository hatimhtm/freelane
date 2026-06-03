import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { postNotification } from "@/lib/notifications/dispatcher";

// Entities workflow — NEW ELEMENT TRIGGERS (introductions).
//
// After an entity exists, four signals fire entity_introduction
// notifications asking for context:
//   1. First-ever monetary event (first transfer, sadaka_payment,
//      beneficiary_spend, gift) → fireFirstMonetaryEvent.
//      WIRED FROM: createSpend beneficiary branch + updateSpend
//      beneficiary transition + sadaka_payment auto-detect.
//   2. First note about entity → fireFirstNote.
//      WIRED FROM: updateEntity when notes transition empty -> set.
//   3. First mention in chatbot → captured INLINE in the chatbot, no
//      separate notification (the chatbot owns the prompt). The
//      chat-context-registry's IDENTIFY_ENTITY intent runs through
//      acceptEntityDiscovery, then the reply handler should call
//      noteFirstChatMention to advance introduction_status. Plumbing
//      the intent handler is part of the chatbot workflow — when an
//      IDENTIFY_ENTITY reply lands, call this helper to mark the
//      mention silent (no second notification).
//   4. First appearance in any LifeOS surface → covered by Gate 1
//      (entity_discovery_request). This is the verifier's "design
//      choice" trigger — Gate 1 is the only path that fires when the
//      AI sees a name without any other signal.
//
// Each trigger fires AT MOST ONCE per (entity_id, trigger_kind). The
// idempotency guard is the introduction_status field on entities (set
// to 'asked' once any trigger has fired) PLUS the per-trigger fact key
// (`introduction_asked_${trigger_kind}`) on ai_user_facts so a future
// trigger of the same kind can short-circuit even if the user dismissed
// the notification.

type TriggerKind =
  | "first_monetary_event"
  | "first_note"
  | "first_chat_mention";

async function alreadyAsked(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  entityId: string,
  triggerKind: TriggerKind,
): Promise<boolean> {
  // Verifier fix: idempotency is per (entity, trigger_kind). The prior
  // any-trigger sticky short-circuit meant that once trigger 1
  // (first_monetary_event) fired, trigger 2 (first_note) could NEVER
  // fire for the same entity. The brief explicitly asked for
  // per-(entity, trigger_kind) idempotency so each new dimension of
  // context gets its own prompt.
  //
  // Two-line guard:
  //   1. The fast path — ai_user_facts row tagged with the SPECIFIC
  //      trigger key. Includes archived rows so a user who clears the
  //      fact from the per-subject AI facts viewer doesn't re-arm the
  //      trigger.
  //   2. The terminal-status fallback — entity row's introduction_status
  //      'introduced' or 'silenced' both suppress all triggers (the
  //      user has either fully answered or explicitly muted future
  //      prompts for this entity).
  const key = `introduction_asked_${triggerKind}`;
  const { data: fact } = await supabase
    .from("ai_user_facts")
    .select("id")
    .eq("user_id", userId)
    .eq("subject_kind", "entity")
    .eq("subject_id", entityId)
    .eq("key", key)
    .maybeSingle();
  if (fact) return true;

  const { data: entity } = await supabase
    .from("entities")
    .select("introduction_status")
    .eq("user_id", userId)
    .eq("id", entityId)
    .maybeSingle();
  const status = (entity?.introduction_status as string | null) ?? "pending";
  return status === "introduced" || status === "silenced";
}

async function markAsked(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  entityId: string,
  triggerKind: TriggerKind,
): Promise<void> {
  const key = `introduction_asked_${triggerKind}`;
  await supabase.from("ai_user_facts").upsert(
    {
      user_id: userId,
      subject_kind: "entity",
      subject_id: entityId,
      key,
      value: { asked_at: new Date().toISOString() } as Record<string, unknown>,
      confidence: 1.0,
      source: "inferred",
      evidence: `Introduction trigger fired: ${triggerKind}`,
      archived_at: null,
    },
    { onConflict: "user_id,subject_kind,subject_id,key" },
  );
  // Move the entity row from pending → asked (only when still pending —
  // do NOT downgrade introduced/silenced rows).
  await supabase
    .from("entities")
    .update({ introduction_status: "asked" })
    .eq("user_id", userId)
    .eq("id", entityId)
    .eq("introduction_status", "pending");
}

async function entityNameLookup(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  entityId: string,
): Promise<string> {
  const { data } = await supabase
    .from("entities")
    .select("canonical_name")
    .eq("user_id", userId)
    .eq("id", entityId)
    .maybeSingle();
  return (data?.canonical_name as string) ?? "this person";
}

// ─────────────────────────── Trigger 1 ──

export async function fireFirstMonetaryEvent(args: {
  entityId: string;
  eventKind: string; // e.g. "beneficiary_spend", "sadaka_payment", "transfer"
  amountBase?: number | null;
}): Promise<void> {
  try {
    const user = await getAuthUser();
    if (!user) return;
    const supabase = await createClient();
    if (await alreadyAsked(supabase, user.id, args.entityId, "first_monetary_event")) {
      return;
    }
    const entityName = await entityNameLookup(supabase, user.id, args.entityId);
    const amountFragment =
      args.amountBase && args.amountBase > 0
        ? ` (₱${Math.round(args.amountBase)})`
        : "";
    await postNotification({
      kind: "entity_introduction",
      subject: `Tell me about ${entityName}`,
      body: `First ${args.eventKind.replace(
        "_",
        " ",
      )}${amountFragment} with ${entityName}. Anything I should remember about them?`,
      linkUrl: `/clients/people/${args.entityId}`,
      dedupKey: `entity_introduction:${args.entityId}:first_monetary_event`,
      priority: 0,
      payload: {
        freeText: true,
        placeholder: `What should I know about ${entityName}?`,
        kind_specific: {
          entity_id: args.entityId,
          trigger_kind: "first_monetary_event",
          event_kind: args.eventKind,
        },
      },
    });
    await markAsked(supabase, user.id, args.entityId, "first_monetary_event");
  } catch {
    // Best-effort — never throws.
  }
}

// ─────────────────────────── Trigger 2 ──

export async function fireFirstNote(args: {
  entityId: string;
  noteExcerpt: string;
}): Promise<void> {
  try {
    const user = await getAuthUser();
    if (!user) return;
    const supabase = await createClient();
    if (await alreadyAsked(supabase, user.id, args.entityId, "first_note")) {
      return;
    }
    const entityName = await entityNameLookup(supabase, user.id, args.entityId);
    await postNotification({
      kind: "entity_introduction",
      subject: `Tell me more about ${entityName}`,
      body: `You wrote a note about ${entityName} — happy to read more if you'd like to elaborate.`,
      linkUrl: `/clients/people/${args.entityId}`,
      dedupKey: `entity_introduction:${args.entityId}:first_note`,
      priority: 0,
      payload: {
        freeText: true,
        placeholder: `More about ${entityName}…`,
        kind_specific: {
          entity_id: args.entityId,
          trigger_kind: "first_note",
          note_excerpt: args.noteExcerpt.slice(0, 200),
        },
      },
    });
    await markAsked(supabase, user.id, args.entityId, "first_note");
  } catch {
    // Best-effort — never throws.
  }
}

// ─────────────────────────── Trigger 3 (chatbot) ──

// Trigger 3 — first chatbot mention. The chat surface itself asks the
// question inline ("Tell me about Junjun?") so no separate notification
// fires. Call this helper after the chatbot has posted its inline
// follow-up so the introduction_status advances + future fire calls
// short-circuit.
export async function noteFirstChatMention(
  entityId: string,
): Promise<void> {
  try {
    const user = await getAuthUser();
    if (!user) return;
    const supabase = await createClient();
    if (await alreadyAsked(supabase, user.id, entityId, "first_chat_mention")) {
      return;
    }
    await markAsked(supabase, user.id, entityId, "first_chat_mention");
  } catch {
    // Best-effort — never throws.
  }
}
