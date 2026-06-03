import { PageHeader } from "@/components/app/page-header";
import { getAllFactsGrouped } from "@/lib/ai/facts-queries";
import { Section } from "../_components/section";
import { AiFactsViewer } from "./_components/ai-facts-viewer";

export const metadata = { title: "AI · Settings" };

export default async function AiSettingsPage() {
  const groups = await getAllFactsGrouped();

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-10">
      <PageHeader
        title="AI"
        description="Everything Freelane has noticed about you, your clients, your vendors, and the people in your life — grouped by subject. Edit or forget any fact."
      />

      <div className="mt-8 space-y-6">
        <Section
          title="Memory"
          hint="Facts are soft-deleted by design — the row stays for audit, but the brain stops reading it after you forget it."
        >
          <AiFactsViewer groups={groups} />
        </Section>
      </div>
    </div>
  );
}
