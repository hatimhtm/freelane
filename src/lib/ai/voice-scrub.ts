import "server-only";

// Forbidden-phrase scrub for AI-generated copy that lands in front of the
// user. The brief lists explicit no-go phrases ("you should", "consider",
// "save more", "stay positive", "well done", "great job", "amazing") and
// the voice guide locks them out of every surface.
//
// Substring matching alone is too weak — the models paraphrase ("it would
// be wise to" ≈ "you should"). The scrub does TWO passes:
//   1. exact-phrase blacklist with whole-word boundaries
//   2. paraphrase patterns common in Gemini output ("it would be wise to",
//      "it's worth considering", "feel free to", …)
// When a forbidden phrase is found the sentence is dropped and the
// surrounding text re-joined. If the whole answer would be empty, the
// scrub returns the original — better to leak one bad phrase than to
// show blank.

const FORBIDDEN_PHRASES: RegExp[] = [
  /\byou\s+should\b/gi,
  /\bconsider(?:ing)?\b/gi,
  /\bsave\s+more\b/gi,
  /\bstay\s+positive\b/gi,
  /\bwell\s+done\b/gi,
  /\bgreat\s+job\b/gi,
  /\bamazing\b/gi,
  /\bit\s+would\s+be\s+wise\s+to\b/gi,
  /\bit'?s\s+worth\s+considering\b/gi,
  /\bfeel\s+free\s+to\b/gi,
  /\bi'?d\s+recommend\b/gi,
  /\bmy\s+suggestion\s+is\b/gi,
];

function containsForbidden(text: string): boolean {
  return FORBIDDEN_PHRASES.some((re) => {
    re.lastIndex = 0;
    return re.test(text);
  });
}

export function scrubForbiddenPhrases(text: string): string {
  if (!text) return text;
  // Sentence split on . ! ? — keep delimiters for re-join.
  const parts = text.split(/(?<=[.!?])\s+/);
  const kept = parts.filter((s) => !containsForbidden(s));
  const out = kept.join(" ").trim();
  // If scrubbing nuked everything, fall back to the original rather than
  // showing a blank bubble.
  if (!out) return text;
  return out;
}

export function hasForbidden(text: string): boolean {
  return containsForbidden(text);
}
