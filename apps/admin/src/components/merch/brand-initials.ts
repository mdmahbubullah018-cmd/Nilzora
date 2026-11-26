/**
 * Up to two initials, for a brand without a logo — or whose logo cannot be loaded.
 *
 * A plain module rather than part of the client component: the customer preview draws the same
 * fallback on the server, and a server module may not call into a "use client" one.
 */
export function brandInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : name.slice(0, 2)).toUpperCase();
}
