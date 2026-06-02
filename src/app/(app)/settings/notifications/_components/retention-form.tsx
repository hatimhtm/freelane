"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveRetentionAction } from "@/lib/notifications/actions";

type Props = {
  retentionDays: number;
  retentionForever: boolean;
};

const OPTIONS: { value: string; label: string }[] = [
  { value: "1", label: "1 day" },
  { value: "3", label: "3 days" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "forever", label: "Forever" },
];

export function RetentionForm({ retentionDays, retentionForever }: Props) {
  const [value, setValue] = useState<string>(
    retentionForever ? "forever" : String(retentionDays),
  );
  const [pending, start] = useTransition();

  const onChange = (next: string | null) => {
    if (next == null) return;
    setValue(next);
    start(async () => {
      const res = await saveRetentionAction(
        next === "forever" ? "forever" : Number(next),
      );
      if (!res.ok) toast.error(res.error || "Couldn't save.");
    });
  };

  return (
    <div className="flex items-center gap-3">
      <Select value={value} onValueChange={onChange} disabled={pending}>
        <SelectTrigger className="w-[180px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-[11px] text-muted-foreground">
        Read notifications older than this are deleted. Unread rows are never auto-deleted.
      </p>
    </div>
  );
}
