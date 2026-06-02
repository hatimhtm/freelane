"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CenterModal, CenterModalBody, CenterModalFooter } from "@/components/ui/center-modal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { saveDiaryEntryAction, type DiaryEntryRow } from "@/lib/data/actions";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  existing: DiaryEntryRow | null;
  entryDate: string; // YYYY-MM-DD (PHT)
};

export function DiaryModal({ open, onOpenChange, existing, entryDate }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [body, setBody] = useState(existing?.body ?? "");
  const [mood, setMood] = useState<number | null>(existing?.mood ?? null);

  return (
    <CenterModal
      open={open}
      onOpenChange={onOpenChange}
      title="Today's diary"
      description="A line, a paragraph, a passing thought. Mood is optional. Energy lives on the morning log."
      size="md"
    >
      <CenterModalBody>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="diary-body">Diary</Label>
            <Textarea
              id="diary-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              placeholder="What happened. What didn't. What's on your mind."
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Mood</Label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setMood(mood === n ? null : n)}
                  className={
                    "h-8 w-8 rounded-full border text-sm tabular-nums transition-colors " +
                    (mood === n
                      ? "border-foreground bg-foreground text-background"
                      : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground")
                  }
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>
      </CenterModalBody>
      <CenterModalFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
          Cancel
        </Button>
        <Button
          onClick={() => {
            start(async () => {
              const res = await saveDiaryEntryAction({
                entryDate,
                body,
                mood,
                energy: null,
              });
              if (res.ok) {
                toast.success("Diary saved.");
                onOpenChange(false);
                router.refresh();
              } else {
                toast.error(res.error);
              }
            });
          }}
          disabled={pending || (!body.trim() && mood === null)}
        >
          Save
        </Button>
      </CenterModalFooter>
    </CenterModal>
  );
}
