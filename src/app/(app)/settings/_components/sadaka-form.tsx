"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { updateSadakaConfig, type SadakaConfig } from "@/lib/sadaka/config";

// Settings → Sadaka. Four knobs:
//   • base_contribution_pct — anchored at 2.5% (Islamic zakat).
//   • decay_pct_monthly — relevance fade rate (default 4%).
//   • nudge_silence_days — minimum days between sadaka_nudge notifications.
//   • classifier_confidence_threshold — gate for AI-classified rows (0-1).
//
// Copy reads flat — no coaching, no second-person commands.

type Props = {
  initial: SadakaConfig;
};

export function SadakaConfigForm({ initial }: Props) {
  const [baseRate, setBaseRate] = useState(String(initial.base_contribution_pct));
  const [decay, setDecay] = useState(String(initial.decay_pct_monthly));
  const [silence, setSilence] = useState(String(initial.nudge_silence_days));
  const [threshold, setThreshold] = useState(
    String(initial.classifier_confidence_threshold),
  );
  const [pending, start] = useTransition();

  function save() {
    start(async () => {
      const res = await updateSadakaConfig({
        base_contribution_pct: Number(baseRate),
        decay_pct_monthly: Number(decay),
        nudge_silence_days: Math.floor(Number(silence)),
        classifier_confidence_threshold: Number(threshold),
      });
      if (!res.ok) {
        toast.error(res.error || "Couldn't save the sadaka settings.");
        return;
      }
      toast.success("Sadaka settings saved.");
    });
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="sadaka-base" className="text-xs">
          Base contribution %
        </Label>
        <Input
          id="sadaka-base"
          type="number"
          inputMode="decimal"
          step="0.1"
          value={baseRate}
          onChange={(e) => setBaseRate(e.target.value)}
          className="h-9 text-sm tabular text-right"
        />
        <p className="text-[11px] text-muted-foreground">
          Anchored at 2.5% — Islamic zakat. The brain adjusts around the anchor per
          income event.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sadaka-decay" className="text-xs">
          Monthly decay %
        </Label>
        <Input
          id="sadaka-decay"
          type="number"
          inputMode="decimal"
          step="0.1"
          value={decay}
          onChange={(e) => setDecay(e.target.value)}
          className="h-9 text-sm tabular text-right"
        />
        <p className="text-[11px] text-muted-foreground">
          How quickly the pool fades each month. Default 4%.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sadaka-silence" className="text-xs">
          Nudge silence (days)
        </Label>
        <Input
          id="sadaka-silence"
          type="number"
          inputMode="numeric"
          step="1"
          value={silence}
          onChange={(e) => setSilence(e.target.value)}
          className="h-9 text-sm tabular text-right"
        />
        <p className="text-[11px] text-muted-foreground">
          Days the inbox stays quiet after a sadaka payment. Default 5.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sadaka-threshold" className="text-xs">
          Classifier threshold (0-1)
        </Label>
        <Input
          id="sadaka-threshold"
          type="number"
          inputMode="decimal"
          step="0.05"
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
          className="h-9 text-sm tabular text-right"
        />
        <p className="text-[11px] text-muted-foreground">
          AI-classified rows land tentative above this confidence. Default 0.7.
        </p>
      </div>
      <div className="md:col-span-2 flex justify-end">
        <Button onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save sadaka settings"}
        </Button>
      </div>
    </div>
  );
}
