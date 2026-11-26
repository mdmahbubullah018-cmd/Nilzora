import type { Permission } from '@nilzora/contracts';
import { describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS } from '@/test/fixtures';
import {
  canOpenReports,
  parseReportPage,
  readableReportKinds,
  readableStatus,
  reportParamsOf,
  reportQueryOf,
  REPORT_PERMISSIONS,
} from './report-query';

const NOW = new Date('2026-11-15T06:00:00Z');
const CATEGORY = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('readableReportKinds', () => {
  it('lists a report only for an account holding its own permission', () => {
    expect(readableReportKinds(['finance.read'])).toEqual(['sales', 'cod_collections']);
    expect(readableReportKinds(['orders.read', 'customers.read'])).toEqual(['orders', 'customers']);
    expect(readableReportKinds(['audit_logs.read'])).toEqual(['audit_logs']);
    expect(readableReportKinds(['admin_workspace.access'])).toEqual([]);
  });

  it('gives the owner every report and staff only the ones they hold', () => {
    expect(readableReportKinds(ROLE_PERMISSIONS.super_admin)).toHaveLength(9);
    const staff = readableReportKinds(ROLE_PERMISSIONS.staff);
    expect(staff).toEqual(expect.arrayContaining(['orders', 'products', 'inventory', 'customers']));
    expect(staff).not.toContain('sales');
    expect(staff).not.toContain('audit_logs');
  });

  it('opens the page only when some report is open', () => {
    expect(canOpenReports(['coupons.update'])).toBe(true);
    expect(canOpenReports(['admin_workspace.access'])).toBe(false);
    expect(REPORT_PERMISSIONS.every((permission: Permission) => permission.includes('.'))).toBe(true);
  });
});

describe('parseReportPage', () => {
  const all = readableReportKinds(ROLE_PERMISSIONS.super_admin);

  it('has nothing to show an account without any report', () => {
    expect(parseReportPage({}, [], NOW)).toBeNull();
  });

  it('defaults to the first permitted report over the last 30 days', () => {
    const page = parseReportPage({}, all, NOW);
    expect(page?.kind).toBe('sales');
    expect(page?.range).toMatchObject({ preset: '30d', from: '2026-10-17', to: '2026-11-15' });
    expect(page?.filters).toEqual({});
  });

  it('falls back to a permitted report when the kind is unknown or not permitted', () => {
    expect(parseReportPage({ kind: 'nonsense' }, ['orders', 'customers'], NOW)?.kind).toBe('orders');
    expect(parseReportPage({ kind: 'audit_logs' }, ['orders', 'customers'], NOW)?.kind).toBe('orders');
    expect(parseReportPage({ kind: 'customers' }, ['orders', 'customers'], NOW)?.kind).toBe('customers');
  });

  it('keeps the filters a report accepts and drops the rest', () => {
    const page = parseReportPage(
      { kind: 'orders', status: 'delivered', paymentStatus: 'pending', q: '  NZ1  ', categoryId: CATEGORY },
      all,
      NOW,
    );
    // Orders have no category filter.
    expect(page?.filters).toEqual({ status: 'delivered', paymentStatus: 'pending', q: 'NZ1' });
  });

  it('refuses a status the report does not know, a malformed id and an over-long search', () => {
    expect(parseReportPage({ kind: 'orders', status: 'bogus' }, all, NOW)?.filters).toEqual({});
    expect(parseReportPage({ kind: 'products', categoryId: 'not-a-uuid' }, all, NOW)?.filters).toEqual({});
    expect(parseReportPage({ kind: 'products', q: 'x'.repeat(101) }, all, NOW)?.filters).toEqual({});
    expect(parseReportPage({ kind: 'products', categoryId: CATEGORY }, all, NOW)?.filters).toEqual({
      categoryId: CATEGORY,
    });
  });

  it('ignores repeated parameters instead of guessing between them', () => {
    expect(parseReportPage({ kind: ['orders', 'customers'] }, all, NOW)?.kind).toBe('sales');
    expect(parseReportPage({ kind: 'orders', status: ['delivered', 'pending'] }, all, NOW)?.filters).toEqual({});
  });

  it('reads a custom range and the too-large flag', () => {
    const page = parseReportPage(
      { kind: 'orders', range: 'custom', from: '2026-10-01', to: '2026-10-31', tooLarge: '1' },
      all,
      NOW,
    );
    expect(page?.range).toMatchObject({ preset: 'custom', days: 31 });
    expect(page?.tooLarge).toBe(true);
  });
});

describe('reportQueryOf and reportParamsOf', () => {
  it('carry the range and only the filters that are set', () => {
    const page = parseReportPage({ kind: 'orders', status: 'pending', q: 'NZ' }, ['orders'], NOW);
    if (!page) throw new Error('no page');
    expect(reportQueryOf(page)).toEqual({
      from: '2026-10-17',
      to: '2026-11-15',
      status: 'pending',
      q: 'NZ',
    });
    expect(reportParamsOf(page)).toEqual(reportQueryOf(page));
  });
});

describe('readableStatus', () => {
  it('makes API status words readable', () => {
    expect(readableStatus('changes_requested')).toBe('Changes requested');
    expect(readableStatus('delivered')).toBe('Delivered');
  });
});
