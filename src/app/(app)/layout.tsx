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

  return (
    <NotificationModalHost>
      <ChatbotContextProvider>
        <div className="relative flex min-h-dvh bg-background">
          <BackgroundOrbs />
          <FxAutoRefresh />
          <ServiceWorkerRegistrar enabled={pushEnabled} />
          <NotificationLinkInterceptor />
          <SidebarNav />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar />
            <main className="min-w-0 flex-1 scroll-muted overflow-auto">
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
