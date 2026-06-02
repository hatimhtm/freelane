import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";

// Server-only readers + canonical types for the AI fact store.
//
// Why a sibling module: Next.js 16 enforces "use server" files export ONLY
// async functions. Types, constants, and pure helpers live HERE; the
// matching `facts-actions.ts` keeps the write surface (server actions) and
// imports the type/helper exports from this file.
//
// The Chatbot + Sadaka workflows had to be patched for this exact rule —
// don't re-introduce the regression.

export type FactSubjectKind =
  | "user"
  | "client"
  | "vendor"
  | "project"
  | "plan"
  | "entity";

export type FactSource = "user_answered" | "inferred" | "seeded";

export type Fact = {
  id: string;
  user_id: string;
  subject_kind: FactSubjectKind;
  subject_id: string | null;
  key: string;
  value: Record<string, unknown>;
  confidence: number;
  source: FactSource;
  evidence: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

// Stable key for the (subject_kind, subject_id, key) tuple — mirror of the
// helper inside pick-next-question.ts. Lives here so call sites that
// dedupe / map / compare facts across brains stay consistent.
export function factScopeKey(
  subjectKind: string,
  subjectId: string | null | undefined,
  key: string,
): string {
  return `${subjectKind}::${subjectId ?? ""}::${key}`;
}

// Live facts only — archived rows stay in the table for audit, but readers
// never see them. Brains pull from this so a "deleted" fact disappears
// from the brain's view of the user.
export async function getFactsForSubject(
  subjectKind: FactSubjectKind,
  subjectId: string | null,
): Promise<Fact[]> {
  const user = await getAuthUser();
  if (!user) return [];
  const supabase = await createClient();
  let q = supabase
    .from("ai_user_facts")
    .select("*")
    .eq("user_id", user.id)
    .eq("subject_kind", subjectKind)
    .is("archived_at", null)
    .order("confidence", { ascending: false });
  q = subjectId ? q.eq("subject_id", subjectId) : q.is("subject_id", null);
  const { data } = await q;
  return ((data ?? []) as unknown) as Fact[];
}

// Lightweight projection for the extraction brain — only the fields the
// model needs to decide which facts to keep / replace / add. Avoids leaking
// internal id + audit columns into the prompt.
export type FactProjection = {
  key: string;
  value: Record<string, unknown>;
  confidence: number;
};

export function projectFacts(facts: Fact[]): FactProjection[] {
  return facts.map((f) => ({
    key: f.key,
    value: f.value,
    confidence: Number(f.confidence ?? 0),
  }));
}
