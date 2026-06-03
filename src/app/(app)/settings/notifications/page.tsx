import {
  readNotificationPrefs,
  readNotificationSettings,
} from "@/lib/notifications/dispatcher";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "../_components/section";
import { RetentionForm } from "./_components/retention-form";
import { PushToggle } from "./_components/push-toggle";
import { PerKindPrefsTable } from "./_components/per-kind-prefs-table";

export const metadata = { title: "Notifications · Settings" };

export default async function NotificationsSettingsPage() {
  const settings = await readNotificationSettings().catch(() => null);
  const legacy = await readNotificationPrefs().catch(() => ({}));
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null;

  const retentionDays = settings?.retention_days ?? 3;
  const retentionForever = settings?.retention_forever ?? false;
  const pushEnabled = settings?.push_enabled ?? false;
  const perKindPrefs = settings?.per_kind_prefs ?? {};

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-10">
      <PageHeader
        title="Notifications"
        description="How and where Freelane reaches you — retention, browser push, and per-kind controls."
      />

      <div className="mt-8 space-y-6">
        <Section
          title="Retention"
          hint="Read notifications older than this are deleted nightly. Unread rows are never auto-deleted."
        >
          <RetentionForm
            retentionDays={retentionDays}
            retentionForever={retentionForever}
          />
        </Section>

        <Section
          title="Browser push"
          hint="Allow Freelane to push native OS notifications when this tab isn't focused."
        >
          <PushToggle
            pushEnabled={pushEnabled}
            vapidPublicKey={vapidPublicKey}
          />
        </Section>

        <Section
          title="Per-kind preferences"
          hint="Pick which kinds reach you, where, and whether they make a sound. Defaults: in-app on, push off, sound off — flip each kind on to opt in."
        >
          <PerKindPrefsTable initial={perKindPrefs} legacy={legacy} />
        </Section>
      </div>
    </div>
  );
}

