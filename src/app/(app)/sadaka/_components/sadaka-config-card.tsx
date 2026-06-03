"use client";

import { useState, useTransition } from "react";
import { SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";

import {
  CenterModal,
  CenterModalBody,
  CenterModalFooter,
} from "@/components/ui/center-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { SadakaConfig } from "@/lib/sadaka/config";
import { updateSadakaConfig } from "@/lib/sadaka/config-actions";

// CONFIG (S widget): base contribution % anchor + decay + nudge silence +
// classifier threshold. Tap to open a center modal. Mirrors the four knobs
// previously exposed in Settings → Faith (which had drifted out of scope —
// per the Sadaka design memory the algorithm lives on /sadaka).

type Props = {
  initial: SadakaConfig;
};

export function SadakaConfigCard({ initial }: Props) {
  const [open, setOpen] = useState(false);
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
      setOpen(false);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-slot="card"
        className="group relative flex aspect-square w-full min-h-[160px] flex-col justify-between rounded-xl bg-card p-4 text-left ring-1 ring-foreground/10 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_8px_20px_-8px_oklch(0_0_0/0.12)]"
      >
        <div className="flex items-start justify-between">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-foreground/[0.04] text-foreground/70">
            <SlidersHorizontal className="h-4 w-4" />
          </div>
        </div>
        <div className="space-y-1">
          <div className="display-headline text-[28px] leading-none tabular-nums text-foreground">
            {Number(baseRate).toFixed(1)}%
          </div>
          <div className="text-[11px] leading-tight text-muted-foreground">
            base contribution
          </div>
        </div>
      </button>

      <CenterModal
        open={open}
        onOpenChange={setOpen}
        title="Sadaka configuration"
        description="Anchor rate, decay, nudge silence, and classifier threshold. The brain adjusts around these per income event."
        size="lg"
      >
        <CenterModalBody>
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
                Anchored at 2.5% — Islamic zakat.
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
          </div>
        </CenterModalBody>
        <CenterModalFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </CenterModalFooter>
      </CenterModal>
    </>
  );
}
