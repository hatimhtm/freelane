"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CenterModal, CenterModalBody, CenterModalFooter } from "@/components/ui/center-modal";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMoney } from "@/lib/money";
import { archiveEntity, createEntity } from "@/lib/data/actions";
import { cn } from "@/lib/utils";
import type {
  CurrencyCode,
  Entity,
  Spend,
  SpendEntityLink,
} from "@/lib/supabase/types";

const ENTITY_KINDS = [
  "person",
  "pet",
  "place",
  "household",
  "concept",
  "habit",
  "ritual",
] as const;

interface EntitiesViewProps {
  entities: Entity[];
  links: SpendEntityLink[];
  spends: Spend[];
  baseCurrency: CurrencyCode;
}

export function EntitiesView({ entities, links, spends, baseCurrency }: EntitiesViewProps) {
  const [createOpen, setCreateOpen] = useState(false);

  const totalsByEntity = useMemo(() => {
    const m = new Map<string, number>();
    const spendById = new Map(spends.map((s) => [s.id, s] as const));
    for (const l of links) {
      const sp = spendById.get(l.spend_id);
      if (!sp) continue;
      m.set(l.entity_id, (m.get(l.entity_id) ?? 0) + Number(sp.amount_base ?? 0));
    }
    return m;
  }, [links, spends]);

  const countByEntity = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of links) m.set(l.entity_id, (m.get(l.entity_id) ?? 0) + 1);
    return m;
  }, [links]);

  const grouped = useMemo(() => groupByKind(entities), [entities]);

  return (
    <div className="mx-auto flex max-w-[1080px] flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="font-display text-lg leading-tight">Entities</h1>
          <p className="text-xs text-muted-foreground">
            People, pets, places, concepts the AI tracks across your life.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="h-8 gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          New entity
        </Button>
      </header>

      {Object.entries(grouped).map(([kind, list]) => (
        <section key={kind} className="flex flex-col gap-2">
          <h2 className="font-display text-sm font-medium capitalize">{kind}</h2>
          <ul className="flex flex-col divide-y divide-border/40 rounded-[10px] border border-border/50 bg-card/30">
            {list.map((e) => (
              <EntityRow
                key={e.id}
                entity={e}
                totalBase={totalsByEntity.get(e.id) ?? 0}
                count={countByEntity.get(e.id) ?? 0}
                baseCurrency={baseCurrency}
              />
            ))}
          </ul>
        </section>
      ))}

      <CreateEntityModal open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function groupByKind(entities: Entity[]): Record<string, Entity[]> {
  const out: Record<string, Entity[]> = {};
  for (const e of entities.filter((x) => !x.archived)) {
    const k = e.kind || "other";
    if (!out[k]) out[k] = [];
    out[k].push(e);
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.canonical_name.localeCompare(b.canonical_name));
  return out;
}

function EntityRow({
  entity,
  totalBase,
  count,
  baseCurrency,
}: {
  entity: Entity;
  totalBase: number;
  count: number;
  baseCurrency: CurrencyCode;
}) {
  const router = useRouter();
  return (
    <li className="grid grid-cols-[1fr_auto] items-baseline gap-3 px-3 py-2.5 hover:bg-muted/40">
      <Link href={`/entities/${entity.id}`} className="block min-w-0">
        <div className="flex flex-wrap items-baseline gap-1.5">
          <span className="text-sm font-medium text-foreground">{entity.canonical_name}</span>
          {entity.vague && (
            <span className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              vague
            </span>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {count > 0 ? `${count} spends · ${formatMoney(totalBase, baseCurrency, { compact: true })}` : "no linked spends yet"}
          {entity.short_description && ` · ${entity.short_description.slice(0, 70)}`}
        </div>
      </Link>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={async () => {
          try {
            await archiveEntity(entity.id, !entity.archived);
            toast.success(entity.archived ? "Restored" : "Archived");
            router.refresh();
          } catch (err) {
            toast.error((err as Error).message);
          }
        }}
        aria-label={`${entity.archived ? "Restore" : "Archive"} entity ${entity.canonical_name}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </li>
  );
}

function CreateEntityModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<(typeof ENTITY_KINDS)[number]>("person");
  const [name, setName] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [vague, setVague] = useState(false);
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);

  async function save() {
    if (!name.trim()) return;
    setPending(true);
    try {
      await createEntity({
        kind,
        canonical_name: name.trim(),
        short_description: shortDescription.trim() || null,
        vague,
        notes: notes.trim() || null,
      });
      toast.success(`Added ${name.trim()}`);
      setName("");
      setShortDescription("");
      setNotes("");
      setVague(false);
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <CenterModal
      open={open}
      onOpenChange={onOpenChange}
      title="New entity"
      description="A person, pet, place, or concept the AI should remember."
      size="md"
    >
      <CenterModalBody>
        <div className="grid gap-3">
          <div className="grid grid-cols-[1fr_180px] gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Canonical name
              </Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Lola, Our cats, Carinderia near terminal"
                className="h-9 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Kind</Label>
              <Select items={ENTITY_KINDS.map((k) => ({ value: k, label: k }))} value={kind} onValueChange={(v) => v && setKind(v as (typeof ENTITY_KINDS)[number])}>
                <SelectTrigger className="h-9 text-sm capitalize">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENTITY_KINDS.map((k) => (
                    <SelectItem key={k} value={k} className="capitalize">{k}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Short description
            </Label>
            <Input
              value={shortDescription}
              onChange={(e) => setShortDescription(e.target.value)}
              placeholder="Grandmother. Buys gifts for her around holidays."
              className="h-9 text-sm"
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-xs font-medium">Vague entity</span>
              <span className="text-[10px] text-muted-foreground">No canonical name yet — keep it fuzzy.</span>
            </div>
            <Switch checked={vague} onCheckedChange={setVague} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Notes <span className="ml-1 normal-case tracking-normal text-muted-foreground/60">optional</span>
            </Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything worth remembering"
              rows={3}
              className="resize-none text-sm"
            />
          </div>
        </div>
      </CenterModalBody>
      <CenterModalFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={save} disabled={pending || !name.trim()}>
          {pending ? "Saving…" : "Add entity"}
        </Button>
      </CenterModalFooter>
    </CenterModal>
  );
}

// cn unused export to satisfy import (kept for future styling tweaks)
void cn;
