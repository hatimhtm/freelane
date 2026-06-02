import Link from "next/link";
import { Bell, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { getSettings } from "@/lib/data/queries";
import type { CurrencyCode } from "@/lib/supabase/types";
import { IssuerForm } from "./_components/issuer-form";
import { MethodsForm } from "./_components/methods-form";
import { OpeningBalanceForm } from "./_components/opening-balance-form";
import { CurrenciesForm } from "./_components/currencies-form";
import { AppearanceForm } from "./_components/appearance-form";
import { DataForm } from "./_components/data-form";
import { SadakaConfigForm } from "./_components/sadaka-form";
import { getSadakaConfig } from "@/lib/sadaka/config";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { settings, rates, currencies, methods } = await getSettings();
  const sadakaConfig = await getSadakaConfig();

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
          <OpeningBalanceForm
            methods={methods}
            currencies={currencies}
            baseCurrency={(settings?.base_currency ?? "PHP") as CurrencyCode}
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

        <Section
          title="Notifications"
          hint="Retention, browser push, and per-kind controls — on its own page."
        >
          <Link
            href="/settings/notifications"
            className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 transition-colors hover:bg-foreground/[0.04]"
          >
            <div className="flex items-center gap-3 min-w-0">
              <Bell className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <div className="text-sm font-medium">Open notification settings</div>
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                  Retention, push, and per-kind toggles.
                </p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
        </Section>

        <Section
          title="Sadaka"
          hint="Voluntary-giving pool. Anchored at the 2.5% Islamic zakat base; the brain adjusts around it per income event."
        >
          <SadakaConfigForm initial={sadakaConfig} />
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
