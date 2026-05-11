import { Plus, Receipt } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { getExpensesPage } from "@/lib/data/queries";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";
import type { CurrencyCode } from "@/lib/supabase/types";
import { ExpensesHub } from "./_components/expenses-hub";

export const metadata = { title: "Expenses" };

export default async function ExpensesPage() {
  const { expenses, currencies, settings } = await getExpensesPage();
  const baseCurrency = (settings?.base_currency ?? BASE_CURRENCY_FALLBACK) as CurrencyCode;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-10">
      <PageHeader
        title="Expenses"
        description="Every freelance coin — flowing the other way."
      />

      {expenses.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={Receipt}
            title="No expenses yet"
            description="Track tools, subscriptions, hardware, transit — anything you spend to earn. Your dashboard will subtract them from monthly income."
            action={
              <ExpensesHub
                expenses={[]}
                currencies={currencies}
                baseCurrency={baseCurrency}
                triggerLabel="Add expense"
                triggerIcon={<Plus className="mr-1.5 h-4 w-4" />}
              />
            }
          />
        </div>
      ) : (
        <div className="mt-6">
          <ExpensesHub
            expenses={expenses}
            currencies={currencies}
            baseCurrency={baseCurrency}
          />
        </div>
      )}
    </div>
  );
}
