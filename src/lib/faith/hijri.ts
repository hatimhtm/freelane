// Hijri date helper — local-only computation using Intl.DateTimeFormat
// with calendar=islamic-umalqura. Drifts from official PH sighting by up
// to 1 day; we label the rendered string accordingly so the user knows
// this is calendar-derived, not sighting-derived.

const FORMATTER = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", {
  timeZone: "Asia/Manila",
  day: "numeric",
  month: "long",
  year: "numeric",
});

// Numeric month formatter so isRamadan() can match by month NUMBER (9 =
// Ramadan in the Hijri calendar) instead of locale-fragile string-substring
// against monthName. Some ICU builds emit "Ramaḍān" with combining
// diacritics — the ASCII includes('ramadan') check on the long-name
// formatter quietly returns false.
const MONTH_NUMERIC_FORMATTER = new Intl.DateTimeFormat(
  "en-u-ca-islamic-umalqura",
  {
    timeZone: "Asia/Manila",
    month: "numeric",
  },
);

export type HijriParts = {
  formatted: string;
  day: number;
  monthName: string;
  year: number;
};

export function hijriDateFor(date: Date = new Date()): HijriParts {
  const parts = FORMATTER.formatToParts(date);
  let day = 0;
  let monthName = "";
  let year = 0;
  for (const p of parts) {
    if (p.type === "day") day = Number(p.value);
    else if (p.type === "month") monthName = p.value;
    else if (p.type === "year") year = Number(p.value.replace(/\D/g, ""));
  }
  return {
    formatted: FORMATTER.format(date),
    day,
    monthName,
    year,
  };
}

// True when the supplied Date falls inside Ramadan (Hijri month 9) per the
// Umm al-Qura calendar. Used to gate iftar/suhoor window rendering. Reads
// the numeric month from a dedicated formatter so ICU month-name spelling
// differences (e.g. "Ramaḍān" vs "Ramadan") can't silently break the gate.
export function isRamadan(date: Date = new Date()): boolean {
  const parts = MONTH_NUMERIC_FORMATTER.formatToParts(date);
  for (const p of parts) {
    if (p.type === "month") {
      return Number(p.value) === 9;
    }
  }
  return false;
}
