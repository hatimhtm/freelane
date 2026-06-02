"use server";

// Client-callable Server Actions for the Spending tag system. Lives in a
// dedicated *-actions.ts file per Next.js 16 use-server hygiene: a "use
// server" module may export ONLY async functions, so this can't sit next
// to the shared SpendCategoryInput type / safeRun wrapper / object
// re-exports in src/lib/data/actions.ts.
//
// All three exports here are thin trampolines that defer to the core
// implementation in src/lib/data/actions.ts (which IS itself "use
// server" but also exports non-async type aliases, which violates Next 16
// strict mode in client-import contexts). The wrappers shape the input
// the spend-modal's "+ New tag" affordance + the filter dropdown send.

import {
  createSpendCategory,
  type ActionResult,
} from "@/lib/data/actions";

// "+ New tag" — adds a user-created custom tag visible in the filter
// dropdown's Custom section. Pinned=false + tag_kind="custom" +
// created_by_user=true (rejected by RLS-side defaults on duplicate
// (user_id, name) collision via the unique constraint).
export async function createCustomTagAction(
  name: string,
): Promise<ActionResult<{ id: string }>> {
  return createSpendCategory({
    name: name.trim(),
    tagKind: "custom",
    createdByUser: true,
  });
}
