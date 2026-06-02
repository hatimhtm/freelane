import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import { SidebarNav } from "@/components/app/sidebar-nav";
import { TopBar } from "@/components/app/top-bar";
import { PageTransition } from "@/components/app/page-transition";
import { BackgroundOrbs } from "@/components/app/background-orbs";
import { FxAutoRefresh } from "@/components/app/fx-auto-refresh";
import { MetricSheetProvider } from "@/components/app/metric-sheet";
import { AskAiFloating } from "@/components/app/ask-ai-floating";
import { hasGemini } from "@/lib/ai/gemini";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const aiEnabled = hasGemini();

  return (
    <div className="relative flex min-h-dvh bg-background">
      <BackgroundOrbs />
      <FxAutoRefresh />
      <SidebarNav />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-w-0 flex-1 scroll-muted overflow-auto">
          <MetricSheetProvider>
            <PageTransition>{children}</PageTransition>
          </MetricSheetProvider>
        </main>
      </div>
      <AskAiFloating enabled={aiEnabled} />
    </div>
  );
}
