import { formatMoney } from "@/lib/format";

/** A money figure for stat cards: large amounts switch to a compact form
 * (1.25M DZD) instead of being cut off, with the exact amount on hover. */
export function Amount({ value, currency, prefix = "", compact = true }) {
  const full = `${prefix}${formatMoney(value, currency)}`;
  const shown = `${prefix}${formatMoney(value, currency, { compact })}`;
  // Longer figures step down in size so they stay inside narrow cards.
  const size = shown.length > 14 ? "text-sm sm:text-base" : shown.length > 11 ? "text-base sm:text-lg" : "";
  return (
    <span title={full} dir="ltr" className={`inline-block max-w-full whitespace-nowrap ${size}`}>
      {shown}
    </span>
  );
}

export default Amount;
