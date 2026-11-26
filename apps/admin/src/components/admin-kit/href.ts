import type { Route } from 'next';

/** A query-string value; empty, null and undefined values are left out of the link. */
export type QueryValue = string | number | boolean | null | undefined;

/**
 * A link to `path` with query parameters, for pagination, sorting, filter chips and
 * period switches. Parameters are encoded and empty ones dropped, so
 * `withQuery('/admin/orders', { status: 'pending', page: 2, q: '' })` is
 * `/admin/orders?status=pending&page=2`.
 *
 * `path` is checked as a typed route; adding a query string keeps it one.
 */
export function withQuery(path: Route, params: Readonly<Record<string, QueryValue>>): Route {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  // A typed route plus `?query` is still a valid route (Next.js allows the suffix).
  return query ? `${path}?${query}` : path;
}

/** The single value of a search parameter; repeated parameters are refused, not guessed. */
export function single(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** A whole page number from a search parameter: 1 for anything missing or invalid. */
export function pageParam(value: string | string[] | undefined): number {
  const text = single(value);
  if (!text || !/^\d{1,4}$/.test(text)) return 1;
  const page = Number(text);
  return page >= 1 ? page : 1;
}

/** `value` when it is one of `options`, else undefined (for enum filters from the URL). */
export function oneOf<T extends string>(
  value: string | string[] | undefined,
  options: readonly T[],
): T | undefined {
  const text = single(value);
  return options.find((option) => option === text);
}
