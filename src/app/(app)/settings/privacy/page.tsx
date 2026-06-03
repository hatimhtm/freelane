import { PageHeader } from "@/components/app/page-header";
import { Section } from "../_components/section";
import { DataForm } from "../_components/data-form";

export const metadata = { title: "Privacy & Data · Settings" };

export default function PrivacySettingsPage() {
  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-10">
      <PageHeader
        title="Privacy & Data"
        description="Your data is yours. Download everything Freelane knows about you, or wipe the account."
      />

      <div className="mt-8 space-y-6">
        <Section
          title="Export"
          hint="Download a snapshot of everything. Freelane never emails or uploads anything on its own."
        >
          <DataForm />
        </Section>

        <Section
          title="Delete account"
          hint="Permanent — gone, not archived. Reach out from the email on the account; the Freelane operator confirms by hand before deleting."
        >
          <p className="text-sm text-muted-foreground">
            Account deletion is a manual operator-side action right now —
            email{" "}
            <a
              href="mailto:hello@freelane.app"
              className="font-medium text-foreground underline-offset-2 hover:underline"
            >
              hello@freelane.app
            </a>{" "}
            from the address tied to this account.
          </p>
        </Section>
      </div>
    </div>
  );
}
