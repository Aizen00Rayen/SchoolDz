import { formatMoney } from "@/lib/format";

/** A money figure for stat cards: large amounts switch to a compact form
 * (1.25M DZD) instead of being cut off, with the exact amount on hover. */
export function Amount({ value, currency, prefix = "", compact = true }) {
  const full = `${prefix}${formatMoney(value, currency)}`;
  return (
    <span title={full} dir="ltr" className="whitespace-nowrap">
      {prefix}{formatMoney(value, currency, { compact })}
    </span>
  );
}

export default Amount;
