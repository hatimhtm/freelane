import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { EventKind } from "@/lib/supabase/types";

// Fire-and-forget event logger. Called from mutations in actions.ts to build
// the app-wide activity feed + per-client timeline. Failures don't block the
// mutation that triggered them.
export async function logEvent(args: {
  userId: string;
  kind: EventKind;
  title: string;
  entityType?: string;
  entityId?: string;
  clientId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  try {
    const supabase = await createClient();
    await supabase.from("events").insert({
      user_id: args.userId,
      kind: args.kind,
      title: args.title,
      entity_type: args.entityType ?? null,
      entity_id: args.entityId ?? null,
      client_id: args.clientId ?? null,
      metadata: args.metadata ?? {},
    });
  } catch {
    // Swallow — the events table may not exist yet (migration not run).
  }
}
