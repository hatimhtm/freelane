import { Suspense } from "react";
import { PageHeader } from "@/components/app/page-header";
import { loadChangelog } from "@/lib/changelog/load";
import { getLastSeenVersion } from "@/lib/data/queries";
import { Section } from "../_components/section";
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

