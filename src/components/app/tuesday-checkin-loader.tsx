"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { TuesdayCheckinModal } from "@/components/app/tuesday-checkin-modal";
import { useNotificationModal } from "@/components/app/notification-modal-host";
import {
  getTuesdayCheckinDataAction,
  type TuesdayCheckinData,
} from "@/lib/notifications/tuesday-actions";
import type { Notification } from "@/lib/notifications/dispatcher";

// Bridges the click-routing registry (sync) to the TuesdayCheckinModal
// (needs server-loaded prompt + current week's check-in). Renders a brief
// loading state inside the host modal while the action resolves, then
// swaps into the real modal.

type Props = { notification: Notification };

export function TuesdayCheckinLoader({ notification }: Props) {
  const { closeModal } = useNotificationModal();
  const [data, setData] = useState<TuesdayCheckinData | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await getTuesdayCheckinDataAction();
      if (cancelled) return;
      if (!res.ok) {
        toast.error(res.error || "Couldn't load the check-in.");
        closeModal();
        return;
      }
      setData(res.data);
      // Body-click mark-read is owned by the calling sites (popover +
      // /notifications view) before they invoke the click-routing
      // registry, so we DON'T mark again here — would cause a redundant
      // write + revalidate.
    })();
    return () => {
      cancelled = true;
    };
    // notification.id intentionally not a dep — the loader is mounted once
    // per notification click; remounting (id change) triggers re-render of
    // the parent so the effect already re-runs naturally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeModal]);

  if (!data) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Loading the week&apos;s question…
      </p>
    );
  }

  return (
    <TuesdayCheckinModal
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) closeModal();
      }}
      prompt={data.prompt}
      checkin={data.checkin}
    />
  );
}
