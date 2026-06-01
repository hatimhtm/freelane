"use client";

import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

// Small quick action shown in the Today bottom strip alongside Sadaka quick log.
// Linked to /should-i-buy where the full session UI lives.

export function ShouldIBuyQuicklink() {
  return (
    <Link href="/should-i-buy" className={buttonVariants({ variant: "outline", size: "sm" })}>
      <ShoppingBag data-icon="inline-start" />
      Should I buy?
    </Link>
  );
}
