import { PageHeader } from "@/components/app/page-header";

export const metadata = { title: "Stats · Money" };

// Placeholder for the Stats workflow. The dynamic [scope] segment will
// later resolve to a real entity (me, client-<id>, year-<n>) and feed
// per-scope money stats into this surface.
export default async function StatsMoneyPage({
  params,
}: {
  params: Promise<{ scope: string }>;
}) {
  const { scope } = await params;
  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-8 lg:px-10 lg:py-12">
      <PageHeader title="Money stats" description={`Scope: ${scope}`} />
      <div className="mt-8 rounded-[14px] border border-foreground/10 bg-card/40 p-5">
        <div className="display-eyebrow text-muted-foreground">Money</div>
        <p className="mt-2 text-[13px] text-foreground/85">
          Stats workflow ships next.
        </p>
        <p className="mt-1.5 text-[12px] text-muted-foreground">
          Per-scope income, fee, and spending stats will fill in here.
        </p>
      </div>
    </div>
  );
}
