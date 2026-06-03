import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getLetterById } from "@/lib/data/queries";
import { LetterDetail } from "../_components/letter-detail";

export const metadata = { title: "Letter" };

export default async function LetterDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const letter = await getLetterById(id);
  if (!letter) notFound();

  return (
    <div className="flex flex-col">
      <div className="mx-auto w-full max-w-[680px] px-4 pt-6">
        <Link
          href="/letters"
          className="inline-flex items-baseline gap-1 self-start text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Letters
        </Link>
      </div>
      <LetterDetail letter={letter} />
    </div>
  );
}
