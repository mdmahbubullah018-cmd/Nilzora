import { describe, expect, it } from 'vitest';
import { takaToMinor } from '@/components/admin-kit/act';
import { detailText, parseAuditFilters } from '@/components/audit/audit-views';
import { parseCustomerFilters, uuidParam } from '@/components/customers/customer-query';
import { customerOrdersHref } from '@/components/customers/customer-views';
import {
  assignableReviewers,
  moderationHref,
  moderationReturnPath,
  parseModerationFilters,
} from '@/components/moderation/moderation-query';
import {
  dayParam,
  idParam,
  hasOrderFilters,
  noticeMessage,
  ORDER_NOTICES,
  orderFilterChips,
  orderListQuery,
  ordersHref,
  parseOrderFilters,
  withNotice,
} from './order-query';

describe('parseOrderFilters', () => {
  it('reads the filters the dashboard links to', () => {
    expect(
      parseOrderFilters({
        status: 'delivered',
        paymentStatus: 'pending',
        q: '  NZ1000 ',
        from: '2026-10-01',
        to: '2026-10-25',
        page: '2',
      }),
    ).toEqual({
      status: 'delivered',
      paymentStatus: 'pending',
      q: 'NZ1000',
      from: '2026-10-01',
      to: '2026-10-25',
      page: 2,
    });
  });

  it('drops unknown, repeated and malformed values instead of sending them on', () => {
    expect(
      parseOrderFilters({
        status: 'lost',
        paymentStatus: ['pending', 'collected'],
        q: '   ',
        from: '2026-02-30',
        to: 'yesterday',
        page: '-3',
      }),
    ).toEqual({ page: 1 });
  });

  it('caps the search at the API limit', () => {
    expect(parseOrderFilters({ q: 'x'.repeat(150) }).q).toHaveLength(100);
  });

  it('accepts only real calendar days', () => {
    expect(dayParam('2028-02-29')).toBe('2028-02-29');
    expect(dayParam('2026-13-01')).toBeUndefined();
    expect(dayParam('2026-1-01')).toBeUndefined();
  });
});

describe('order list links', () => {
  it('keep the filters, leave out page 1 and encode values', () => {
    expect(ordersHref({ status: 'pending', q: 'Rahim & Sons' })).toBe(
      '/admin/orders?status=pending&q=Rahim+%26+Sons',
    );
    expect(ordersHref({ status: 'pending' }, 3)).toBe('/admin/orders?status=pending&page=3');
  });

  it('offer one removable chip per filter', () => {
    const chips = orderFilterChips({ status: 'shipped', paymentStatus: 'collected', q: 'NZ1' });
    expect(chips.map((chip) => [chip.label, chip.removeHref])).toEqual([
      ['Status: Shipped', '/admin/orders?paymentStatus=collected&q=NZ1'],
      ['Payment: Cash collected', '/admin/orders?status=shipped&q=NZ1'],
      ['Search: “NZ1”', '/admin/orders?status=shipped&paymentStatus=collected'],
    ]);
  });
});

describe('order list sort and delivery zone', () => {
  it('reads a known zone and sort from the address, leaving out the default sort', () => {
    expect(parseOrderFilters({ deliveryZone: 'outside_dhaka', sort: 'total_high' })).toEqual({
      deliveryZone: 'outside_dhaka',
      sort: 'total_high',
      page: 1,
    });
    expect(parseOrderFilters({ sort: 'newest' }).sort).toBeUndefined();
    expect(parseOrderFilters({ deliveryZone: 'mars', sort: ['oldest', 'total_low'] })).toEqual({
      page: 1,
    });
    expect(parseOrderFilters({ sort: 'price; drop' }).sort).toBeUndefined();
  });

  it('keeps zone and sort in every link and passes them to the API', () => {
    expect(ordersHref({ status: 'pending', deliveryZone: 'inside_dhaka', sort: 'oldest' }, 2)).toBe(
      '/admin/orders?status=pending&deliveryZone=inside_dhaka&sort=oldest&page=2',
    );
    expect(orderListQuery({ deliveryZone: 'inside_dhaka', sort: 'total_low', page: 3 })).toEqual({
      deliveryZone: 'inside_dhaka',
      sort: 'total_low',
      page: 3,
      pageSize: 25,
    });
  });

  it('shows a chip for the zone and a non-default sort; only the zone counts as a filter', () => {
    const chips = orderFilterChips({ deliveryZone: 'outside_dhaka', sort: 'total_high' });
    expect(chips.map((chip) => [chip.label, chip.removeHref])).toEqual([
      ['Zone: Outside Dhaka', '/admin/orders?sort=total_high'],
      ['Sorted: Highest total', '/admin/orders?deliveryZone=outside_dhaka'],
    ]);
    expect(hasOrderFilters({ sort: 'oldest' })).toBe(false);
    expect(hasOrderFilters({ deliveryZone: 'inside_dhaka' })).toBe(true);
  });
});

