"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { Pencil, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { CenterModal, CenterModalBody, CenterModalFooter } from "@/components/ui/center-modal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { refreshIntentMirrorAction, saveIntentionsAction } from "@/lib/data/actions";
import { cn } from "@/lib/utils";
import type { IntentMirror } from "@/lib/supabase/types";

// Journal vs Spend Reality Mirror (#36) — weekly. Card shows the
// intentions for the current week + the AI-written mirror narrative if it
// exists. Edit intentions opens a modal; Refresh runs the mirror brain.

export function JournalMirrorCard({ mirror }: { mirror: IntentMirror | null }) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [pending, start] = useTransition();

  const hasIntentions = mirror && (mirror.intentions_text || Object.keys(mirror.intentions ?? {}).length > 0);

  return (
    <>
      <motion.section
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        className="rounded-[12px] border border-border/60 bg-card/30 px-3.5 py-3"
      >
        <header className="flex items-baseline justify-between gap-2">
          <span className="text-[10px] uppercase tracking-[0.14em] text-foreground/70">
            Weekly intentions
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
            >
              {hasIntentions ? "Edit" : "Set"}
            </button>
            {hasIntentions && (
              <button
                type="button"
                aria-label="Refresh mirror"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    try {
                      await refreshIntentMirrorAction();
                      toast.success("Mirror refreshed.");
                      router.refresh();
                    } catch (err) {
                      toast.error((err as Error).message);
                    }
                  })
                }
                className="ml-1.5 text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className={cn("h-3 w-3", pending && "animate-spin")} />
              </button>
            )}
          </div>
        </header>
        {hasIntentions ? (
          <>
            {mirror?.intentions_text && (
              <p className="mt-1.5 text-[12px] italic leading-relaxed text-foreground/80">
                &quot;{mirror.intentions_text}&quot;
              </p>
            )}
            {mirror?.narrative && (
              <p className="mt-2 text-sm leading-snug text-foreground">{mirror.narrative}</p>
            )}
            {!mirror?.narrative && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Tap the refresh icon to fold the week into the mirror.
              </p>
            )}
          </>
        ) : (
          <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
            Write a quick line about what you&apos;re aiming for this week. The mirror reads back what actually happened.
          </p>
        )}
      </motion.section>

      <EditIntentionsModal
        open={editOpen}
        onOpenChange={setEditOpen}
        existing={mirror}
      />
    </>
  );
}

function EditIntentionsModal({
  open,
  onOpenChange,
  existing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  existing: IntentMirror | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState<string>(existing?.intentions_text ?? "");
  const [focus, setFocus] = useState<string>(
    (existing?.intentions?.focus as string | undefined) ?? "",
  );
  const [familyTarget, setFamilyTarget] = useState<string>(
    existing?.intentions?.family_target_php != null
      ? String(existing.intentions.family_target_php)
      : "",
  );

  return (
    <CenterModal
      open={open}
      onOpenChange={onOpenChange}
      title="This week's intentions"
      description="A short line, plus the focus + a family-pot target if it fits."
      size="md"
    >
      <CenterModalBody>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Intentions
            </Label>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Planning to slow on fast food and tuck ₱2,000 toward the household."
              rows={3}
              className="resize-none text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Focus
              </Label>
              <input
                value={focus}
                onChange={(e) => setFocus(e.target.value)}
                placeholder="fast food"
                className="h-9 rounded-md border border-border/70 bg-transparent px-2 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Household target (₱)
              </Label>
              <input
                type="number"
                value={familyTarget}
                onChange={(e) => setFamilyTarget(e.target.value)}
                placeholder="2000"
                className="h-9 rounded-md border border-border/70 bg-transparent px-2 text-sm tabular"
              />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground/70">
            Household target is a SOFT marker — never a goal, never a budget. It just gives the mirror something to compare against.
          </p>
        </div>
      </CenterModalBody>
      <CenterModalFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          disabled={pending || (!text.trim() && !focus.trim() && !familyTarget.trim())}
          onClick={() =>
            start(async () => {
              try {
                const intentions: Record<string, unknown> = {};
                if (focus.trim()) intentions.focus = focus.trim();
                const ft = Number(familyTarget);
                if (Number.isFinite(ft) && ft > 0) intentions.family_target_php = ft;
                await saveIntentionsAction({
                  intentionsText: text.trim() || undefined,
                  intentions,
                });
                await refreshIntentMirrorAction();
                toast.success("Intentions saved.");
                onOpenChange(false);
                router.refresh();
              } catch (err) {
                toast.error((err as Error).message);
              }
            })
          }
        >
          {pending ? "Saving…" : "Save"}
        </Button>
      </CenterModalFooter>
    </CenterModal>
  );
}
