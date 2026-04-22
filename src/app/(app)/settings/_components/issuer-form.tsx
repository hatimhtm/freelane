"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateSettings } from "@/lib/data/actions";
import type { Settings } from "@/lib/supabase/types";

export function IssuerForm({ settings }: { settings: Settings | null }) {
  const router = useRouter();
  const [state, setState] = useState({
    issuer_name: settings?.issuer_name ?? "",
    issuer_role: settings?.issuer_role ?? "",
    issuer_email: settings?.issuer_email ?? "",
    issuer_phone: settings?.issuer_phone ?? "",
    issuer_address: settings?.issuer_address ?? "",
    issuer_cin: settings?.issuer_cin ?? "",
  });
  const [pending, start] = useTransition();

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    start(async () => {
      try {
        await updateSettings(state);
        toast.success("Profile saved");
        router.refresh();
      } catch (err: unknown) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Full name">
          <Input
            value={state.issuer_name}
            onChange={(e) => setState((s) => ({ ...s, issuer_name: e.target.value }))}
            placeholder="Hatim El Hassak"
          />
        </Field>
        <Field label="Role / title">
          <Input
            value={state.issuer_role}
            onChange={(e) => setState((s) => ({ ...s, issuer_role: e.target.value }))}
            placeholder="iOS MVP Developer"
          />
        </Field>
        <Field label="Email">
          <Input
            type="email"
            value={state.issuer_email}
            onChange={(e) => setState((s) => ({ ...s, issuer_email: e.target.value }))}
            placeholder="you@example.com"
          />
        </Field>
        <Field label="Phone">
          <Input
            value={state.issuer_phone}
            onChange={(e) => setState((s) => ({ ...s, issuer_phone: e.target.value }))}
            placeholder="+63 …"
          />
        </Field>
      </div>
      <Field label="Address">
        <Textarea
          rows={2}
          value={state.issuer_address}
          onChange={(e) => setState((s) => ({ ...s, issuer_address: e.target.value }))}
          placeholder={"Street\nCity, Country"}
        />
      </Field>
      <Field label="CIN / Tax ID">
        <Input
          value={state.issuer_cin}
          onChange={(e) => setState((s) => ({ ...s, issuer_cin: e.target.value }))}
          placeholder="AB123456"
        />
      </Field>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save profile"}
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
