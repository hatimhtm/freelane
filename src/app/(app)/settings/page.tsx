import { PageHeader } from "@/components/app/page-header";
import { getSettings } from "@/lib/data/queries";
import { IssuerForm } from "./_components/issuer-form";
import { InvoiceDefaultsForm } from "./_components/invoice-defaults-form";
import { CurrenciesForm } from "./_components/currencies-form";
import { AppearanceForm } from "./_components/appearance-form";
import { DataForm } from "./_components/data-form";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { settings, rates, currencies } = await getSettings();

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-10">
      <PageHeader
        title="Settings"
        description="Your issuer profile, invoice defaults, and exchange rates."
      />

      <div className="mt-8 space-y-6">
        <Section title="Issuer profile" hint="Appears on every invoice you send.">
          <IssuerForm settings={settings} />
        </Section>

        <Section title="Invoice defaults" hint="Numbering, footer, and the TVA note.">
          <InvoiceDefaultsForm settings={settings} />
        </Section>

        <Section
          id="rates"
          title="Currencies & exchange rates"
          hint="Freelane converts every amount to your base currency using these rates. You set them manually."
        >
          <CurrenciesForm
            settings={settings}
            rates={rates}
            currencies={currencies}
          />
        </Section>

        <Section title="Appearance" hint="Switch between dark and light.">
          <AppearanceForm settings={settings} />
        </Section>

        <Section
          title="Data"
          hint="Download a snapshot of everything. Freelane never emails or uploads anything on its own."
        >
          <DataForm />
        </Section>
      </div>
    </div>
  );
}

function Section({
  id,
  title,
  hint,
  children,
}: {
  id?: string;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="rounded-2xl border border-border/60 bg-card p-6">
      <div className="mb-5">
        <h2 className="text-base font-semibold">{title}</h2>
        {hint && <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}
