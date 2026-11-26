/*
 * "120 sold": units sold on delivered orders (less approved returns), as the API counts them.
 * Nothing is shown until something has really sold, and never an estimate. Large figures are
 * abbreviated ("1.2k") so the label stays one short line on a product card.
 */

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/** The label text, or null when there is nothing honest to say. */
export function soldCountLabel(count: number | undefined): string | null {
  if (count === undefined || !Number.isFinite(count) || count < 1) return null;
  return `${count < 1000 ? String(Math.trunc(count)) : compact.format(count).toLowerCase()} sold`;
}

export function SoldCount({
  count,
  className = 'text-xs text-muted-foreground',
}: {
  count: number | undefined;
  className?: string;
}) {
  const label = soldCountLabel(count);
  if (label === null) return null;
  return <span className={className}>{label}</span>;
}
