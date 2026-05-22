"use client";

import { useState, useTransition } from "react";
import { Copy, Check, Loader2, MessageSquareQuote, RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { draftFollowUp } from "@/lib/ai/actions";

// Gemini drafts a tone-matched nudge for the client's oldest unpaid balance,
// reading their memory so a long-time boss gets a casual note and a new client
// gets a formal one.
export function FollowUpButton({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  function generate() {
    start(async () => {
      const res = await draftFollowUp(clientId);
      if (!res.ok) { toast.error(res.error ?? "Couldn't draft a message."); return; }
      setMessage(res.message ?? "");
      setOpen(true);
    });
  }

  function copy() {
    navigator.clipboard.writeText(message);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <>
      <Button variant="outline" onClick={generate} disabled={pending}>
        {pending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <MessageSquareQuote className="mr-1.5 h-4 w-4" />}
        Draft a nudge
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Follow-up draft</DialogTitle></DialogHeader>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={6}
            className="w-full resize-none rounded-xl border border-border/70 bg-background p-3 text-sm leading-relaxed outline-none focus:border-[var(--brand)]/60"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={generate} disabled={pending}>
              {pending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />}
              Redraft
            </Button>
            <Button size="sm" onClick={copy}>
              {copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
