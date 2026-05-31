"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { phtToday } from "@/lib/utils";

export function DataForm() {
  const [pending, setPending] = useState(false);

  async function onDownload() {
    setPending(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const [clients, projects, payments, invoices, settings, rates, categories, templates] =
        await Promise.all([
          supabase.from("clients").select("*").eq("user_id", user.id),
          supabase.from("projects").select("*").eq("user_id", user.id),
          supabase.from("payments").select("*").eq("user_id", user.id),
          supabase.from("invoices").select("*").eq("user_id", user.id),
          supabase.from("settings").select("*").eq("user_id", user.id).maybeSingle(),
          supabase.from("exchange_rates").select("*").eq("user_id", user.id),
          supabase.from("categories").select("*").eq("user_id", user.id),
          supabase.from("project_templates").select("*").eq("user_id", user.id),
        ]);

      const backup = {
        app: "freelane",
        schema_version: 1,
        exported_at: new Date().toISOString(),
        user_id: user.id,
        settings: settings.data ?? null,
        exchange_rates: rates.data ?? [],
        categories: categories.data ?? [],
        clients: clients.data ?? [],
        projects: projects.data ?? [],
        payments: payments.data ?? [],
        invoices: invoices.data ?? [],
        project_templates: templates.data ?? [],
      };

      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = phtToday();
      a.download = `freelane-backup-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      const totalRows =
        (clients.data?.length ?? 0) +
        (projects.data?.length ?? 0) +
        (payments.data?.length ?? 0) +
        (invoices.data?.length ?? 0);
      toast.success(`Backup downloaded · ${totalRows} records`);
    } catch (err: unknown) {
      toast.error((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="text-sm text-muted-foreground">
        Exports every client, project, payment, invoice, template, and setting as a
        single JSON file. Keep one somewhere safe.
      </div>
      <Button onClick={onDownload} disabled={pending} variant="outline">
        <Download className="mr-1.5 h-4 w-4" />
        {pending ? "Preparing…" : "Download backup"}
      </Button>
    </div>
  );
}
