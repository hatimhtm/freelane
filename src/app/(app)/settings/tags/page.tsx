import { PageHeader } from "@/components/app/page-header";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import type { SpendCategory } from "@/lib/supabase/types";
import { Section } from "../_components/section";
import { TagsForm } from "./_components/tags-form";

export const metadata = { title: "Tags · Settings" };

export default async function TagsSettingsPage() {
  const user = await getAuthUser();
  let categories: SpendCategory[] = [];
  if (user) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("spend_categories")
      .select("*")
      .eq("user_id", user.id)
      .order("tag_kind")
      .order("sort_order")
      .order("name");
    categories = ((data ?? []) as unknown) as SpendCategory[];
  }

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-10">
      <PageHeader
        title="Tags"
        description="Audience, categories, and custom tags the AI uses to make sense of every spend."
      />

      <div className="mt-8 space-y-6">
        <Section
          title="Your tags"
          hint="Audience tags (You · Wife · Family · Others) are pinned seeds. Everything else you can rename or archive."
        >
          <TagsForm categories={categories} />
        </Section>
      </div>
    </div>
  );
}
