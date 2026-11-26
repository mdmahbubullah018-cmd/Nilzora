/**
 * Taka typed into a browser form ("1250", "1,250.50", "৳ 80") as poisha, or null when it
 * is not an amount with at most two decimals. The same rule as the server's takaToMinor
 * (admin-kit/act, server-only), for live checks before a form is sent.
 */
export function takaTextToMinor(text: string): number | null {
  const cleaned = text.replace(/[৳,\s]/g, '');
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match?.[1]) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}
