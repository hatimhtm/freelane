"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bookmark, RefreshCw, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteLetterAction,
  pinLetterAction,
  refreshLetterAction,
  replyToLetterAction,
} from "@/lib/data/actions";
import { cn, phtDateString } from "@/lib/utils";
import type { EditorialLetter } from "@/lib/supabase/types";

// Deep-link page typography mirrors the LetterReader modal so a user
// landing on /letters/[id] (SW openWindow fallback, shared link, etc.)
// sees the same editorial surface they'd see in-app. Locked classes:
//   - display-eyebrow (Fraunces small caps) for theme + PHT date
//   - display-headline (Fraunces large) for the letter headline
//   - letter-body for the reading column
//   - max-w-[680px] mx-auto py-12
//
// We DO NOT use the `prose prose-sm` classes here — the Tailwind
// typography plugin is not installed (see globals.css note). Bare body
// text styling lives in the .letter-body / display-* utility classes.

const KIND_LABEL: Record<EditorialLetter["kind"], string> = {
  end_of_month: "End of month",
  spotlight: "Spotlight",
  sunday: "Sunday",
  year: "Year",
  anniversary: "Anniversary",
  regret_mark: "Two-month mark",
};

export function LetterDetail({ letter }: { letter: EditorialLetter }) {
  const router = useRouter();
  const [reply, setReply] = useState(letter.reply ?? "");
  const [pending, start] = useTransition();

  const themeLabel = KIND_LABEL[letter.kind] ?? letter.kind;
  const generatedDate = phtDateString(new Date(letter.generated_at));
  const paragraphs = letter.body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <article className="mx-auto max-w-[680px] px-4 py-12">
      <div className="flex items-start justify-between gap-3">
        <div className="display-eyebrow text-muted-foreground">
          {themeLabel} · {generatedDate}
          {letter.pinned && (
            <span className="ml-2 rounded-full border border-acid-lime/50 px-2 py-0.5 text-[9px] uppercase tracking-wider text-acid-lime">
              pinned
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={letter.pinned ? "Unpin" : "Pin"}
            onClick={async () => {
              try {
                await pinLetterAction(letter.id, !letter.pinned);
                router.refresh();
              } catch (err) {
                toast.error((err as Error).message);
              }
            }}
          >
            <Bookmark className={cn("h-3.5 w-3.5", letter.pinned && "text-acid-lime")} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Regenerate letter"
            onClick={() =>
              start(async () => {
                try {
                  await refreshLetterAction({ kind: letter.kind, periodKey: letter.period_key, force: true });
                  toast.success("Re-written.");
                  router.refresh();
                } catch (err) {
                  toast.error((err as Error).message);
                }
              })
            }
            disabled={pending}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", pending && "animate-spin")} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Delete letter"
            onClick={async () => {
              try {
                await deleteLetterAction(letter.id);
                toast.success("Letter removed.");
                router.push("/letters");
              } catch (err) {
                toast.error((err as Error).message);
              }
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
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

      {letter.blocks && Object.keys(letter.blocks).length > 0 && (
        <BlocksRenderer blocks={letter.blocks} />
      )}

      <section className="mt-8 flex flex-col gap-2 border-t border-border/40 pt-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-sm font-medium">Your reply</h2>
          {letter.replied_at && (
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              replied {letter.replied_at.slice(0, 10)}
            </span>
          )}
        </div>
        <Textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="A note back to your past self."
          rows={4}
          className="resize-none text-sm"
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={pending || !reply.trim() || reply.trim() === (letter.reply ?? "").trim()}
            onClick={() =>
              start(async () => {
                try {
                  await replyToLetterAction(letter.id, reply.trim());
                  toast.success("Reply saved. Folded into memory.");
                  router.refresh();
                } catch (err) {
                  toast.error((err as Error).message);
                }
              })
            }
            className="gap-1.5"
          >
            <Send className="h-3.5 w-3.5" />
            Send
          </Button>
        </div>
      </section>
    </article>
  );
}

function BlocksRenderer({ blocks }: { blocks: Record<string, unknown> }) {
  // Loose rendering — known shapes get pretty surfaces, unknowns fall back
  // to a key/value table.
  return (
    <section className="rounded-[12px] border border-border/40 bg-muted/20 p-3">
      <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        Notes
      </div>
      <dl className="grid gap-2 text-[12px]">
        {Object.entries(blocks).map(([k, v]) => (
          <div key={k} className="grid grid-cols-[120px_1fr] gap-3">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-foreground/85">{renderBlockValue(v)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function renderBlockValue(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(renderBlockValue).join(", ");
  try {
    return JSON.stringify(v).slice(0, 240);
  } catch {
    return String(v);
  }
}
