// @vitest-environment jsdom
import type { AuditEntry } from '@nilzora/contracts';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS } from '@/test/fixtures';
import { auditChips, AuditTable, auditHref, changeOf, parseAuditFilters } from './audit-views';

afterEach(cleanup);

function entry(details: AuditEntry['details'], overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 1,
    actor: { id: '99999999-9999-4999-8999-999999999999', name: 'Owner', email: null },
    action: 'order.status_changed',
    targetType: 'order',
    targetId: 'NZ100042',
    details,
    createdAt: '2026-10-24T08:00:00.000Z',
    ...overrides,
  };
}

function renderTable(entries: AuditEntry[]) {
  return render(
    <AuditTable
      data={{ entries, page: 1, pageSize: 30, total: entries.length, totalPages: 1 }}
      filters={{}}
      permissions={ROLE_PERMISSIONS.admin}
    />,
  );
}

describe('changeOf', () => {
  it('finds a before and an after under either naming', () => {
    expect(changeOf({ from: 'pending', to: 'confirmed' })).toMatchObject({
      before: 'pending',
      after: 'confirmed',
      keys: ['from', 'to'],
    });
    expect(changeOf({ before: 1, after: 2, note: 'x' })).toMatchObject({
      before: 1,
      after: 2,
      keys: ['before', 'after'],
    });
  });

  it('is undefined when the details describe no change, or only half of one', () => {
    expect(changeOf({})).toBeUndefined();
    expect(changeOf({ from: 'pending' })).toBeUndefined();
    expect(changeOf({ role: 'staff' })).toBeUndefined();
  });
});

describe('AuditTable details', () => {
  it('shows a change as was → now, in words as well as colour', () => {
    renderTable([entry({ from: 'pending', to: 'confirmed' })]);
    expect(screen.getByText('pending')).toBeTruthy();
    expect(screen.getByText('confirmed')).toBeTruthy();
    // Assistive technology gets the direction in words, not just the arrow and colours.
    expect(document.body.textContent).toContain('Was pending');
    expect(document.body.textContent).toContain(', now confirmed');
  });

  it('lists anything else recorded beneath the change, with readable labels', () => {
    renderTable([entry({ from: 'staff', to: 'admin', reason_text: 'Promoted' })]);
    expect(screen.getByText('Reason text')).toBeTruthy();
    expect(screen.getByText('Promoted')).toBeTruthy();
  });

  it('shows details on every screen size, once per entry', () => {
    renderTable([entry({ note: 'Cash recorded' })]);
    expect(screen.getAllByText('Cash recorded')).toHaveLength(1);
    // There is no separate hidden "Details" column any more.
    expect(screen.queryByRole('columnheader', { name: 'Details' })).toBeNull();
  });

  it('shows nothing extra for an entry without details', () => {
    const { container } = renderTable([entry({})]);
    expect(container.querySelector('dl')).toBeNull();
  });

  it('keeps stored text inert: markup in a value is shown as text', () => {
    renderTable([entry({ from: '<img src=x onerror=alert(1)>', to: 'ok' })]);
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
  });

  it('links an order target the account may open', () => {
    renderTable([entry({})]);
    const table = screen.getByRole('table', { name: 'Audit log' });
    expect(within(table).getByRole('link', { name: 'order NZ100042' }).getAttribute('href')).toBe(
      '/admin/orders/NZ100042',
    );
  });
});

describe('parseAuditFilters: dates and search', () => {
  const NOW = new Date('2026-11-15T06:00:00Z'); // 15 Nov in Dhaka

  it('reads a real range and a search, trimmed', () => {
    expect(
      parseAuditFilters({ from: '2026-11-01', to: '2026-11-10', q: '  refund  ' }, NOW),
    ).toMatchObject({ from: '2026-11-01', to: '2026-11-10', q: 'refund' });
  });

  it('accepts one end of a range on its own', () => {
    expect(parseAuditFilters({ from: '2026-11-01' }, NOW)).toMatchObject({ from: '2026-11-01' });
    expect(parseAuditFilters({ to: '2026-11-01' }, NOW).from).toBeUndefined();
  });

  it('drops days that are not real, or that lie in the future', () => {
    const filters = parseAuditFilters({ from: '2026-02-30', to: '2026-12-25' }, NOW);
    expect(filters.from).toBeUndefined();
    expect(filters.to).toBeUndefined();
  });

  it('drops a backwards range or one longer than the API allows, as a whole', () => {
    const backwards = parseAuditFilters({ from: '2026-11-10', to: '2026-11-01' }, NOW);
    expect([backwards.from, backwards.to]).toEqual([undefined, undefined]);
    const tooLong = parseAuditFilters({ from: '2025-01-01', to: '2026-11-10' }, NOW);
    expect([tooLong.from, tooLong.to]).toEqual([undefined, undefined]);
  });

  it('refuses an empty or over-long search and repeated parameters', () => {
    expect(parseAuditFilters({ q: '   ' }, NOW).q).toBeUndefined();
    expect(parseAuditFilters({ q: 'x'.repeat(101) }, NOW).q).toBeUndefined();
    expect(parseAuditFilters({ q: ['a', 'b'] }, NOW).q).toBeUndefined();
  });

  it('keeps the new filters in links and offers a chip to remove each', () => {
    const filters = { from: '2026-11-01', to: '2026-11-10', q: 'refund' };
    expect(auditHref(filters)).toBe('/admin/audit?from=2026-11-01&to=2026-11-10&q=refund');
    const chips = auditChips(filters);
    expect(chips.map((chip) => chip.label)).toEqual(['2026-11-01 to 2026-11-10', 'Search: refund']);
    expect(chips[0]?.removeHref).toBe('/admin/audit?q=refund');
  });
});
