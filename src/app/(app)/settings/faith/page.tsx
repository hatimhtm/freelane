import { PageHeader } from "@/components/app/page-header";
import { getFaithSettings } from "@/lib/faith/queries";
import { fetchDailyPrayerTimes } from "@/lib/faith/prayer-times";
import { hijriDateFor, isRamadan } from "@/lib/faith/hijri";
import { Section } from "../_components/section";
import { FaithSection } from "./_components/faith-section";
import { PrayerTimesCard } from "./_components/prayer-times-card";
import { QiblaCompass } from "./_components/qibla-compass";

export const metadata = { title: "Faith · Settings" };

export default async function FaithSettingsPage() {
  const settings = await getFaithSettings();
  const hijri = hijriDateFor();
  const ramadanInProgress = isRamadan();
  const showRamadan = (settings?.ramadan_enabled ?? false) && ramadanInProgress;

  // Pull prayer times only when we have both coords AND a configured
  // method. Otherwise the card renders the friendly fallback.
  const timings =
    settings?.latitude != null && settings?.longitude != null
      ? await fetchDailyPrayerTimes({
          latitude: Number(settings.latitude),
          longitude: Number(settings.longitude),
          method: settings.calculation_method ?? 2,
          madhab: (settings.madhab as "shafi" | "hanafi") ?? "shafi",
        })
      : null;

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-10">
      <PageHeader
        title="Faith"
        description="Prayer windows, qibla bearing, and Hijri date — anchored to your location. Sadaka lives on its own /sadaka page."
      />

      <div className="mt-8 space-y-6">
        <Section
          title="Today"
          hint={`${hijri.formatted} (Umm al-Qura — calendar-derived; can drift up to 1 day from local sighting)`}
        >
          <PrayerTimesCard timings={timings} ramadanEnabled={showRamadan} />
        </Section>

        <Section
          title="Qibla"
          hint="Initial bearing from your location to the Kaaba, in degrees true north."
        >
          <QiblaCompass
            latitude={settings?.latitude ?? null}
            longitude={settings?.longitude ?? null}
          />
        </Section>

        <Section
          title="Configuration"
          hint="Location, calculation method, madhab, and Ramadan window toggle. Changes flush the cache and refresh the times immediately."
        >
          <FaithSection initial={settings} />
        </Section>
      </div>
    </div>
  );
}
