import { PageHeader } from "@/components/app/page-header";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { getSettings } from "@/lib/data/queries";
import type {
  CurrencyCode,
  PaymentMethod,
  RecurringSpend,
} from "@/lib/supabase/types";
import { Section } from "../_components/section";
import { CyclesForm } from "./_components/cycles-form";

export const metadata = { title: "Cycles · Settings" };

// Cycles — the recurring-spend list at a clean settings address. The CRUD
// dialog reuses the existing createRecurringSpend / updateRecurringSpend /
// deleteRecurringSpend server actions from lib/data/actions.ts so this page
// is pure surfacing, not a new feature.

export default async function CyclesSettingsPage() {
  const user = await getAuthUser();
  const { methods, currencies, settings } = await getSettings();
  const baseCurrency = (settings?.base_currency ?? "PHP") as CurrencyCode;

  let recurring: RecurringSpend[] = [];
  if (user) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("recurring_spends")
      .select("*")
      .eq("user_id", user.id)
      .order("label");
    recurring = (data ?? []) as unknown as RecurringSpend[];
  }

  const wallets: PaymentMethod[] = methods.filter((m) => !m.archived);

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-10">
      <PageHeader
        title="Cycles"
        description="Subscriptions, bills, and other rhythmic spends Freelane should expect each month."
      />

      <div className="mt-8 space-y-6">
        <Section
          title="Recurring spends"
          hint="The rules. Each rule's window opens before the expected date and closes after — Today nudges you inside that window."
        >
          <CyclesForm
            rules={recurring}
            wallets={wallets}
            currencies={currencies}
            baseCurrency={baseCurrency}
          />
        </Section>
      </div>
    </div>
  );
}
