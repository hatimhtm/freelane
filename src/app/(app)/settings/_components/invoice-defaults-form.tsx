"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { updateSettings } from "@/lib/data/actions";
import type { Settings } from "@/lib/supabase/types";

export function InvoiceDefaultsForm({ settings }: { settings: Settings | null }) {
  const [state, setState] = useState({
    invoice_number_format: settings?.invoice_number_format ?? "YYYY-NNN",
    invoice_show_tva_note: settings?.invoice_show_tva_note ?? true,
    invoice_tva_note: settings?.invoice_tva_note ?? "TVA non applicable (Freelance sans statut)",
    invoice_footer: settings?.invoice_footer ?? "Merci pour votre confiance !",
    invoice_language: settings?.invoice_language ?? "fr",
  });
  const [pending, start] = useTransition();

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    start(async () => {
      try {
        await updateSettings(state);
        toast.success("Defaults saved");
      } catch (err: unknown) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Invoice number format">
          <Input
            value={state.invoice_number_format}
            onChange={(e) => setState((s) => ({ ...s, invoice_number_format: e.target.value }))}
            placeholder="YYYY-NNN"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Use <code>YYYY</code> for year, <code>NNN</code> for a zero-padded sequence.
          </p>
        </Field>
        <Field label="Invoice language">
          <Input
            value={state.invoice_language}
            onChange={(e) => setState((s) => ({ ...s, invoice_language: e.target.value }))}
            placeholder="fr"
          />
        </Field>
      </div>

      <div className="flex items-start justify-between rounded-xl border border-border/60 bg-muted/30 p-4">
        <div>
          <div className="text-sm font-medium">Show TVA note</div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Append a VAT exemption line under the total.
          </p>
        </div>
        <Switch
          checked={state.invoice_show_tva_note}
          onCheckedChange={(v) => setState((s) => ({ ...s, invoice_show_tva_note: v }))}
        />
      </div>

      {state.invoice_show_tva_note && (
        <Field label="TVA note">
          <Input
            value={state.invoice_tva_note}
            onChange={(e) => setState((s) => ({ ...s, invoice_tva_note: e.target.value }))}
          />
        </Field>
      )}

      <Field label="Footer">
        <Textarea
          rows={2}
          value={state.invoice_footer}
          onChange={(e) => setState((s) => ({ ...s, invoice_footer: e.target.value }))}
        />
      </Field>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save defaults"}
        </Button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
