/** The short badge text for a saved or queued item count: nothing at zero, capped past 99. */
export function countLabel(count: number | null): string | null {
  if (count === null || count === 0) return null;
  return count > 99 ? '99+' : String(count);
}
