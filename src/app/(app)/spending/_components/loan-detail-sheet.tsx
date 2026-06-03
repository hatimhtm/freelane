"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CenterModal, CenterModalBody } from "@/components/ui/center-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/money";
import {
  fetchLoanDetail,
  recordLoanReturn,
  forgiveLoan,
  writeOffLoan,
  type LoanDetailPayload,
} from "@/lib/loans/actions";
import { loanStatusLabel, normalizeDirection } from "@/lib/loans/direction";
import { WalletPickerWithBalance } from "@/components/app/wallet-picker";
import type { CurrencyCode } from "@/lib/supabase/types";
import type { WalletOpt } from "./spend-modal";

// Loans workflow — bottom-of-list loan detail sheet. Center modal with:
//   - Hero: principal + status pill + counterparty entity (link to
//     /clients/people/[id] when available).
//   - Origin / return wallet labels.
//   - Returns timeline (newest first).
//   - Actions:
//       [Record return]  — opens an inline form (amount + wallet + note)
//       [Forgive]        — given-only; opens a confirm modal flagging the
//                          Sadaka conversion.
//       [Write off]      — received-only; flags the debt as uncollectible.
//
// The sheet hydrates lazily via fetchLoanDetail so a deep-link or row
// tap doesn't pay for an extra round-trip when the spending list
// renders.

type Mode = "view" | "record_return" | "forgive_confirm" | "write_off_confirm";

export function LoanDetailSheet({
  loanId,
  wallets,
  baseCurrency,
  onClose,
}: {
  loanId: string;
  wallets: WalletOpt[];
  baseCurrency: CurrencyCode;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [detail, setDetail] = useState<LoanDetailPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("view");
  const [pending, start] = useTransition();

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setDetail(null);
    (async () => {
      const res = await fetchLoanDetail(loanId);
      if (cancelled) return;
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDetail(res.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [loanId]);

  function close(refresh: boolean) {
    setOpen(false);
    // CenterModal honours the onOpenChange callback below.
    if (refresh) onClose();
  }

  function reload() {
    start(async () => {
      const res = await fetchLoanDetail(loanId);
      if (res.ok) setDetail(res.data);
    });
  }

  return (
    <CenterModal
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) onClose();
      }}
      title="Loan detail"
      description={detail ? null : "Loading…"}
      size="lg"
      className="sm:max-w-[560px]"
    >
      <CenterModalBody>
        {error && (
          <p className="mb-3 border-l-2 border-[var(--overdue)] bg-muted/30 px-3 py-2 text-xs leading-relaxed text-foreground/80">
            {error}
          </p>
        )}
        {!detail && !error && (
          <p className="py-6 text-center text-xs text-muted-foreground">
            Loading loan…
          </p>
        )}
        {detail && (
          <LoanDetailBody
            detail={detail}
            wallets={wallets}
            baseCurrency={baseCurrency}
            mode={mode}
            setMode={setMode}
            pending={pending}
            start={start}
            onMutated={reload}
            onClose={() => close(true)}
          />
        )}
      </CenterModalBody>
    </CenterModal>
  );
}

