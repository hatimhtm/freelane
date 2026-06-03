import { PageHeader } from "@/components/app/page-header";
import { getSettings } from "@/lib/data/queries";
import type { CurrencyCode } from "@/lib/supabase/types";
import { Section } from "../_components/section";
import { MethodsForm } from "../_components/methods-form";
import { OpeningBalanceForm } from "../_components/opening-balance-form";
import { CurrenciesForm } from "../_components/currencies-form";

export const metadata = { title: "Wallets · Settings" };

export default async function WalletsSettingsPage() {
  const { settings, rates, currencies, methods } = await getSettings();
  const baseCurrency = (settings?.base_currency ?? "PHP") as CurrencyCode;

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-10">
      <PageHeader
        title="Wallets"
        description="The rails money reaches you through, the balances Freelane starts counting from, and the rates it values them at."
      />

      <div className="mt-8 space-y-6">
        <Section
          title="Payment methods"
          hint="The rails money reaches you through. Add a monthly fee where one applies — it's subtracted from each month's landed total. Brand picker has a Custom tile for wallets that don't match a curated brand."
        >
          <MethodsForm
            methods={methods}
            currencies={currencies}
            baseCurrency={baseCurrency}
          />
        </Section>

        <Section
          title="Wallet balances"
          hint="Set what is actually in each holding wallet today. Freelane starts counting from there."
        >
          <OpeningBalanceForm
            methods={methods}
            currencies={currencies}
            baseCurrency={baseCurrency}
          />
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
      </div>
    </div>
  );
}