describe('other list filters', () => {
  it('customers: search, status and page', () => {
    expect(parseCustomerFilters({ q: 'rahim', status: 'suspended', page: '4' })).toEqual({
      q: 'rahim',
      status: 'suspended',
      page: 4,
    });
    expect(parseCustomerFilters({ status: 'banned' }).status).toBeUndefined();
  });

  it('moderation: scope defaults to all and is left out of the address', () => {
    expect(parseModerationFilters({ scope: 'unassigned', status: 'pending' })).toEqual({
      scope: 'unassigned',
      status: 'pending',
      page: 1,
    });
    expect(parseModerationFilters({ scope: 'everyone' }).scope).toBe('all');
    expect(moderationHref({ scope: 'all', status: 'pending' }, 2)).toBe(
      '/admin/moderation?status=pending&page=2',
    );
  });

  it('audit: known areas and account ids only', () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    expect(parseAuditFilters({ area: 'order.', actor: id.toUpperCase() })).toEqual({
      area: 'order.',
      actorId: id,
      page: 1,
    });
    expect(parseAuditFilters({ area: 'drop table', actor: 'me' })).toEqual({ page: 1 });
  });

  it('ids must be UUIDs', () => {
    expect(uuidParam('../admin')).toBeUndefined();
    expect(uuidParam('0f8fad5b-d9cb-469f-a165-70867728950e')).toBe(
      '0f8fad5b-d9cb-469f-a165-70867728950e',
    );
  });
});

describe('takaToMinor', () => {
  it.each([
    ['1250', 125_000],
    ['1,250.5', 125_050],
    ['৳ 80', 8_000],
    ['0', 0],
    ['0.05', 5],
  ])('reads %j as %d poisha', (text, minor) => {
    expect(takaToMinor(text)).toBe(minor);
  });

  it.each(['', 'abc', '-5', '1.234', '1e5', '12.'])('refuses %j', (text) => {
    expect(takaToMinor(text)).toBeUndefined();
  });
});

describe('audit detail values', () => {
  it('are plain text, never markup', () => {
    expect(detailText('<b>x</b>')).toBe('<b>x</b>');
    expect(detailText(null)).toBe('none');
    expect(detailText(42)).toBe('42');
    expect(detailText({ from: 'pending', to: 'confirmed' })).toBe(
      '{"from":"pending","to":"confirmed"}',
    );
    expect(detailText({ long: 'x'.repeat(300) })).toHaveLength(158);
  });
});

describe('notices', () => {
  it('show only allow-listed keys, never the query text', () => {
    expect(noticeMessage('cash_collected', ORDER_NOTICES)).toBe(ORDER_NOTICES.cash_collected);
    for (const value of ['<b>hi</b>', 'constructor', '__proto__', 'toString', '', undefined]) {
      expect(noticeMessage(value, ORDER_NOTICES)).toBeUndefined();
    }
    // A repeated parameter is refused rather than guessed between.
    expect(noticeMessage(['confirmed', 'shipped'], ORDER_NOTICES)).toBeUndefined();
  });

  it('are appended to an address with or without a query', () => {
    expect(withNotice('/admin/orders/NZ100042', 'confirmed')).toBe(
      '/admin/orders/NZ100042?notice=confirmed',
    );
    expect(withNotice('/admin/moderation?scope=mine', 'assigned')).toBe(
      '/admin/moderation?scope=mine&notice=assigned',
    );
  });
});

describe('the customer filter', () => {
  const id = '22222222-2222-4222-8222-222222222222';

  it('reads a customer id and links the customer page to it', () => {
    expect(parseOrderFilters({ customerId: id.toUpperCase() }).customerId).toBe(id);
    expect(parseOrderFilters({ customerId: 'someone' }).customerId).toBeUndefined();
    expect(idParam(['a', 'b'])).toBeUndefined();
    expect(customerOrdersHref(id)).toBe(`/admin/orders?customerId=${id}`);
  });

  it('shows a removable chip naming the customer when known', () => {
    const [chip] = orderFilterChips({ customerId: id, status: 'pending' }, 'Test Customer').slice(
      -1,
    );
    expect(chip).toEqual({
      key: 'customerId',
      label: 'Customer: Test Customer',
      removeHref: '/admin/orders?status=pending',
    });
    expect(orderFilterChips({ customerId: id })[0]?.label).toBe('Customer: one account');
  });
});

describe('moderation return paths and reviewers', () => {
  const task = '66666666-6666-4666-8666-666666666666';

  it('rebuild only known moderation addresses', () => {
    expect(moderationReturnPath(`/admin/moderation/${task}`)).toBe(`/admin/moderation/${task}`);
    expect(moderationReturnPath('/admin/moderation?scope=mine&status=pending&page=2')).toBe(
      '/admin/moderation?scope=mine&status=pending&page=2',
    );
    for (const value of [
      '//evil.example/admin/moderation',
      '/admin/orders',
      '/admin/moderation/x',
      '',
    ]) {
      expect(moderationReturnPath(value)).toBe('/admin/moderation');
    }
  });

  it('never offer the submitter, and the assigner only to an owner', () => {
    const reviewers = [{ id: 'submitter' }, { id: 'me' }, { id: 'other' }];
    const submitted = { submittedBy: { id: 'submitter' } };
    expect(assignableReviewers(reviewers, submitted, { id: 'me', role: 'admin' })).toEqual([
      { id: 'other' },
    ]);
    expect(assignableReviewers(reviewers, submitted, { id: 'me', role: 'super_admin' })).toEqual([
      { id: 'me' },
      { id: 'other' },
    ]);
  });
});
