"use client";

import Link from "next/link";
import { Mail } from "lucide-react";
import { useNotificationModal } from "@/components/app/notification-modal-host";
import { LetterReader } from "@/components/letters/letter-reader";
import { AiDot } from "@/components/widgets/ai-dot";
import { phtDateString } from "@/lib/utils";
import type { EditorialLetter, EditorialLetterKind } from "@/lib/supabase/types";

// Recent Letters widget — M-widget styling. Renders up to 3 letters in
// scope (title + date + theme). Whole-row click opens the letter-reader
// modal via the notification modal host. AiDot scopes the chatbot to the
// letter set so "Talk about these letters" lands with relevantData.
//
// Relevance-gated upstream: stats/[scope]/letters/page.tsx returns null
// when the scope has zero letters; stats/[scope]/money/page.tsx hides
// the section when recentLetters.length === 0. This widget is never
// rendered with an empty letter list.

// Thread the stats scope into the archive deep link so the user lands on
// the same narrowed slice they were viewing. /me is the user-wide archive
// (no filter); /year-YYYY narrows by ?year=YYYY; /client-<id> by ?client.
function seeAllHrefForScope(scope: string): string {
  if (scope === "me") return "/letters";
  if (scope.startsWith("year-")) {
    const y = scope.slice("year-".length);
    return `/letters?year=${encodeURIComponent(y)}`;
  }
  if (scope.startsWith("client-")) {
    const id = scope.slice("client-".length);
    return `/letters?client=${encodeURIComponent(id)}`;
  }
  return "/letters";
}

const KIND_LABEL: Record<EditorialLetterKind, string> = {
  end_of_month: "End of month",
  spotlight: "Spotlight",
  sunday: "Sunday",
  year: "Year",
  anniversary: "Anniversary",
  regret_mark: "Two-month mark",
};

export type RecentLettersWidgetProps = {
  letters: EditorialLetter[];
  scope: string;
};

export function RecentLettersWidget({
  letters,
  scope,
}: RecentLettersWidgetProps) {
  const { openModal } = useNotificationModal();
  const top = letters.slice(0, 3);
  const cardKey = `stats.${scope}.letters`;
  return (
    <div className="group relative flex min-h-[160px] w-full flex-col rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-start gap-2">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-foreground/[0.04] text-foreground/70">
          <Mail className="h-4 w-4" />
        </div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Recent letters
        </div>
      </div>
      <ul className="mt-3 flex flex-1 flex-col divide-y divide-border/40">
        {top.map((l) => (
          <li key={l.id}>
            <button
              type="button"
              onClick={() =>
                openModal(<LetterReader letterId={l.id} />, {
                  title: l.headline,
                  description: `${KIND_LABEL[l.kind] ?? l.kind} · ${phtDateString(new Date(l.generated_at))}`,
                })
              }
              className="block w-full py-2 text-left transition-colors hover:bg-foreground/[0.03]"
            >
              <div className="truncate text-[13px] font-medium text-foreground">
                {l.headline}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {KIND_LABEL[l.kind] ?? l.kind} ·{" "}
                {phtDateString(new Date(l.generated_at))}
              </div>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex justify-end">
        <Link
          href={seeAllHrefForScope(scope)}
          className="text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          see all →
        </Link>
      </div>
      <AiDot
        card={{
          key: cardKey,
          label: "Recent Letters",
          data: {
            letter_ids: top.map((l) => l.id),
            scope,
          },
        }}
        question="Talk about these letters"
      />
    </div>
  );
}
