"use client";

import { useRouter } from "next/navigation";
import { Target } from "lucide-react";
import { SWidget } from "@/components/widgets/s-widget";
import { NumberHero } from "@/components/widgets/number-hero";

// closestDueLabel is accepted but deliberately ignored on /dashboard/commitments
// per brief — the closest-plan signal lives on /projects. Other callers (if
// they appear) can still pass it and the widget will treat it as a static
// caption instead of rendering its own "closest · …" line.
type Props = {
  count: number;
  closestDueLabel?: string | null;
};

export function ActiveProjectsWidget({ count, closestDueLabel: _closestDueLabel }: Props) {
  const router = useRouter();
  void _closestDueLabel;
  return (
    <SWidget
      label="Active projects"
      icon={<Target className="h-4 w-4" />}
      hero={<NumberHero value={count} maximumFractionDigits={0} />}
      sub={count > 0 ? <span>open work</span> : <span>nothing in the queue</span>}
      aiDot={{ key: "commitments.active_projects", label: "Active projects" }}
      onOpen={() => router.push("/projects")}
    />
  );
}
