"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CenterModal,
  CenterModalBody,
  CenterModalFooter,
} from "@/components/ui/center-modal";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createClientRecord, updateClientRecord } from "@/lib/data/actions";
import { extractClientFactsAction } from "@/lib/ai/facts-actions";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import type { ActivityEvent, Client } from "@/lib/supabase/types";

// Debounce window for the notes → facts extraction trigger. Matches the
// design memo (30 seconds of quiescence after the last keystroke). The
// timer resets on every keystroke AND on close/unmount so the brain
// doesn't fire against stale notes after the dialog tears down.
const NOTES_EXTRACT_DEBOUNCE_MS = 30_000;

const CURRENCIES = ["PHP", "MAD", "USD", "EUR", "CNY"];

export function ClientDialog({
  open,
  onOpenChange,
  client,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  client?: Client;
}) {
  const router = useRouter();
  const [state, setState] = useState<Partial<Client>>({});
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [pending, start] = useTransition();
  // Notes debounce — fires extractClientFactsAction 30s after the last
  // keystroke against the notes textarea. The timer lives in a ref so a
  // re-render doesn't churn it; the cleanup runs on unmount + on every
  // re-arm so the brain never fires against stale notes.
  const extractTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    setState(client ?? {});
    if (client) {
      void loadEvents(client.id);
    } else {
      setEvents(null);
    }
  }, [open, client]);

  async function loadEvents(clientId: string) {
    const supabase = createBrowserSupabase();
    const { data } = await supabase
      .from("events")
      .select("*")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(30);
    setEvents((data ?? []) as ActivityEvent[]);
  }

  function update<K extends keyof Client>(key: K, value: Client[K] | null | undefined) {
    setState((prev) => ({ ...prev, [key]: value }));
  }

  // Re-arm the 30s debounce on every notes keystroke. Server action runs
  // fire-and-forget (catch + ignore) so a Gemini outage never blocks the
  // dialog. Server-side, the brain cache fingerprints by hash(notes_text)
  // so re-opening the dialog without edits will hit the cache and skip
  // the Flash Lite call entirely.
  function scheduleFactsExtraction(notesText: string) {
    if (!client?.id) return; // new clients: no id yet — wait for next save.
    if (extractTimer.current) clearTimeout(extractTimer.current);
    extractTimer.current = setTimeout(() => {
      void extractClientFactsAction(client.id, notesText).catch((e) => {
        // Dev-only signal so a Gemini outage / auth lapse is visible in
        // the console. Prod stays quiet — the cache will catch up on
        // the next save and the user shouldn't see a toast for a
        // background-extraction hiccup.
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.warn("[freelane] extract-facts failed", e);
        }
      });
    }, NOTES_EXTRACT_DEBOUNCE_MS);
  }

  useEffect(() => {
    return () => {
      // Cleanup — if the dialog tears down before the 30s elapses the
      // extraction is dropped. Reopening rebuilds from server-loaded
      // notes via the loadEvents effect anyway.
      if (extractTimer.current) clearTimeout(extractTimer.current);
    };
  }, []);

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!state.name?.trim()) {
      toast.error("Name is required");
      return;
    }
    start(async () => {
      try {
        const payload = stripEmpty(state) as { name: string } & Record<string, string>;
        if (client) {
          await updateClientRecord(client.id, payload);
          toast.success("Client updated");
        } else {
          await createClientRecord(payload);
          toast.success("Client added");
        }
        // Cancel the 30s debounce — updateClientRecord / createClientRecord
        // already fired the server-side extraction fallback when notes
        // changed. Without this, a debounce timer scheduled before save
        // would fire 30s later against stale state and re-extract the
        // same notes (the brain cache would catch most repeats, but only
        // if no other client was edited in between).
        if (extractTimer.current) {
          clearTimeout(extractTimer.current);
          extractTimer.current = null;
        }
        onOpenChange(false);
        router.refresh();
      } catch (err: unknown) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <CenterModal
      open={open}
      onOpenChange={onOpenChange}
      title={client ? "Edit client" : "New client"}
      description="Who they are, how they pay, and a line of context for the AI."
      size="lg"
    >
      <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
        <CenterModalBody>
          <div className="grid gap-3">
            <Field label="Name" required>
              <Input
                value={state.name ?? ""}
                onChange={(e) => update("name", e.target.value)}
                placeholder="Acme Corp"
                autoFocus
              />
            </Field>
            <Field label="Company / legal name">
              <Input
                value={state.company ?? ""}
                onChange={(e) => update("company", e.target.value)}
                placeholder="Acme SARL"
              />
            </Field>
            <Field label="Short description">
              <Input
                value={state.short_description ?? ""}
                onChange={(e) => update("short_description", e.target.value)}
                placeholder="Boss · recurring iOS work · pays in CNY, often late"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Email">
                <Input
                  type="email"
                  value={state.email ?? ""}
                  onChange={(e) => update("email", e.target.value)}
                  placeholder="billing@acme.co"
                />
              </Field>
              <Field label="Phone">
                <Input
                  value={state.phone ?? ""}
                  onChange={(e) => update("phone", e.target.value)}
                  placeholder="+1 555…"
                />
              </Field>
            </div>

            <Field label="Default currency">
              <Select
                items={CURRENCIES.map((c) => ({ value: c, label: c }))}
                value={state.default_currency ?? undefined}
                onValueChange={(v) => update("default_currency", v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pick a currency" />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Separator />
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Billing address
            </div>

            <Field label="Street address">
              <Input
                value={state.address ?? ""}
                onChange={(e) => update("address", e.target.value)}
                placeholder="214 Bd Ibnou Sina"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="City">
                <Input
                  value={state.city ?? ""}
                  onChange={(e) => update("city", e.target.value)}
                  placeholder="Casablanca"
                />
              </Field>
              <Field label="Country">
                <Input
                  value={state.country ?? ""}
                  onChange={(e) => update("country", e.target.value)}
                  placeholder="Morocco"
                />
              </Field>
            </div>

            <Separator />
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Legal & tax
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="ICE">
                <Input value={state.ice ?? ""} onChange={(e) => update("ice", e.target.value)} />
              </Field>
              <Field label="RC">
                <Input value={state.rc ?? ""} onChange={(e) => update("rc", e.target.value)} />
              </Field>
            </div>
            <Field label="Tax ID">
              <Input value={state.tax_id ?? ""} onChange={(e) => update("tax_id", e.target.value)} />
            </Field>

            <Separator />
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Bank info (optional)
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Bank name">
                <Input
                  value={state.bank_name ?? ""}
                  onChange={(e) => update("bank_name", e.target.value)}
                />
              </Field>
              <Field label="Account number">
                <Input
                  value={state.bank_account ?? ""}
                  onChange={(e) => update("bank_account", e.target.value)}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="IBAN">
                <Input
                  value={state.iban ?? ""}
                  onChange={(e) => update("iban", e.target.value)}
                />
              </Field>
              <Field label="SWIFT">
                <Input
                  value={state.swift ?? ""}
                  onChange={(e) => update("swift", e.target.value)}
                />
              </Field>
            </div>

            <Separator />
            <Field label="Private notes">
              <Textarea
                value={state.notes ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  update("notes", v);
                  scheduleFactsExtraction(v);
                }}
                rows={2}
                placeholder="Anything worth remembering about this client…"
              />
            </Field>

            {client && events && events.length > 0 && (
              <>
                <Separator />
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Activity
                    </div>
                    <div className="text-[10px] text-muted-foreground/70">
                      Last {events.length}
                    </div>
                  </div>
                  <ol className="relative ml-2 space-y-2.5 border-l border-border/60 pl-4">
                    {events.map((event, i) => (
                      <motion.li
                        key={event.id}
                        initial={{ opacity: 0, x: -4 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.2, delay: i * 0.02 }}
                        className="relative text-sm"
                      >
                        <span className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-[var(--brand)]/60 ring-2 ring-background" />
                        <div className="flex items-baseline justify-between gap-2">
                          <div className="min-w-0 flex-1 truncate">{event.title}</div>
                          <div className="shrink-0 text-xs text-muted-foreground/70 tabular">
                            {new Date(event.created_at).toLocaleDateString(undefined, {
                              day: "numeric",
                              month: "short",
                            })}
                          </div>
                        </div>
                      </motion.li>
                    ))}
                  </ol>
                </div>
              </>
            )}
          </div>
        </CenterModalBody>
        <CenterModalFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : client ? "Save changes" : "Add client"}
          </Button>
        </CenterModalFooter>
      </form>
    </CenterModal>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
    </div>
  );
}

function stripEmpty<T extends Record<string, unknown>>(obj: T): T {
  const out = {} as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (v === "" || v === null || v === undefined) continue;
    out[k] = v;
  }
  return out as T;
}
