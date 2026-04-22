"use client";

import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { LinkButton } from "@/components/ui/link-button";

export function NextStepBanner({
  title,
  description,
  href,
  cta,
}: {
  title: string;
  description: string;
  href: string;
  cta: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="relative overflow-hidden rounded-2xl border border-[var(--brand)]/25 bg-gradient-to-r from-[var(--brand)]/6 via-transparent to-[var(--chart-2)]/8 p-5"
    >
      <div className="pointer-events-none absolute inset-0 brand-glow opacity-70" />
      <div className="relative flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[var(--brand)] to-[#5b9dff] text-white shadow-sm">
            <ArrowRight className="h-4 w-4" />
          </span>
          <div>
            <div className="text-sm font-semibold">{title}</div>
            <div className="text-xs text-muted-foreground">{description}</div>
          </div>
        </div>
        <LinkButton href={href}>
          {cta}
          <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
        </LinkButton>
      </div>
    </motion.div>
  );
}
