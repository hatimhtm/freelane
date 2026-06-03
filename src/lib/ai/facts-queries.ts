import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import type { Fact, FactSubjectKind } from "./facts";

// Per-subject AI fact reader for the Settings → AI viewer. Groups live
// facts (archived_at IS NULL) by (subject_kind, subject_id) and resolves
// the subject label so the UI can render "Client · Acme" instead of a
// raw UUID.

export type FactSubjectGroup = {
  subjectKind: FactSubjectKind;
  subjectId: string | null;
  subjectLabel: string;
  facts: Fact[];
};

// Names by table — pulled in a single round-trip per kind to avoid N+1s.
// Column names track the real schema:
//   clients.name, vendors.canonical_name, projects.title,
//   planned_spends.label, entities.canonical_name.
// Earlier versions of this resolver guessed at `display_name` / `name`
// and runtime-errored against PostgREST the moment Settings → AI tried
// to render a vendor/entity/plan/project fact. Keep this in sync with
// any future column renames.
async function resolveLabels(
  kinds: { kind: FactSubjectKind; ids: string[] }[],
): Promise<Map<string, string>> {
  const labelMap = new Map<string, string>();
  if (kinds.length === 0) return labelMap;
  const supabase = await createClient();

  for (const { kind, ids } of kinds) {
    if (ids.length === 0) continue;
    if (kind === "client") {
      const { data } = await supabase
        .from("clients")
        .select("id,name")
        .in("id", ids);
      for (const row of (data ?? []) as { id: string; name: string }[]) {
        labelMap.set(`${kind}::${row.id}`, row.name);
      }
    } else if (kind === "vendor") {
      const { data } = await supabase
        .from("vendors")
        .select("id,canonical_name,raw_user_typed_name")
        .in("id", ids);
      for (const row of (data ?? []) as {
        id: string;
        canonical_name: string | null;
        raw_user_typed_name: string | null;
      }[]) {
        labelMap.set(
          `${kind}::${row.id}`,
          row.canonical_name ?? row.raw_user_typed_name ?? "Vendor",
        );
      }
    } else if (kind === "project") {
      const { data } = await supabase
        .from("projects")
        .select("id,title")
        .in("id", ids);
      for (const row of (data ?? []) as { id: string; title: string }[]) {
        labelMap.set(`${kind}::${row.id}`, row.title);
      }
    } else if (kind === "plan") {
      const { data } = await supabase
        .from("planned_spends")
        .select("id,label")
        .in("id", ids);
      for (const row of (data ?? []) as { id: string; label: string }[]) {
        labelMap.set(`${kind}::${row.id}`, row.label);
      }
    } else if (kind === "entity") {
      const { data } = await supabase
        .from("entities")
        .select("id,canonical_name,raw_user_typed_name")
        .in("id", ids);
      for (const row of (data ?? []) as {
        id: string;
        canonical_name: string | null;
        raw_user_typed_name: string | null;
      }[]) {
        labelMap.set(
          `${kind}::${row.id}`,
          row.canonical_name ?? row.raw_user_typed_name ?? "Person",
        );
      }
    }
  }

  return labelMap;
}

const KIND_FALLBACK_LABEL: Record<FactSubjectKind, string> = {
  user: "",
  client: "Client",
  vendor: "Vendor",
  project: "Project",
  plan: "Plan",
  entity: "Person",
};

// Natural reading order: the user's own identity ("About you") first,
// then clients (the working relationship), then people / vendors /
// projects / plans. Mirrors the design memory's hierarchy.
const KIND_PRIORITY: Record<FactSubjectKind, number> = {
  user: 0,
  client: 1,
  entity: 2,
  vendor: 3,
  project: 4,
  plan: 5,
};

export async function getAllFactsGrouped(): Promise<FactSubjectGroup[]> {
  const user = await getAuthUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_user_facts")
    .select("*")
    .eq("user_id", user.id)
    .is("archived_at", null)
    .order("subject_kind")
    .order("subject_id")
    .order("confidence", { ascending: false });
  const rows = ((data ?? []) as unknown) as Fact[];
  if (rows.length === 0) return [];

  // Collect subject IDs by kind so the label resolver can do one read per
  // table instead of one per row.
  const idsByKind = new Map<FactSubjectKind, Set<string>>();
  for (const r of rows) {
    if (r.subject_kind === "user" || !r.subject_id) continue;
    if (!idsByKind.has(r.subject_kind))
      idsByKind.set(r.subject_kind, new Set());
    idsByKind.get(r.subject_kind)!.add(r.subject_id);
  }
  const labels = await resolveLabels(
    Array.from(idsByKind.entries()).map(([kind, set]) => ({
      kind,
      ids: Array.from(set),
    })),
  );

  // Bucket into groups keyed by (kind, subject_id).
  const groupKey = (r: Fact) => `${r.subject_kind}::${r.subject_id ?? ""}`;
  const groups = new Map<string, FactSubjectGroup>();
  for (const r of rows) {
    const key = groupKey(r);
    if (!groups.has(key)) {
      // For user-scope, the kind chip already reads "About you" — leaving
      // the subject label empty avoids the "ABOUT YOU · You" double-tag.
      const label =
        r.subject_kind === "user"
          ? ""
          : (r.subject_id && labels.get(`${r.subject_kind}::${r.subject_id}`)) ||
            KIND_FALLBACK_LABEL[r.subject_kind];
      groups.set(key, {
        subjectKind: r.subject_kind,
        subjectId: r.subject_id,
        subjectLabel: label,
        facts: [],
      });
    }
    groups.get(key)!.facts.push(r);
  }

  return Array.from(groups.values()).sort((a, b) => {
    const pa = KIND_PRIORITY[a.subjectKind] ?? 99;
    const pb = KIND_PRIORITY[b.subjectKind] ?? 99;
    if (pa !== pb) return pa - pb;
    const byLabel = a.subjectLabel.localeCompare(b.subjectLabel);
    if (byLabel !== 0) return byLabel;
    // Stable tie-break on subjectId so ordering doesn't flip across runs
    // when two groups share an empty label (multiple user-scope groups,
    // or unresolved subjects whose labels both fell back to "").
    return (a.subjectId ?? "").localeCompare(b.subjectId ?? "");
  });
}