function LoanDetailBody({
  detail,
  wallets,
  baseCurrency,
  mode,
  setMode,
  pending,
  start,
  onMutated,
  onClose,
}: {
  detail: LoanDetailPayload;
  wallets: WalletOpt[];
  baseCurrency: CurrencyCode;
  mode: Mode;
  setMode: (m: Mode) => void;
  pending: boolean;
  start: (fn: () => Promise<void> | void) => void;
  onMutated: () => void;
  onClose: () => void;
}) {
  const { loan, returns, returnedBase, outstandingBase, counterparty } = detail;
  const dir = normalizeDirection(loan.direction) ?? "given";
  const isOpen =
    loan.status === "open" ||
    loan.status === "partial" ||
    loan.status === "partially_returned";
  const walletNameById = new Map(wallets.map((w) => [w.id, w.name]));

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <div className="display-eyebrow text-muted-foreground">
          {dir === "given" ? "You lent" : "You borrowed"}
        </div>
        <div className="flex items-baseline gap-3">
          <span className="font-display text-2xl tabular text-foreground">
            {formatMoney(Number(loan.principal_base), baseCurrency)}
          </span>
          <StatusPill status={loan.status} />
        </div>
        {counterparty && (
          <Link
            href={`/clients/people/${counterparty.id}`}
            className="text-[12px] text-foreground/85 transition-colors hover:text-foreground"
          >
            {counterparty.canonical_name}
            {counterparty.relationship && (
              <span className="text-muted-foreground"> · {counterparty.relationship}</span>
            )}
          </Link>
        )}
        {loan.due_date && (
          <span className="text-[11px] text-muted-foreground">
            Due {loan.due_date}
          </span>
        )}
      </header>

      <section className="flex flex-col gap-1 text-[12px] text-foreground/80">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-muted-foreground">Returned</span>
          <span className="tabular">
            {formatMoney(returnedBase, baseCurrency)}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-muted-foreground">Outstanding</span>
          <span className="tabular font-medium">
            {formatMoney(outstandingBase, baseCurrency)}
          </span>
        </div>
        {loan.origin_wallet_id && (
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-muted-foreground">Origin wallet</span>
            <span>{walletNameById.get(loan.origin_wallet_id) ?? "—"}</span>
          </div>
        )}
        {loan.notes && (
          <p className="mt-1 whitespace-pre-wrap text-[12px] text-muted-foreground">
            {loan.notes}
          </p>
        )}
      </section>

      {returns.length > 0 && (
        <section>
          <h3 className="display-eyebrow mb-1 text-muted-foreground">Returns</h3>
          <ul className="divide-y divide-border/40 overflow-hidden rounded-lg border border-border/60">
            {returns.map((r) => (
              <li
                key={r.id}
                className="flex items-baseline justify-between gap-2 px-3 py-2 text-[12.5px]"
              >
                <div className="flex flex-col">
                  <span className="text-foreground/85">
                    {new Date(r.returned_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                  {r.return_wallet_id && (
                    <span className="text-[10.5px] text-muted-foreground">
                      via {walletNameById.get(r.return_wallet_id) ?? "—"}
                    </span>
                  )}
                  {r.notes && (
                    <span className="text-[11px] italic text-muted-foreground">
                      {r.notes}
                    </span>
                  )}
                </div>
                <span className="tabular text-foreground/85">
                  {formatMoney(Number(r.amount_base), baseCurrency)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {mode === "view" && isOpen && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => setMode("record_return")}
          >
            Record return
          </Button>
          {dir === "given" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setMode("forgive_confirm")}
            >
              Forgive
            </Button>
          )}
          {dir === "received" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setMode("write_off_confirm")}
            >
              Write off
            </Button>
          )}
        </div>
      )}

      {mode === "record_return" && (
        <RecordReturnForm
          loanId={loan.id}
          wallets={wallets}
          baseCurrency={baseCurrency}
          maxBase={outstandingBase}
          pending={pending}
          onCancel={() => setMode("view")}
          onSaved={() => {
            setMode("view");
            onMutated();
          }}
          start={start}
        />
      )}

      {mode === "forgive_confirm" && (
        <ForgiveConfirm
          loanId={loan.id}
          outstandingBase={outstandingBase}
          baseCurrency={baseCurrency}
          pending={pending}
          start={start}
          onCancel={() => setMode("view")}
          onForgiven={() => {
            toast.success("Loan forgiven — added to sadaka pool.");
            onClose();
          }}
        />
      )}

      {mode === "write_off_confirm" && (
        <WriteOffConfirm
          loanId={loan.id}
          pending={pending}
          start={start}
          onCancel={() => setMode("view")}
          onWrittenOff={() => {
            toast.success("Loan written off.");
            onClose();
          }}
        />
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  // Shared label helper — keeps the badge in the spending list and this
  // pill on the same copy. Capitalize the first letter here for the pill
  // tone (lowercase elsewhere); the source helper stays uppercase-free.
  const raw = loanStatusLabel(status);
  const label = raw.charAt(0).toUpperCase() + raw.slice(1);
  return (
    <span className="rounded-full border border-foreground/15 bg-foreground/[0.04] px-2 py-px text-[10px] font-medium uppercase tracking-wider text-foreground/70">
      {label}
    </span>
  );
}

function RecordReturnForm({
  loanId,
  wallets,
  baseCurrency,
  maxBase,
  pending,
  onCancel,
  onSaved,
  start,
}: {
  loanId: string;
  wallets: WalletOpt[];
  baseCurrency: CurrencyCode;
  maxBase: number;
  pending: boolean;
  onCancel: () => void;
  onSaved: () => void;
  start: (fn: () => Promise<void> | void) => void;
}) {
  const [amount, setAmount] = useState<string>("");
  const [walletId, setWalletId] = useState<string>(
    wallets.find((w) => w.is_holding)?.id ?? wallets[0]?.id ?? "",
  );
  const [notes, setNotes] = useState<string>("");

  // Adapt WalletOpt into the shape WalletPickerWithBalance expects so the
  // return form inherits the same brand glyph + inline balance affordance
  // as the rest of the app's wallet pickers.
  const walletOptions = useMemo(
    () =>
      wallets.map((w) => ({
        id: w.id,
        name: w.name,
        brandKey: (w as WalletOpt & { brandKey?: string | null }).brandKey ?? null,
      })),
    [wallets],
  );
  const walletBalances = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of wallets) {
      if (typeof w.balanceBase === "number") m.set(w.id, w.balanceBase);
    }
    return m;
  }, [wallets]);
  const walletStatuses = useMemo(() => {
    const m = new Map<
      string,
      "positive" | "within_tolerance" | "over_overdraft"
    >();
    for (const w of wallets) {
      if (w.status) m.set(w.id, w.status);
    }
    return m;
  }, [wallets]);

  const submit = () => {
    const value = Math.round(Number(amount) * 100) / 100;
    if (!(value > 0)) {
      toast.error("Enter a return amount.");
      return;
    }
    if (!walletId) {
      toast.error("Pick a wallet.");
      return;
    }
    start(async () => {
      const res = await recordLoanReturn({
        loan_id: loanId,
        amount_base: value,
        return_wallet_id: walletId,
        notes: notes.trim() || null,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Return recorded.");
      onSaved();
    });
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-card/50 p-3">
      <div className="display-eyebrow text-muted-foreground">Record return</div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          Amount ({baseCurrency})
          <Input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={maxBase ? maxBase.toFixed(2) : "0.00"}
            className="h-9 tabular"
          />
        </label>
        <div className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          <span>Wallet</span>
          <WalletPickerWithBalance
            value={walletId}
            onValueChange={(v) => v && setWalletId(v)}
            methods={walletOptions}
            balances={walletBalances}
            statuses={walletStatuses}
            baseCurrency={baseCurrency}
            placeholder="Pick a wallet"
            size="sm"
          />
        </div>
      </div>
      <Textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (optional)"
        rows={2}
        className="min-h-[40px] resize-none text-sm"
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={submit} disabled={pending}>
          {pending ? "Saving…" : "Save return"}
        </Button>
      </div>
    </div>
  );
}

function ForgiveConfirm({
  loanId,
  outstandingBase,
  baseCurrency,
  pending,
  start,
  onCancel,
  onForgiven,
}: {
  loanId: string;
  outstandingBase: number;
  baseCurrency: CurrencyCode;
  pending: boolean;
  start: (fn: () => Promise<void> | void) => void;
  onCancel: () => void;
  onForgiven: () => void;
}) {
  const [reason, setReason] = useState("");
  const submit = () => {
    start(async () => {
      const res = await forgiveLoan({
        loan_id: loanId,
        reason: reason.trim() || null,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      onForgiven();
    });
  };
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-card/50 p-3">
      <p className="text-sm text-foreground/85">
        Forgive the remaining{" "}
        <span className="font-medium tabular">
          {formatMoney(outstandingBase, baseCurrency)}
        </span>{" "}
        and add it to the sadaka pool? The audit trail keeps the conversion
        visible.
      </p>
      <Textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (optional)"
        rows={2}
        className="min-h-[40px] resize-none text-sm"
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={submit} disabled={pending}>
          {pending ? "Forgiving…" : "Forgive into sadaka"}
        </Button>
      </div>
    </div>
  );
}

function WriteOffConfirm({
  loanId,
  pending,
  start,
  onCancel,
  onWrittenOff,
}: {
  loanId: string;
  pending: boolean;
  start: (fn: () => Promise<void> | void) => void;
  onCancel: () => void;
  onWrittenOff: () => void;
}) {
  const [reason, setReason] = useState("");
  const submit = () => {
    start(async () => {
      const res = await writeOffLoan({
        loan_id: loanId,
        reason: reason.trim() || null,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      onWrittenOff();
    });
  };
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-card/50 p-3">
      <p className="text-sm text-foreground/85">
        Mark this loan as written off? Use this when the counterparty
        won't be collecting — no sadaka movement.
      </p>
      <Textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (optional)"
        rows={2}
        className="min-h-[40px] resize-none text-sm"
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={submit} disabled={pending}>
          {pending ? "Saving…" : "Write off"}
        </Button>
      </div>
    </div>
  );
}
