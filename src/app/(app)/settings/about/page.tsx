import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { loadChangelog } from "@/lib/changelog/load";
import { Section } from "../_components/section";

export const metadata = { title: "About · Settings" };

// Static about card. Pulls version from the loaded CHANGELOG.md (the
// canonical version source since migration 0104). Links are intentionally
// minimal — anything substantial lives elsewhere (Updates for the
// changelog, the repo for the source).

export default async function AboutSettingsPage() {
  const { currentVersion } = await loadChangelog();

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-10">
      <PageHeader title="About" description="Version, links, and where the source lives." />

      <div className="mt-8 space-y-6">
        <Section title="Freelane" hint="The financial nervous system for unstable freelance income.">
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Item label="Version" value={currentVersion} />
            <Item label="Build" value={process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local"} />
            <Item label="Region" value="PHT · Asia/Manila" />
          </dl>
        </Section>

        <Section title="Links">
          <div className="space-y-1.5">
            <LinkRow label="Changelog" href="/settings/updates" />
            <LinkRow label="Privacy policy" href="/privacy" />
            <LinkRow label="Terms of service" href="/terms" />
          </div>
        </Section>
      </div>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card px-3 py-2.5">
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-medium tabular">{value}</dd>
    </div>
  );
}

function LinkRow({ label, href }: { label: string; href: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm transition-colors hover:bg-foreground/[0.04]"
    >
      <span>{label}</span>
      <span className="text-[11px] text-muted-foreground">{href}</span>
    </Link>
  );
}
