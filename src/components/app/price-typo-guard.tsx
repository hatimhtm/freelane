import { formatMoney } from "@/lib/money";
import type { PriceSanityResult } from "@/lib/ai/price-sanity";

interface PriceTypoGuardProps {
  result: PriceSanityResult;
  onApplyFix: (suggestedAmount: number) => void;
}

export function PriceTypoGuard({ result, onApplyFix }: PriceTypoGuardProps) {
  const { status, suggestedAmount, comparison } = result;

  if (status === "ok") return null;
  if (status === "low" && suggestedAmount === undefined) return null;

  const typical = comparison?.median;
  const suggestion = suggestedAmount;

  const warm = status === "high" || status === "very_high" || status === "impossible";

  return (
    <p
      role="status"
      aria-live="polite"
      className={
        "mt-2 text-xs leading-relaxed tabular " +
        (warm ? "text-[var(--overdue)]/85" : "text-ink/55")
      }
    >
      {typical !== undefined && typical > 0 ? (
        <>Usually {formatMoney(typical, "PHP", { compact: true })} here.</>
      ) : (
        <>That looks off for this spot.</>
      )}
      {suggestion !== undefined && (
        <>
          {" "}
          Did you mean{" "}
          <button
            type="button"
            onClick={() => onApplyFix(suggestion)}
            className="underline decoration-dotted decoration-from-font underline-offset-[3px] text-ink transition-colors duration-300 ease-out hover:text-ink/70 focus-visible:outline-none focus-visible:text-ink/70"
          >
            {formatMoney(suggestion, "PHP", { compact: true })}
          </button>
          ?
        </>
      )}
    </p>
  );
}
