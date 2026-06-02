"use client";

import { useRouter } from "next/navigation";
import { Users } from "lucide-react";
import { SWidget } from "@/components/widgets/s-widget";

type Props = {
  name: string | null;
  daysAgo: number | null;
};

function fmtAgo(days: number | null): string {
  if (days == null) return "no activity yet";
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

export function LastClientWidget({ name, daysAgo }: Props) {
  const router = useRouter();
  return (
    <SWidget
      label="Last client touch"
      icon={<Users className="h-4 w-4" />}
      hero={<span className="text-[18px] leading-snug">{name ?? "—"}</span>}
      sub={<span>{fmtAgo(daysAgo)}</span>}
      aiDot={{ key: "commitments.last_client", label: "Last client touch" }}
      onOpen={() => router.push("/clients")}
    />
  );
}
