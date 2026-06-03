import type { DailyPrayerTimes } from "@/lib/faith/prayer-times";

// Server-rendered prayer-times grid. The page loads timings via
// fetchDailyPrayerTimes (Next fetch cache) and passes them in; no client
// JS needed.

const PRAYER_LABELS: { key: keyof DailyPrayerTimes; label: string }[] = [
  { key: "fajr", label: "Fajr" },
  { key: "sunrise", label: "Sunrise" },
  { key: "dhuhr", label: "Dhuhr" },
  { key: "asr", label: "Asr" },
  { key: "maghrib", label: "Maghrib" },
  { key: "isha", label: "Isha" },
];

export function PrayerTimesCard({
  timings,
  ramadanEnabled,
}: {
  timings: DailyPrayerTimes | null;
  ramadanEnabled: boolean;
}) {
  if (!timings) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 p-4 text-sm text-muted-foreground">
        Couldn&apos;t fetch prayer times. Check the location and try again — or
        check connectivity if you&apos;re offline.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {PRAYER_LABELS.map(({ key, label }) => {
          const value = timings[key];
          return (
            <div
              key={key}
              className="rounded-xl border border-border/60 bg-card px-3 py-2.5"
            >
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {label}
              </div>
              <div className="text-base font-semibold tabular">
                {value ?? "—"}
              </div>
            </div>
          );
        })}
      </div>
      {ramadanEnabled && (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.08] px-3 py-2.5">
            <div className="text-[11px] uppercase tracking-wider text-amber-700 dark:text-amber-300">
              Suhoor ends
            </div>
            <div className="text-base font-semibold tabular">
              {timings.imsak ?? timings.fajr ?? "—"}
            </div>
          </div>
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.08] px-3 py-2.5">
            <div className="text-[11px] uppercase tracking-wider text-amber-700 dark:text-amber-300">
              Iftar at
            </div>
            <div className="text-base font-semibold tabular">
              {timings.maghrib ?? "—"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
