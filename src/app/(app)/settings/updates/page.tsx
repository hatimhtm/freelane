import { Suspense } from "react";
import { PageHeader } from "@/components/app/page-header";
import { loadChangelog } from "@/lib/changelog/load";
import { getLastSeenVersion } from "@/lib/data/queries";
import { UpdatesSection } from "../_components/updates-section";

export const metadata = { title: "Updates · Settings" };

export default async function UpdatesSettingsPage() {
  const { entries, currentVersion } = await loadChangelog();
  const lastSeenVersion = await getLastSeenVersion().catch(() => null);

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-10">
      <PageHeader
        title="Updates"
        description="Every release that lands in Freelane — and what's coming next."
      />

      <div className="mt-8 space-y-6">
        <Section
          title="Changelog"
          hint="The latest entry expands automatically. Older releases stay collapsed."
        >
          {/* UpdatesSection reads useSearchParams() for ?expand=<version>.
              Wrapping in Suspense keeps the Next.js static-bailout
              contract explicit even though this route is dynamic. */}
          <Suspense fallback={null}>
            <UpdatesSection
              entries={entries}
              currentVersion={currentVersion}
              lastSeenVersion={lastSeenVersion}
            />
          </Suspense>
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border/60 bg-card p-6">
      <div className="mb-5">
        <h2 className="text-base font-semibold">{title}</h2>
        {hint && <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}
