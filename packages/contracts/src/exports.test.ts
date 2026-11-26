import { describe, expect, it } from 'vitest';
import {
  API_ERROR_CODES,
  createExportRequestSchema,
  REPORT_DEFINITIONS,
  REPORT_KINDS,
  reportExportQuerySchema,
  reportFilterIssues,
  reportPreviewQuerySchema,
} from './index';

describe('reports and exports', () => {
  it('names a permission and columns for every kind, with no phone or address column', () => {
    for (const kind of REPORT_KINDS) {
      const definition = REPORT_DEFINITIONS[kind];
      expect(definition.kind).toBe(kind);
      expect(definition.columns.length).toBeGreaterThan(0);
      for (const column of definition.columns) {
        expect(column.key).not.toMatch(/phone|address|password|token|details/i);
      }
    }
    expect(REPORT_DEFINITIONS.coupons.permission).toBe('coupons.update');
    expect(REPORT_DEFINITIONS.cod_collections.permission).toBe('finance.read');
  });

  it('accepts at most 366 days, in order', () => {
    expect(
      reportPreviewQuerySchema.safeParse({ from: '2028-01-01', to: '2028-12-31' }).success,
    ).toBe(true);
    expect(
      reportPreviewQuerySchema.safeParse({ from: '2025-01-01', to: '2026-01-02' }).success,
    ).toBe(false);
    expect(
      reportPreviewQuerySchema.safeParse({ from: '2026-10-31', to: '2026-10-01' }).success,
    ).toBe(false);
    expect(
      reportExportQuerySchema.safeParse({ from: '2026-10-01', to: '2026-10-31' }).success,
    ).toBe(false);
    expect(
      reportExportQuerySchema.safeParse({ format: 'xlsx', from: '2026-10-01', to: '2026-10-31' })
        .success,
    ).toBe(true);
  });

  it('lists the filters a kind does not take', () => {
    const range = { from: '2026-10-01', to: '2026-10-31' };
    expect(
      reportFilterIssues('orders', { ...range, status: 'pending', paymentStatus: 'pending' }),
    ).toEqual([]);
    expect(
      reportFilterIssues('sales', { ...range, status: 'pending' }).map((issue) => issue.path),
    ).toEqual(['status']);
    expect(reportFilterIssues('orders', { ...range, status: 'lost' })[0]?.path).toBe('status');
    expect(
      reportFilterIssues('audit_logs', {
        ...range,
        categoryId: '0f000000-0000-4000-8000-000000000001',
      }),
    ).toHaveLength(1);
  });

  it('takes only kind, format and filters for a job', () => {
    const job = {
      kind: 'orders',
      format: 'csv',
      filters: { from: '2026-10-01', to: '2026-10-31' },
    };
    expect(createExportRequestSchema.safeParse(job).success).toBe(true);
    expect(createExportRequestSchema.safeParse({ ...job, rows: [] }).success).toBe(false);
    expect(
      createExportRequestSchema.safeParse({ ...job, filters: { ...job.filters, secret: 'x' } })
        .success,
    ).toBe(false);
  });

  it('names the export refusals', () => {
    for (const code of [
      'export_too_large',
      'export_not_ready',
      'export_expired',
      'exports_unavailable',
    ]) {
      expect(API_ERROR_CODES).toContain(code);
    }
  });
});
