"use client";

import Link from "next/link";
import { ShoppingBag } from "lucide-react";

export function ShouldIBuyQuicklink() {
  return (
    <Link
      href="/should-i-buy"
      className="inline-flex items-center gap-1.5 self-start rounded-full border border-border/70 px-2.5 py-1 text-[11px] text-foreground/80 transition-colors hover:border-foreground/40 hover:bg-muted/40"
    >
      <ShoppingBag className="h-3 w-3" />
      Should I buy this?
    </Link>
  );
}
