// Aladhan calculation-method catalogue (subset — the ones most likely
// relevant to Freelane users). Used by the calculation_method picker on
// the Faith settings form. Kept in a client-safe module so React
// Client Components can import it without dragging the server-only
// fetch wrapper from prayer-times.ts.

export const CALCULATION_METHODS: { value: number; label: string }[] = [
  { value: 0, label: "Jafari / Shia Ithna-Ashari" },
  { value: 1, label: "University of Islamic Sciences, Karachi" },
  { value: 2, label: "Islamic Society of North America (ISNA)" },
  { value: 3, label: "Muslim World League" },
  { value: 4, label: "Umm Al-Qura, Makkah" },
  { value: 5, label: "Egyptian General Authority of Survey" },
  { value: 8, label: "Gulf Region" },
  { value: 9, label: "Kuwait" },
  { value: 10, label: "Qatar" },
  { value: 11, label: "Majlis Ugama Islam Singapura" },
  { value: 12, label: "Union Organization Islamic de France" },
  { value: 13, label: "Diyanet İşleri Başkanlığı (Turkey)" },
  { value: 14, label: "Spiritual Administration of Muslims of Russia" },
  { value: 15, label: "Moonsighting Committee Worldwide" },
];
