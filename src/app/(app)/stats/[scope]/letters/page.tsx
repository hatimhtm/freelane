import { PageHeader } from "@/components/app/page-header";

export const metadata = { title: "Stats · Letters" };

export default async function StatsLettersPage({
  params,
}: {
  params: Promise<{ scope: string }>;
}) {
  const { scope } = await params;
  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-8 lg:px-10 lg:py-12">
      <PageHeader title="Letters for this scope" description={`Scope: ${scope}`} />
      <div className="mt-8 rounded-[14px] border border-foreground/10 bg-card/40 p-5">
        <div className="display-eyebrow text-muted-foreground">Letters</div>
        <p className="mt-2 text-[13px] text-foreground/85">
          Stats workflow ships next.
        </p>
        <p className="mt-1.5 text-[12px] text-muted-foreground">
          Per-scope editorial letters (the ones the editorial brains write
          about this entity) will land here.
        </p>
      </div>
    </div>
  );
}
