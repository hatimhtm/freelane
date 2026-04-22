import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import { SidebarNav } from "@/components/app/sidebar-nav";
import { TopBar } from "@/components/app/top-bar";
import { PageTransition } from "@/components/app/page-transition";
import { BackgroundOrbs } from "@/components/app/background-orbs";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  return (
    <div className="relative flex min-h-dvh bg-background">
      <BackgroundOrbs />
      <SidebarNav />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 scroll-muted overflow-auto">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
  );
}
