import { PROFILE_STATUSES, type ProfileStatus } from '@nilzora/contracts';
import type { Route } from 'next';
import type { FilterChip } from '@/components/admin-kit/filter-bar';
import { oneOf, pageParam, withQuery } from '@/components/admin-kit/href';
import { ACCOUNT_STATUS } from '@/components/admin-kit/status-badge';
import { searchParam, type SearchParams } from '@/components/orders/order-query';

export const CUSTOMERS_PATH = '/admin/customers' satisfies Route;
export const CUSTOMERS_PAGE_SIZE = 25;

export interface CustomerFilters {
  q?: string;
  status?: ProfileStatus;
}

export function parseCustomerFilters(params: SearchParams): CustomerFilters & { page: number } {
  return {
    q: searchParam(params.q),
    status: oneOf(params.status, PROFILE_STATUSES),
    page: pageParam(params.page),
  };
}

export function customersHref(filters: CustomerFilters, page = 1): Route {
  return withQuery(CUSTOMERS_PATH, {
    q: filters.q,
    status: filters.status,
    page: page > 1 ? page : undefined,
  });
}

export function customerHref(customerId: string): Route {
  return `/admin/customers/${customerId}` as Route;
}

export function customerFilterChips(filters: CustomerFilters): FilterChip[] {
  const chips: FilterChip[] = [];
  if (filters.q) {
    chips.push({
      key: 'q',
      label: `Search: “${filters.q}”`,
      removeHref: customersHref({ ...filters, q: undefined }),
    });
  }
  if (filters.status) {
    chips.push({
      key: 'status',
      label: `Status: ${ACCOUNT_STATUS[filters.status].label}`,
      removeHref: customersHref({ ...filters, status: undefined }),
    });
  }
  return chips;
}

/** A canonical UUID (the shape of every account id), else undefined. */
export function uuidParam(value: string): string | undefined {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase()
    : undefined;
}
