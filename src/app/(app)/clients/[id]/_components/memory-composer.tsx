"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, Trash2 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { addClientMemoryEntry, consolidateClientMemoryAction, deleteClientMemoryEntry } from "@/lib/data/actions";
import type { ClientMemoryConsolidated } from "@/lib/supabase/types";

type Entry = { id: string; content: string; createdAt: string; consolidated: boolean };

// Drop-a-sentence box. The note saves instantly; Gemini then folds it into the
// living memory shown at top, in a separate request so the UI never blocks.
export function MemoryComposer({
  clientId,
  entries,
  consolidated,
}: {
  clientId: string;
  entries: Entry[];
  consolidated: ClientMemoryConsolidated;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [consolidating, setConsolidating] = useState(false);

  function add() {
    const content = text.trim();
    if (!content) return;
    start(async () => {
      try {
        await addClientMemoryEntry(clientId, content);
        setText("");
        router.refresh();
        // Fold into the living memory in the background — note already shows.
        setConsolidating(true);
        consolidateClientMemoryAction(clientId)
          .then(() => router.refresh())
          .catch(() => {})
          .finally(() => setConsolidating(false));
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  function remove(id: string) {
    start(async () => {
      try {
        await deleteClientMemoryEntry(id, clientId);
        router.refresh();
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  const hasSummary = !!consolidated.summary || (consolidated.facts?.length ?? 0) > 0;

  return (
    <div className="space-y-5">
      {hasSummary && (
        <div className="rounded-xl border border-border/70 bg-card p-4">
          <div className="display-eyebrow mb-2 flex items-center gap-1.5 text-muted-foreground">
            {consolidating ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
            Client memory
          </div>
          {consolidated.summary && <p className="text-sm leading-relaxed">{consolidated.summary}</p>}
          {(consolidated.facts?.length ?? 0) > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {consolidated.facts!.map((f, i) => (
                <li key={i} className="flex gap-2"><span className="text-muted-foreground/50">·</span>{f}</li>
              ))}
            </ul>
          )}
          {(consolidated.watch?.length ?? 0) > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {consolidated.watch!.map((w, i) => (
                <span key={i} className="rounded-full bg-[var(--overdue)]/12 px-2 py-0.5 text-[11px] text-[var(--overdue)]">{w}</span>
              ))}
            </div>
          )}
        </div>
      )}

      <div>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder="Note something about this client — it folds into the memory above…"
          className="resize-none"
        />
        <div className="mt-2 flex justify-end">
          <Button size="sm" onClick={add} disabled={pending || !text.trim()}>
            {pending ? "Saving…" : "Add to memory"}
          </Button>
        </div>
      </div>

      {entries.length > 0 && (
        <ol className="relative ml-2 space-y-3 border-l border-border/60 pl-4">
          <AnimatePresence initial={false}>
            {entries.map((e) => (
              <motion.li
                key={e.id}
                layout
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                className="group relative text-sm"
              >
                <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-muted-foreground/40 ring-2 ring-background" />
                <div className="flex items-start justify-between gap-2">
                  <p className="leading-snug">{e.content}</p>
                  <button
                    onClick={() => remove(e.id)}
                    className="shrink-0 text-muted-foreground/40 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                    aria-label="Delete note"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground/70 tabular">
                  {new Date(e.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      )}
    </div>
  );
}
