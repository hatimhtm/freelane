import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SidebarNav } from "@/components/app/sidebar-nav";
import { TopBar } from "@/components/app/top-bar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-dvh bg-background">
      <SidebarNav />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 scroll-muted overflow-auto">{children}</main>
      </div>
    </div>
  );
}
