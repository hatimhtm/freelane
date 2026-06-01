"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { Send, Volume2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { resolveQuietChannelAction } from "@/lib/data/actions";
import type { QuietChannel } from "@/lib/supabase/types";

// Renders only when a client has an open quiet_channels row. Reply folds into
// client memory via Gemini; the row resolves; the banner hides on next load.

export function QuietChannelBanner({ channel }: { channel: QuietChannel | null }) {
  const router = useRouter();
  const [reply, setReply] = useState("");
  const [pending, start] = useTransition();
  if (!channel) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-[12px] border border-amber-400/40 bg-amber-400/[0.06] p-4"
    >
      <header className="flex items-center gap-1.5">
        <Volume2 className="h-3.5 w-3.5 text-amber-500" />
        <span className="text-[10px] uppercase tracking-[0.14em] text-amber-600">
          Quiet channel
        </span>
      </header>
      <p className="mt-1.5 text-sm leading-snug text-foreground">
        {channel.silence_days} days since the last money moved through here. Anything you know
        that the system doesn&apos;t?
      </p>
      <Textarea
        value={reply}
        onChange={(e) => setReply(e.target.value)}
        placeholder="One line is enough. e.g. hiring freeze through Q3 · they paused after Eid · still warm."
        rows={2}
        className="mt-2.5 resize-none text-sm"
      />
      <div className="mt-2.5 flex justify-end">
        <Button
          size="sm"
          disabled={pending || !reply.trim()}
          onClick={() =>
            start(async () => {
              try {
                await resolveQuietChannelAction({
                  quietChannelId: channel.id,
                  reply: reply.trim(),
                });
                toast.success("Folded into memory.");
                router.refresh();
              } catch (err) {
                toast.error((err as Error).message);
              }
            })
          }
          className="gap-1.5"
        >
          <Send className="h-3 w-3" />
          {pending ? "Folding…" : "Send"}
        </Button>
      </div>
    </motion.section>
  );
}
