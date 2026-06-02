"use client";

import { useState, useTransition } from "react";
import { Settings2, X } from "lucide-react";
import { toast } from "sonner";

import {
  CenterModal,
  CenterModalBody,
  CenterModalFooter,
} from "@/components/ui/center-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  type AutoRuleMatchKind,
  type AutoRuleRow,
  createAutoRule,
  deleteAutoRule,
  toggleAutoRule,
} from "@/lib/sadaka/auto-rules";

// AUTO-RULES (S): active rule count, tap to manage in a center modal.

type Props = {
  initialRules: AutoRuleRow[];
};

const MATCH_LABELS: Record<AutoRuleMatchKind, string> = {
  vendor_pattern: "Vendor matches",
  category: "Category matches",
  note_pattern: "Note contains",
  denylist_note: "Suppress when note contains",
};

export function SadakaAutoRules({ initialRules }: Props) {
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState<AutoRuleRow[]>(initialRules);
  const [newKind, setNewKind] = useState<AutoRuleMatchKind>("vendor_pattern");
  const [newPattern, setNewPattern] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [pending, start] = useTransition();
  const active = rules.filter((r) => r.active).length;

  function refresh(next: AutoRuleRow[]) {
    setRules(next);
  }

  function add() {
    if (!newPattern.trim()) {
      toast.error("Pattern can't be empty.");
      return;
    }
    start(async () => {
      const res = await createAutoRule({
        match_kind: newKind,
        pattern: newPattern.trim(),
        label: newLabel.trim() || null,
      });
      if (!res.ok) {
        toast.error(res.error || "Couldn't save the rule.");
        return;
      }
      refresh([
        ...rules,
        {
          id: res.data.id,
          user_id: "",
          match_kind: newKind,
          pattern: newPattern.trim(),
          active: true,
          label: newLabel.trim() || null,
          created_at: new Date().toISOString(),
        },
      ]);
      setNewPattern("");
      setNewLabel("");
      toast.success("Rule added.");
    });
  }

  function onToggle(id: string, next: boolean) {
    start(async () => {
      const res = await toggleAutoRule(id, next);
      if (!res.ok) {
        toast.error(res.error || "Couldn't toggle the rule.");
        return;
      }
      refresh(rules.map((r) => (r.id === id ? { ...r, active: next } : r)));
    });
  }

  function onDelete(id: string) {
    start(async () => {
      const res = await deleteAutoRule(id);
      if (!res.ok) {
        toast.error(res.error || "Couldn't delete the rule.");
        return;
      }
      refresh(rules.filter((r) => r.id !== id));
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-slot="card"
        className="group relative flex aspect-square w-full min-h-[160px] flex-col justify-between rounded-xl bg-card p-4 text-left ring-1 ring-foreground/10 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_8px_20px_-8px_oklch(0_0_0/0.12)]"
      >
        <div className="flex items-start justify-between">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-foreground/[0.04] text-foreground/70">
            <Settings2 className="h-4 w-4" />
          </div>
        </div>
        <div className="space-y-1">
          <div className="display-headline text-[28px] leading-none tabular-nums text-foreground">
            {active}
          </div>
          <div className="text-[11px] leading-tight text-muted-foreground">
            {active === 1 ? "auto-rule active" : "auto-rules active"}
          </div>
        </div>
      </button>

      <CenterModal
        open={open}
        onOpenChange={setOpen}
        title="Sadaka auto-rules"
        description="Pattern matches turn matching spends into auto-detected sadaka entries."
        size="lg"
      >
        <CenterModalBody>
          <div className="grid gap-4">
            <div className="space-y-2 rounded-md border border-border/60 p-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                New rule
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Match kind</Label>
                  <Select
                    value={newKind}
                    onValueChange={(v) => v && setNewKind(v as AutoRuleMatchKind)}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="vendor_pattern">Vendor pattern</SelectItem>
                      <SelectItem value="category">Category name</SelectItem>
                      <SelectItem value="note_pattern">Note pattern</SelectItem>
                      <SelectItem value="denylist_note">Denylist note</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Label (optional)</Label>
                  <Input
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder="What it is"
                    className="h-8 text-sm"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Pattern</Label>
                <Input
                  value={newPattern}
                  onChange={(e) => setNewPattern(e.target.value)}
                  placeholder="A token or phrase to match"
                  className="h-8 text-sm"
                />
              </div>
              <div className="flex justify-end">
                <Button size="sm" onClick={add} disabled={pending}>
                  Add rule
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Existing rules
              </div>
              {rules.length === 0 && (
                <div className="text-[11.5px] text-muted-foreground">No rules yet.</div>
              )}
              {rules.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-2 border-b border-border/30 pb-2 last:border-b-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <div className="text-[11.5px] font-medium text-foreground">
                      {r.label ?? r.pattern}
                    </div>
                    <div className="truncate text-[10.5px] text-muted-foreground">
                      {MATCH_LABELS[r.match_kind]} · {r.pattern}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={r.active}
                      onCheckedChange={(v) => onToggle(r.id, v)}
                    />
                    <button
                      type="button"
                      onClick={() => onDelete(r.id)}
                      className="rounded-md border border-border/60 p-1 text-muted-foreground hover:bg-muted/40"
                      title="Delete"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CenterModalBody>
        <CenterModalFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
        </CenterModalFooter>
      </CenterModal>
    </>
  );
}
