"use client";

import { useRouter } from "next/navigation";
import { SWidget } from "@/components/widgets/s-widget";

type DiaryEntryLite = {
  entry_date: string;
  body: string;
  mood: number | null;
};

type Props = {
  entries: DiaryEntryLite[];
};

function moodDot(mood: number | null): string {
  if (mood == null) return "·";
  if (mood >= 4) return "●";
  if (mood >= 2) return "◐";
  return "○";
}

export function DiaryRecentWidget({ entries }: Props) {
  const router = useRouter();
  const last3 = entries.slice(0, 3);
  return (
    <SWidget
      label="Recent diary"
      hero={
        <span className="text-[18px] leading-snug">
          {last3.length > 0 ? `${last3.length}` : "—"}
        </span>
      }
      sub={
        <div className="flex flex-col gap-0.5">
          {last3.map((e) => (
            <span key={e.entry_date} className="truncate">
              {moodDot(e.mood)} {e.entry_date.slice(5)} · {e.body.slice(0, 28)}
            </span>
          ))}
          {last3.length === 0 && <span>no entries yet</span>}
        </div>
      }
      aiDot={{ key: "body.diary_recent", label: "Recent diary" }}
      onOpen={() => router.push("/today")}
    />
  );
}
