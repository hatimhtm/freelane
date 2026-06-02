"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MethodGlyph } from "@/components/brand/method-glyph";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { SWidget } from "@/components/widgets/s-widget";
import { NumberHero } from "@/components/widgets/number-hero";
import { WarningPill } from "@/components/widgets/warning-pill";
import type { HoldingBalanceRow } from "@/lib/payment-chain";
import type { WarningResult } from "@/lib/warnings/registry";

// /dashboard/money — wallet stack rendered as a SortableGrid of S widgets,
// one per holding wallet. Order persists per-browser via localStorage keyed
// on the user's wallet-id roster — drag a wallet to reorder, the page
// restores the order on next load. New wallets that aren't in the saved
// order list fall through to the natural data-fan-out order (server's idea
// of canonical), so the user never loses a wallet to a stale localStorage
// key.
//
// Warning props carry the FULL WarningResult per wallet (message + the
// detailHref the resolver decided on). The previous Set<string> shape
// dropped the per-wallet message — both "No anchor yet" and "Anchor over
// a month old" appeared identical — and the pill was non-tappable.

type Props = {
  holdings: HoldingBalanceRow[];
  staleWalletWarnings: Map<string, WarningResult>;
};

const STORAGE_KEY = "freelane:dashboard:wallet-order:v1";

function loadSavedOrder(): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return null;
  }
}

function persistOrder(ids: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Quota or disabled storage — best effort.
  }
}

// Reconcile saved order against the live roster: keep saved-then-known ids
// in their saved positions, then append any new wallets the user hasn't
// seen yet in server order, and drop any saved ids that no longer exist.
function reconcileOrder(savedOrder: string[] | null, liveIds: string[]): string[] {
  const live = new Set(liveIds);
  const seen = new Set<string>();
  const result: string[] = [];
  if (savedOrder) {
    for (const id of savedOrder) {
      if (live.has(id) && !seen.has(id)) {
        result.push(id);
        seen.add(id);
      }
    }
  }
  for (const id of liveIds) {
    if (!seen.has(id)) {
      result.push(id);
      seen.add(id);
    }
  }
  return result;
}

export function WalletStack({ holdings, staleWalletWarnings }: Props) {
  const router = useRouter();
  const liveIds = useMemo(() => holdings.map((h) => h.methodId), [holdings]);
  const byId = useMemo(() => {
    const m = new Map<string, HoldingBalanceRow>();
    for (const h of holdings) m.set(h.methodId, h);
    return m;
  }, [holdings]);

  // Start with server order — read from localStorage in an effect so SSR
  // markup is deterministic. On mount we reconcile and the visual order
  // settles in one paint.
  const [orderedIds, setOrderedIds] = useState<string[]>(liveIds);

  useEffect(() => {
    const saved = loadSavedOrder();
    setOrderedIds(reconcileOrder(saved, liveIds));
  }, [liveIds]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = orderedIds.indexOf(String(active.id));
    const to = orderedIds.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = arrayMove(orderedIds, from, to);
    setOrderedIds(next);
    persistOrder(next);
  }

  if (holdings.length === 0) return null;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={orderedIds} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {orderedIds.map((id) => {
            const h = byId.get(id);
            if (!h) return null;
            const warning = staleWalletWarnings.get(h.methodId);
            const tone: "default" | "terracotta" | "rose" =
              h.status === "over_overdraft"
                ? "rose"
                : h.status === "within_tolerance"
                  ? "terracotta"
                  : "default";
            return (
              <SortableWalletCell
                key={h.methodId}
                id={h.methodId}
                holding={h}
                tone={tone}
                warning={warning}
                onOpen={() => router.push("/settings")}
              />
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}

type CellProps = {
  id: string;
  holding: HoldingBalanceRow;
  tone: "default" | "terracotta" | "rose";
  warning: WarningResult | undefined;
  onOpen: () => void;
};

function SortableWalletCell({ id, holding, tone, warning, onOpen }: CellProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    // Drag interactions read from the whole card; the SWidget's internal
    // onClick (router.push) still fires when there is no drag motion thanks
    // to PointerSensor's activationConstraint distance:6.
    cursor: isDragging ? "grabbing" : undefined,
  } as const;
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <SWidget
        label={holding.name}
        tone={tone}
        icon={
          <MethodGlyph
            name={holding.name}
            brandKey={holding.brandKey ?? null}
            className="h-5 w-5"
          />
        }
        hero={<NumberHero value={Math.round(holding.balance)} maximumFractionDigits={0} />}
        sub={<span>{holding.name}</span>}
        warning={
          warning?.active ? (
            <WarningPill
              detailHref={warning.detailHref ?? "/settings"}
              ariaLabel={
                warning.message
                  ? `${holding.name}: ${warning.message}`
                  : `${holding.name} needs attention`
              }
            >
              {warning.message ?? "Needs attention"}
            </WarningPill>
          ) : undefined
        }
        aiDot={{
          key: `money.wallet.${holding.methodId}`,
          label: holding.name,
          data: { balance: holding.balance, status: holding.status },
        }}
        onOpen={onOpen}
      />
    </div>
  );
}
