import { PageHeader } from "@/components/app/page-header";
import { Section } from "../_components/section";
import { AdvancedForm } from "./_components/advanced-form";

export const metadata = { title: "Advanced · Settings" };

export default function AdvancedSettingsPage() {
  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-10">
      <PageHeader
        title="Advanced"
        description="Power switches the everyday surface doesn't need to expose."
      />

      <div className="mt-8 space-y-6">
        <Section title="Toggles" hint="Things that aren't ready for the front door yet.">
          <AdvancedForm />
        </Section>
      </div>
    </div>
  );
}
