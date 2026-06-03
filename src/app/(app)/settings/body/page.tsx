import { PageHeader } from "@/components/app/page-header";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { getArchivedHabitsLite, getHabitsWithRecent } from "@/lib/habits/queries";
import type { MorningLog } from "@/lib/supabase/types";
import { Section } from "../_components/section";
import { BodyForm } from "./_components/body-form";
import { HabitsSection } from "./_components/habits-section";

export const metadata = { title: "Body & Wellbeing · Settings" };

export default async function BodySettingsPage() {
  const user = await getAuthUser();
  let recent: MorningLog | null = null;
  if (user) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("morning_log")
      .select("*")
      .eq("user_id", user.id)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    recent = (data as unknown) as MorningLog | null;
  }
  const [habits, archivedHabits] = await Promise.all([
    getHabitsWithRecent(),
    getArchivedHabitsLite(),
  ]);

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-10">
      <PageHeader
        title="Body & Wellbeing"
        description="What the body is doing — and the small rhythms that hold the rest together."
      />

      <div className="mt-8 space-y-6">
        <Section
          title="Morning log"
          hint="Sleep, mood, and how the day starts. Today reads from the latest entry."
        >
          <BodyForm recent={recent} />
        </Section>

        <Section
          title="Habits"
          hint="Daily check-offs. Tap a tile to mark a day done — the strip shows the last 7 days, oldest on the left."
        >
          <HabitsSection habits={habits} archived={archivedHabits} />
        </Section>
      </div>
    </div>
  );
}
