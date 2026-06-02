// Canonical cigarette-category detector. Today and Dashboard's Pack Rhythm
// used to diverge — Today picked up "Smoking" / "Tobacco" / "Pack" via
// /cigar|smok|tobacco|pack/i while pack-rhythm.ts narrowed to /cigarettes?/i
// only. Cross-surface drift: same data, two different category sets.
//
// The Today regex is the more permissive intent (any cigarette-adjacent
// label should count). Adopting it as the canonical for every cigarette
// surface — pack-rhythm, milestones, late-night, calendar widgets.
//
// Reusable from server + client modules — no Supabase / "use server".

export function isCigaretteCategoryName(name: string | null | undefined): boolean {
  if (!name) return false;
  return /cigar|smok|tobacco|pack/i.test(name);
}
