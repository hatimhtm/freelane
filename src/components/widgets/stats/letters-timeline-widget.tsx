"use client";

import { ScrollText } from "lucide-react";
import { AiDot } from "@/components/widgets/ai-dot";
import { phtDateString } from "@/lib/utils";

// Letters timeline — Journey/L widget. Chronological strip of letters
// generated in scope, distinct from the dedicated /letters subtab's
// short list. Whole-row click navigates into the letters archive.

export type LettersTimelineWidgetProps = {
  scope: string;
  letters: Array<{ id: string; headline: string; generated_at: string; kind: string }>;
};

const KIND_LABEL: Record<string, string> = {
  end_of_month: "End of month",
  spotlight: "Spotlight",
  sunday: "Sunday",
  year: "Year",
  anniversary: "Anniversary",
  regret_mark: "Two-month mark",
};

export function LettersTimelineWidget({ scope, letters }: LettersTimelineWidgetProps) {
  const cardKey = `stats.${scope}.letters_timeline`;
  // Oldest → newest reads as a timeline; group by PHT month for the
  // editorial vibe.
  const sorted = [...letters].sort(
    (a, b) => new Date(a.generated_at).getTime() - new Date(b.generated_at).getTime(),
  );
  const months: Array<{ phtMonth: string; letters: typeof letters }> = [];
  for (const l of sorted) {
    const phtMonth = phtDateString(new Date(l.generated_at)).slice(0, 7);
    const tail = months[months.length - 1];
    if (tail && tail.phtMonth === phtMonth) {
      tail.letters.push(l);
    } else {
      months.push({ phtMonth, letters: [l] });
    }
  }
  return (
    <div className="group relative flex min-h-[260px] w-full flex-col rounded-xl bg-card p-5 ring-1 ring-foreground/10">
      <div className="flex items-start gap-2">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-foreground/[0.04] text-foreground/70">
          <ScrollText className="h-4 w-4" />
        </div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Letters timeline
        </div>
      </div>
      <ol className="mt-4 flex flex-1 flex-col gap-3">
        {months.map((m) => (
          <li key={m.phtMonth}>
            <div className="text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground">
              {m.phtMonth}
            </div>
            <ul className="mt-1.5 ml-2 flex flex-col gap-1.5 border-l border-foreground/[0.08] pl-3">
              {m.letters.map((l) => (
                <li key={l.id} className="text-[12.5px]">
                  <span className="font-medium text-foreground/90">
                    {l.headline}
                  </span>
                  <span className="ml-1.5 text-[10.5px] text-muted-foreground">
                    {KIND_LABEL[l.kind] ?? l.kind}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <AiDot
        card={{
          key: cardKey,
          label: "Letters timeline",
          data: { scope, letter_ids: letters.map((l) => l.id) },
        }}
        question="What story do these letters tell together?"
      />
    </div>
  );
}
