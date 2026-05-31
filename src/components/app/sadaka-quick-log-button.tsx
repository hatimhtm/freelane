"use client";

import { HandCoins } from "lucide-react";
import { Button } from "@/components/ui/button";

// One of the Today quick actions. Pairs with `IncomeSadakaSuggestion` —
// that one fires after income lands; this one is the always-available
// manual entry. Dispatches the same event the suggestion uses so the page
// has a single sheet wiring to maintain.
export function SadakaQuickLogButton({
  sadakaCategoryId,
}: {
  sadakaCategoryId: string;
}) {
  function openSpendSheet() {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("freelane:open-spend-sheet", {
        detail: {
          source: "sadaka-quick-log",
          categoryId: sadakaCategoryId,
          categorySlug: "sadaka",
        },
      }),
    );
  }

  return (
    <Button variant="outline" size="sm" onClick={openSpendSheet}>
      <HandCoins data-icon="inline-start" />
      Log sadaka
    </Button>
  );
}
