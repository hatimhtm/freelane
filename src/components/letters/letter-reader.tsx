"use client";

import { useEffect, useState } from "react";
import { useNotificationModal } from "@/components/app/notification-modal-host";
import { setActiveCardContext } from "@/components/app/chatbot/chatbot-context-provider";
import { Button } from "@/components/ui/button";
import { fetchLetterAction } from "@/lib/data/letters-actions";
import { phtDateString } from "@/lib/utils";
import type { EditorialLetter } from "@/lib/supabase/types";

// Letter Reader modal body. Hosted inside NotificationModalHost; assumes a
// surrounding Dialog wrapper opened with { size: 'reader', chromeless: true }
// so the host's 720px max-width gives the inner 680px reading column
// breathing room and the Fraunces display-headline below is the SOLE
// headline (no DialogTitle stacked above it).
//
// Typography (owned in this file, not via @tailwindcss/typography — the
// `prose` plugin is NOT installed; the design language locks Fraunces +
// Geist anyway):
//   - display-eyebrow (Fraunces small caps) for date + theme
//   - display-headline (Fraunces large) for the letter headline
//   - body at max-w-[680px], py-12, leading-relaxed, paragraph spacing
//   - paragraphs split on blank lines so editorial line-breaks land as <p>
//
// Markdown is intentionally NOT rendered. The editorial-letter brain
// emits plain editorial paragraph text; bare **bold** would leak through
// if it ever appeared. If markdown lands later, swap to react-markdown
// here without touching the modal shell.
//
// Date display uses the PHT helper so a letter generated near UTC
// midnight reads as the local PHT day a Manila user actually saw.

const KIND_LABEL: Record<string, string> = {
  end_of_month: "End of month",
  spotlight: "Spotlight",
  sunday: "Sunday",
  year: "Year",
  anniversary: "Anniversary",
  regret_mark: "Two-month mark",
};

export function LetterReader({ letterId }: { letterId: string }) {
  const { closeModal } = useNotificationModal();
  const [letter, setLetter] = useState<EditorialLetter | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Reset on letterId change so a re-key with a new id (chained
    // navigation, future host re-mount) doesn't flash the stale letter
    // body before the new fetch resolves.
    setLetter(null);
    setError(null);
    setLoading(true);
    let cancelled = false;
    (async () => {
      const res = await fetchLetterAction(letterId);
      if (cancelled) return;
      if (!res.ok) {
        setError(res.error);
        setLoading(false);
        return;
      }
      setLetter(res.data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [letterId]);

  if (loading) {
    return (
      <div className="mx-auto max-w-[680px] px-4 py-12 text-center text-sm text-muted-foreground">
        <p>Loading the letter…</p>
        <div className="mt-6 flex justify-end">
          <Button variant="ghost" onClick={closeModal}>
            Close
          </Button>
        </div>
      </div>
    );
  }
  if (error || !letter) {
    return (
      <div className="mx-auto max-w-[680px] px-4 py-12 text-center text-sm text-muted-foreground">
        <p>Couldn&apos;t load the letter. {error ?? ""}</p>
        <div className="mt-6 flex justify-end">
          <Button onClick={closeModal}>Close</Button>
        </div>
      </div>
    );
  }

  const themeLabel = KIND_LABEL[letter.kind] ?? letter.kind;
  const generatedDate = phtDateString(new Date(letter.generated_at));
  // Split on blank lines so editorial paragraph breaks land as <p>.
  const paragraphs = letter.body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <article className="mx-auto max-w-[680px] px-4 py-12">
      <div className="display-eyebrow text-muted-foreground">
        {themeLabel} · {generatedDate}
      </div>
      <h1 className="display-headline mt-3 text-[36px] leading-tight text-foreground">
        {letter.headline}
      </h1>
      <div className="letter-body mt-6 max-w-none text-[15px] leading-relaxed text-foreground/90">
        {paragraphs.length > 0 ? (
          paragraphs.map((p, i) => (
            <p key={i} className="mb-4 whitespace-pre-wrap">
              {p}
            </p>
          ))
        ) : (
          <p className="whitespace-pre-wrap">{letter.body}</p>
        )}
      </div>
      <footer className="mt-8 flex items-center justify-end gap-2 border-t border-border/40 pt-4">
        <Button
          variant="ghost"
          onClick={() => {
            // Scope the chatbot to this letter and open it. The
            // chatbot-context-provider listens for freelane:open-chatbot
            // and uses the activeCard data to seed the chat with letter
            // context.
            //
            // Order matters: set the context FIRST, then defer closeModal
            // by one paint frame so the chatbot pill has time to mount
            // visible BEFORE the modal animates out. Without the
            // requestAnimationFrame the modal disappears while the pill
            // is still booting on slow devices, leaving a visual gap.
            setActiveCardContext(
              {
                key: `letter.${letter.id}`,
                label: letter.headline,
                data: {
                  letter_id: letter.id,
                  kind: letter.kind,
                  period_key: letter.period_key,
                },
              },
              "Respond to this letter",
            );
            if (typeof window !== "undefined") {
              window.requestAnimationFrame(() => closeModal());
            } else {
              closeModal();
            }
          }}
        >
          Respond in chat
        </Button>
        <Button onClick={closeModal}>Close</Button>
      </footer>
    </article>
  );
}
