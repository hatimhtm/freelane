import { PageHeader } from "@/components/app/page-header";
import { getSettings } from "@/lib/data/queries";
import { IssuerForm } from "./_components/issuer-form";
import { MethodsForm } from "./_components/methods-form";
import { OpeningBalanceForm } from "./_components/opening-balance-form";
import { CurrenciesForm } from "./_components/currencies-form";
import { AppearanceForm } from "./_components/appearance-form";
import { DataForm } from "./_components/data-form";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { settings, rates, currencies, methods } = await getSettings();

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-10">
      <PageHeader
        title="Settings"
        description="Your issuer profile, invoice defaults, and exchange rates."
      />

      <div className="mt-8 space-y-6">
        <Section title="Your profile" hint="Your name greets you on Today; used as context for the AI.">
          <IssuerForm settings={settings} />
        </Section>

        <Section
          title="Payment methods"
          hint="The rails money reaches you through. Add a monthly fee where one applies — it's subtracted from each month's landed total."
        >
          <MethodsForm methods={methods} currencies={currencies} baseCurrency={settings?.base_currency ?? "PHP"} />
        </Section>

        <Section
          title="Wallet balances"
          hint="Set what is actually in each holding wallet today. Freelane starts counting from there."
        >
          <OpeningBalanceForm methods={methods} currencies={currencies} />
        </Section>

        <Section
          id="rates"
          title="Currencies & exchange rates"
          hint="Freelane values unpaid balances at these rates. Pull live mid-market rates, or set them by hand."
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
