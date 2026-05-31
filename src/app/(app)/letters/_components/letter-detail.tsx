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
import { cn } from "@/lib/utils";
import type { EditorialLetter } from "@/lib/supabase/types";

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

  return (
    <article className="flex flex-col gap-5">
      <header className="flex flex-col gap-2 border-b border-border/40 pb-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {KIND_LABEL[letter.kind]} · {letter.period_key}
            </span>
            {letter.pinned && (
              <span className="rounded-full border border-acid-lime/50 px-2 py-0.5 text-[10px] uppercase tracking-wider text-acid-lime">
                pinned
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
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
        <h1 className="font-display text-xl leading-snug text-foreground">{letter.headline}</h1>
        <div className="text-[10px] text-muted-foreground/70">
          Generated {letter.generated_at.slice(0, 10)} · confidence {letter.confidence.toFixed(2)}
        </div>
      </header>

      <div className="prose prose-sm max-w-none text-[15px] leading-relaxed text-foreground/90 whitespace-pre-wrap">
        {letter.body}
      </div>

      {letter.blocks && Object.keys(letter.blocks).length > 0 && (
        <BlocksRenderer blocks={letter.blocks} />
      )}

      <section className="flex flex-col gap-2 border-t border-border/40 pt-4">
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
