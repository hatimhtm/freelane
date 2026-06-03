"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Crosshair } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveFaithSettings } from "@/lib/faith/actions";
import { CALCULATION_METHODS } from "@/lib/faith/calculation-methods";
import type { FaithMadhab, FaithSettings } from "@/lib/supabase/types";

// Form for the user's Faith config — location (manual or browser geo),
// calculation method, madhab, Ramadan toggle.
//
// Scope note on ramadan_enabled: this toggle ONLY affects the Faith
// settings page (it gates the suhoor / iftar tiles in PrayerTimesCard).
// Today's Ramadan banner is driven separately by nextRamadanPeriod() over
// islamic_calendar — it does NOT read finance.faith_settings. Keep the
// label honest so nobody enables this expecting Today to change.

export function FaithSection({ initial }: { initial: FaithSettings | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [v, setV] = useState({
    latitude: initial?.latitude?.toString() ?? "",
    longitude: initial?.longitude?.toString() ?? "",
    calculation_method: initial?.calculation_method ?? 2,
    madhab: (initial?.madhab as FaithMadhab) ?? "shafi",
    ramadan_enabled: initial?.ramadan_enabled ?? false,
  });
  const [locating, setLocating] = useState(false);

  function useDeviceLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast.error("Geolocation isn't available in this browser.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setV((prev) => ({
          ...prev,
          latitude: pos.coords.latitude.toFixed(6),
          longitude: pos.coords.longitude.toFixed(6),
        }));
        // The geolocation read only fills the form — the user still has
        // to click Save for the row to land in finance.faith_settings.
        // Surface that so nobody walks away thinking the location took
        // effect immediately.
        toast.success("Location filled — click Save to apply.");
      },
      (err) => {
        setLocating(false);
        toast.error(err.message || "Couldn't read location.");
      },
      { enableHighAccuracy: false, timeout: 10_000 },
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const result = await saveFaithSettings({
        latitude: v.latitude === "" ? null : Number(v.latitude),
        longitude: v.longitude === "" ? null : Number(v.longitude),
        calculation_method: Number(v.calculation_method),
        madhab: v.madhab,
        ramadan_enabled: v.ramadan_enabled,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Faith settings saved");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Latitude</Label>
          <Input
            inputMode="decimal"
            value={v.latitude}
            onChange={(e) => setV({ ...v, latitude: e.target.value })}
            placeholder="14.0667"
          />
        </div>
        <div>
          <Label className="text-xs">Longitude</Label>
          <Input
            inputMode="decimal"
            value={v.longitude}
            onChange={(e) => setV({ ...v, longitude: e.target.value })}
            placeholder="121.3250"
          />
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={useDeviceLocation}
        disabled={locating}
      >
        <Crosshair className="mr-1.5 h-3.5 w-3.5" />
        {locating ? "Locating…" : "Use device location"}
      </Button>

      <div>
        <Label className="text-xs">Calculation method</Label>
        <Select
          value={String(v.calculation_method)}
          onValueChange={(val) =>
            val && setV({ ...v, calculation_method: Number(val) })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CALCULATION_METHODS.map((m) => (
              <SelectItem key={m.value} value={String(m.value)}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          Drives Fajr / Isha angles. ISNA is the default; the local masjid's
          preferred method may differ.
        </p>
      </div>

      <div>
        <Label className="text-xs">Madhab (Asr rule)</Label>
        <Select
          value={v.madhab}
          onValueChange={(val) =>
            val && setV({ ...v, madhab: val as FaithMadhab })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="shafi">Shafi&apos;i (standard)</SelectItem>
            <SelectItem value="hanafi">Hanafi (longer shadow)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <label className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
        <span className="min-w-0">
          <span className="block text-sm font-medium">Ramadan windows</span>
          <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
            Show suhoor + iftar tiles on this page during the Hijri month of
            Ramadan. Today's Ramadan banner runs off its own Hijri detector.
          </span>
        </span>
        <Switch
          checked={v.ramadan_enabled}
          onCheckedChange={(c) => setV({ ...v, ramadan_enabled: c === true })}
          className="mt-0.5 shrink-0"
        />
      </label>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
