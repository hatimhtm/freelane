import { PageHeader } from "@/components/app/page-header";
import { getSettings } from "@/lib/data/queries";
import { loadChangelog } from "@/lib/changelog/load";
import { Section } from "../_components/section";
import { AdvancedForm } from "./_components/advanced-form";

export const metadata = { title: "Advanced · Settings" };

export default async function AdvancedSettingsPage() {
  const [{ settings, rates }, { currentVersion }] = await Promise.all([
    getSettings(),
    loadChangelog(),
  ]);
  const baseCurrency = settings?.base_currency ?? "PHP";
  // Freshest rate timestamp drives the "rates last refreshed" diagnostic.
  const latestRate = rates.reduce<string | null>((acc, r) => {
    const ts = r.updated_at ?? null;
    if (!ts) return acc;
    return !acc || ts > acc ? ts : acc;
  }, null);

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-10">
      <PageHeader
        title="Advanced"
        description="Power switches the everyday surface doesn't need to expose."
      />

      <div className="mt-8 space-y-6">
        <Section title="Tools" hint="One-tap maintenance you'd otherwise wait on.">
          <AdvancedForm />
        </Section>

        <Section title="Diagnostics" hint="What this build is running on right now.">
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Item label="Version" value={currentVersion} />
            <Item label="Build" value={process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local"} />
            <Item label="Base currency" value={baseCurrency} />
            <Item
              label="Rates last refreshed"
              value={latestRate ? new Date(latestRate).toLocaleString() : "never"}
            />
          </dl>
        </Section>
      </div>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card px-3 py-2.5">
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium tabular">{value}</dd>
    </div>
  );
}
