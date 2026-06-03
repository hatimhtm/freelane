import { PageHeader } from "@/components/app/page-header";
import { getSettings } from "@/lib/data/queries";
import { Section } from "../_components/section";
import { IssuerForm } from "../_components/issuer-form";
import { AppearanceForm } from "../_components/appearance-form";

export const metadata = { title: "Profile · Settings" };

export default async function ProfileSettingsPage() {
  const { settings } = await getSettings();

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-10">
      <PageHeader
        title="Profile"
        description="Your identity inside Freelane — used to greet you on Today and to ground the AI."
      />

      <div className="mt-8 space-y-6">
        <Section
          title="Your profile"
          hint="Your name greets you on Today; used as context for the AI."
        >
          <IssuerForm settings={settings} />
        </Section>

        <Section
          title="Appearance"
          hint="Switch between dark and light."
        >
          <AppearanceForm settings={settings} />
        </Section>
      </div>
    </div>
  );
}
