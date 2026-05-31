"use client";

import { Cigarette } from "lucide-react";
import { translateCigaretteSpend } from "@/lib/cigarette-cost-translator";

// Cigarette Cost Translator strip — renders inline in the spend modal when
// the Cigarettes tag is selected. Translates the typed amount into Hatim's
// terms (family-wallet days / coffee weeks). Factual, never preachy.

export function CigaretteCostTranslatorStrip({ amountPhp }: { amountPhp: number }) {
  if (!amountPhp || amountPhp <= 0) return null;
  const result = translateCigaretteSpend(amountPhp);
  if (result.framings.length === 0) return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-border/40 bg-muted/30 px-2.5 py-2 text-[11px]">
      <Cigarette className="mt-0.5 h-3 w-3 shrink-0 text-foreground/70" />
      <div className="min-w-0 flex-1">
        {result.framings.slice(0, 2).map((f, i) => (
          <div key={i} className="text-foreground/80">
            <span className="font-medium">{f.label}</span>
            {f.detail && (
              <span className="ml-1 text-muted-foreground">· {f.detail}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
