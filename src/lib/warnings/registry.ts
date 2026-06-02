// Freelane warnings registry (Phase 1.5).
//
// Replaces dedicated full-card warning surfaces (CalmWeatherBanner /
// NegativeWalletAlarm / TightModeCoach being stacked above widgets) with
// inline pills attached to each widget's bottom slot.
//
// Each kind exports a resolve(ctx) that returns { active, message,
// detailHref? }. The dashboard data fan-out runs each resolver, then the
// per-widget renderers consult the result by key.
//
// CENTRAL DISPATCHER: resolveAllWarnings() runs each per-kind resolver in
// one pass so the dashboard data layer is one call, not four. Per-kind
// resolvers are still exported individually for callers that only need
// one slice (e.g. dashboard-data already iterates wallets via
// resolveWalletAnchorStale).

import type { HoldingBalanceRow } from "@/lib/payment-chain";

export const WARNING_KINDS = [
  "wallet_anchor_stale",
  "period_ending_soon",
  "recovery_off_track",
  "sadaka_pool_overdue",
] as const;

export type WarningKind = (typeof WARNING_KINDS)[number];

export type WarningResult = {
  active: boolean;
  message?: string;
  detailHref?: string;
};

const DAY_MS = 86_400_000;
const STALE_ANCHOR_DAYS = 30;
const PERIOD_ENDING_DAYS = 3;

// ── wallet_anchor_stale ──
// A holding wallet's anchor is older than 30 days AND it is not part of
// the CFG overdraft-tolerance-managed set (CFG bank's allowed-negative is
// intentional and never fires a warning).
export type WalletAnchorStaleCtx = {
  holdings: Array<
    Pick<HoldingBalanceRow, "methodId" | "name"> & {
      anchorSetAt: string | null;
      isOverdraftManaged: boolean;
    }
  >;
  now: Date;
};

export function resolveWalletAnchorStale(
  ctx: WalletAnchorStaleCtx,
): Map<string, WarningResult> {
  const out = new Map<string, WarningResult>();
  const cutoff = ctx.now.getTime() - STALE_ANCHOR_DAYS * DAY_MS;
  for (const h of ctx.holdings) {
    if (h.isOverdraftManaged) {
      out.set(h.methodId, { active: false });
      continue;
    }
    if (!h.anchorSetAt) {
      out.set(h.methodId, {
        active: true,
        message: "No anchor yet",
        detailHref: "/settings",
      });
      continue;
    }
    if (new Date(h.anchorSetAt).getTime() < cutoff) {
      out.set(h.methodId, {
        active: true,
        message: "Anchor over a month old",
        detailHref: "/settings",
      });
    } else {
      out.set(h.methodId, { active: false });
    }
  }
  return out;
}

// ── period_ending_soon ──
// Current period ends in <= 3 days. Drives the Period widget pill on the
// /dashboard/state tab.
export type PeriodEndingSoonCtx = {
  periodEnd: Date | null;
  now: Date;
};

export function resolvePeriodEndingSoon(
  ctx: PeriodEndingSoonCtx,
): WarningResult {
  if (!ctx.periodEnd) return { active: false };
  const days = Math.ceil(
    (ctx.periodEnd.getTime() - ctx.now.getTime()) / DAY_MS,
  );
  if (days < 0 || days > PERIOD_ENDING_DAYS) return { active: false };
  return {
    active: true,
    message:
      days === 0
        ? "Period closes today"
        : days === 1
          ? "Period closes tomorrow"
          : `Period closes in ${days}d`,
  };
}

// ── recovery_off_track ──
// Recovery progress has stalled. The dashboard data fan-out passes a
// `recoveryProgress01` between 0 and 1 + a `recoveryStalled` boolean
// determined from the underlying recovery period table. v1 wires the
// signal through; the math behind `recoveryStalled` lives in the
// existing recovery surface.
export type RecoveryOffTrackCtx = {
  inRecovery: boolean;
  recoveryStalled: boolean;
};

export function resolveRecoveryOffTrack(
  ctx: RecoveryOffTrackCtx,
): WarningResult {
  if (!ctx.inRecovery || !ctx.recoveryStalled) return { active: false };
  return {
    active: true,
    message: "Recovery progress stalled",
  };
}

// ── sadaka_pool_overdue ──
// Active once the Sadaka workflow's pool grows past zero. The detailHref
// '/sadaka' is now a real route. Caller is responsible for reading the
// pool balance via lib/sadaka/ledger.readPoolBalance() and threading the
// number through ctx.poolBase.
export type SadakaPoolOverdueCtx = {
  sadakaWorkflowActive: boolean;
  poolBase: number;
  graceWindowDays: number;
};

export function resolveSadakaPoolOverdue(
  ctx: SadakaPoolOverdueCtx,
): WarningResult {
  if (!ctx.sadakaWorkflowActive) return { active: false };
  if (!(ctx.poolBase > 0)) return { active: false };
  return {
    active: true,
    message: "Sadaka pool past grace window",
    detailHref: "/sadaka",
  };
}

// ── Central dispatcher ──
//
// One-call surface for the dashboard data fan-out. Returns a map keyed by
// WarningKind so adding a new kind is a single append in WARNING_KINDS +
// one branch here, not a four-file diff. Per-wallet kinds
// (wallet_anchor_stale) stay on their dedicated resolver because they
// produce a Map<methodId, WarningResult>; this dispatcher carries the
// scalar kinds only.
export type AllWarningsCtx = {
  periodEnd?: Date | null;
  inRecovery?: boolean;
  recoveryStalled?: boolean;
  sadakaWorkflowActive?: boolean;
  sadakaPoolBase?: number;
  sadakaGraceWindowDays?: number;
  now: Date;
};

export type AllWarningsMap = Partial<Record<WarningKind, WarningResult>>;

export function resolveAllWarnings(ctx: AllWarningsCtx): AllWarningsMap {
  return {
    period_ending_soon: resolvePeriodEndingSoon({
      periodEnd: ctx.periodEnd ?? null,
      now: ctx.now,
    }),
    recovery_off_track: resolveRecoveryOffTrack({
      inRecovery: !!ctx.inRecovery,
      recoveryStalled: !!ctx.recoveryStalled,
    }),
    sadaka_pool_overdue: resolveSadakaPoolOverdue({
      sadakaWorkflowActive: !!ctx.sadakaWorkflowActive,
      poolBase: Number(ctx.sadakaPoolBase ?? 0),
      graceWindowDays: Number(ctx.sadakaGraceWindowDays ?? 0),
    }),
    // wallet_anchor_stale is per-wallet — caller invokes
    // resolveWalletAnchorStale directly and threads the Map through.
  };
}
