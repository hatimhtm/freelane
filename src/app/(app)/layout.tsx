import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import { SidebarNav } from "@/components/app/sidebar-nav";
import { TopBar } from "@/components/app/top-bar";
import { PageTransition } from "@/components/app/page-transition";
import { BackgroundOrbs } from "@/components/app/background-orbs";
import { FxAutoRefresh } from "@/components/app/fx-auto-refresh";
import { MetricSheetProvider } from "@/components/app/metric-sheet";
import { ChatbotPill } from "@/components/app/chatbot/chatbot-pill";
import { ChatbotContextProvider } from "@/components/app/chatbot/chatbot-context-provider";
import { CommandPaletteHost } from "@/components/app/command-palette";
import { NotificationModalHost } from "@/components/app/notification-modal-host";
import { NotificationLinkInterceptor } from "@/components/app/notification-link-interceptor";
import { ServiceWorkerRegistrar } from "@/components/app/service-worker-registrar";
import { hasGemini } from "@/lib/ai/gemini";
import { readNotificationSettings } from "@/lib/notifications/dispatcher";
import { loadChangelog } from "@/lib/changelog/load";
import { getLastSeenVersion } from "@/lib/data/queries";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const aiEnabled = hasGemini();
  const notifSettings = await readNotificationSettings().catch(() => null);
  const pushEnabled = notifSettings?.push_enabled ?? false;
  // Top-level "settings has an unseen release" signal — drives the dot
  // on the Settings entry in BOTH SidebarNav and MobileNav, so a user
  // who never navigates into Settings still sees a nav-level cue.
  const [{ currentVersion }, lastSeenVersion] = await Promise.all([
    loadChangelog().catch(() => ({ currentVersion: "" })),
    getLastSeenVersion().catch(() => null),
  ]);
  const settingsHasUpdate =
    !!currentVersion && lastSeenVersion !== currentVersion;

  return (
    <NotificationModalHost>
      <ChatbotContextProvider>
        <div className="relative flex min-h-dvh bg-background">
          <BackgroundOrbs />
          <FxAutoRefresh />
          <ServiceWorkerRegistrar enabled={pushEnabled} />
          <NotificationLinkInterceptor />
          <SidebarNav settingsHasUpdate={settingsHasUpdate} />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar settingsHasUpdate={settingsHasUpdate} />
            {/* pb-32 (128px) baseline clearance for the ChatbotPill +
                per-page floating CTAs (bottom-6 / right-6 ≈ 24px from
                edge, 48-56px button height). Every page inherits the
                floor — numbers and charts at the bottom of any surface
                clear the floating UI without per-page padding. */}
            <main className="min-w-0 flex-1 scroll-muted overflow-auto pb-32">
              <MetricSheetProvider>
                <PageTransition>{children}</PageTransition>
              </MetricSheetProvider>
            </main>
          </div>
          <ChatbotPill enabled={aiEnabled} />
          <CommandPaletteHost />
        </div>
      </ChatbotContextProvider>
    </NotificationModalHost>
  );
}
