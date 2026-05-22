// Subtle paper grain behind the whole app. No aurora, no orbiting gradients —
// just a faint static texture so the warm background never reads as flat.
export function BackgroundOrbs() {
  return <div aria-hidden className="paper-grain pointer-events-none fixed inset-0 -z-10" />;
}
