import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { reportDownloadHref } from './report-download';

describe('reportDownloadHref', () => {
  it('builds the download address, dropping empty filters', () => {
    expect(
      reportDownloadHref('sales', 'csv', { from: '2026-11-01', to: '2026-11-08', brandId: '' }),
    ).toBe('/api/reports/sales?format=csv&from=2026-11-01&to=2026-11-08');
    expect(reportDownloadHref('orders', 'pdf', { status: undefined })).toBe(
      '/api/reports/orders?format=pdf',
    );
  });

  it('lives in a plain module: the Reports page (a Server Component) calls it', () => {
    // A function exported from a 'use client' module cannot be called on the server: the
    // page failed in production for every role until the helper moved out of the export menu.
    const source = readFileSync(new URL('./report-download.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/^\s*['"]use client['"]/m);
  });
});
