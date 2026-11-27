import { ApiError, type ApiClient, type FormState } from '@nilzora/web-session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ROLE_PERMISSIONS } from '@/test/fixtures';
import { createExportAction } from './report-actions';

const api = vi.hoisted(() => ({ adminCreateExport: vi.fn() }));
const state = vi.hoisted(
  (): { permissions: readonly string[]; outcome: 'ok' | 'untrusted' | 'signed_out' } => ({
    permissions: [],
    outcome: 'ok',
  }),
);
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock('@/lib/session', () => ({
  session: {
    getSession: () =>
      Promise.resolve({ status: 'signed_in', user: { permissions: state.permissions } }),
    act: async (_formData: FormData, call: (client: ApiClient, token: string) => unknown) => {
      if (state.outcome !== 'ok') return { kind: state.outcome };
      return { kind: 'ok', value: await call(api as unknown as ApiClient, 'access-token') };
    },
  },
}));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));

const IDLE: FormState = { status: 'idle' };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const ORDERS = {
  kind: 'orders',
  format: 'csv',
  from: '2026-10-01',
  to: '2026-10-31',
  status: 'delivered',
};

beforeEach(() => {
  state.permissions = ROLE_PERMISSIONS.super_admin;
  state.outcome = 'ok';
  revalidatePath.mockReset();
  api.adminCreateExport.mockReset().mockResolvedValue({ job: { id: 'job-1' } });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('createExportAction', () => {
  it('queues the export with exactly the validated range and filters', async () => {
    const result = await createExportAction(IDLE, form(ORDERS));
    expect(result.status).toBe('success');
    expect(result.message).toContain('CSV export is queued');
    expect(api.adminCreateExport).toHaveBeenCalledWith('access-token', {
      kind: 'orders',
      format: 'csv',
      filters: { from: '2026-10-01', to: '2026-10-31', status: 'delivered' },
    });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/reports');
  });

  it('refuses an unknown report or format without calling the API', async () => {
    for (const fields of [
      { ...ORDERS, kind: 'passwords' },
      { ...ORDERS, format: 'exe' },
    ]) {
      const result = await createExportAction(IDLE, form(fields));
      expect(result.status).toBe('error');
    }
    expect(api.adminCreateExport).not.toHaveBeenCalled();
  });

  it('refuses a report the account may not open, whatever the form says', async () => {
    state.permissions = ['products.read'];
    const result = await createExportAction(IDLE, form(ORDERS));
    expect(result).toMatchObject({
      status: 'error',
      message: 'Your account cannot export this report.',
    });
    expect(api.adminCreateExport).not.toHaveBeenCalled();
  });

  it('never exports a different range than the one asked for', async () => {
    for (const range of [
      { from: '2025-01-01', to: '2026-10-31' }, // longer than 366 days
      { from: '2026-10-31', to: '2026-10-01' }, // backwards
      { from: '2026-12-01', to: '2026-12-31' }, // in the future
      { from: 'soon', to: 'later' },
    ]) {
      const result = await createExportAction(IDLE, form({ ...ORDERS, ...range }));
      expect(result.status).toBe('error');
      expect(result.message).toContain('366 days');
    }
    expect(api.adminCreateExport).not.toHaveBeenCalled();
  });

  it('drops filters the report does not accept instead of forwarding them', async () => {
    await createExportAction(
      IDLE,
      form({ ...ORDERS, brandId: '0f8fad5b-d9cb-469f-a165-70867728950e', status: 'bogus' }),
    );
    expect(api.adminCreateExport).toHaveBeenCalledWith('access-token', {
      kind: 'orders',
      format: 'csv',
      filters: { from: '2026-10-01', to: '2026-10-31' },
    });
  });

  it('shows fixed messages for API refusals, never the API text', async () => {
    for (const [status, code, text] of [
      [403, 'forbidden', 'needs a permission'],
      [503, 'exports_unavailable', 'not available right now'],
      [429, 'rate_limited', 'several exports waiting'],
    ] as const) {
      api.adminCreateExport.mockRejectedValueOnce(
        new ApiError(status, code, 'API text that must not reach the browser', 'req-1'),
      );
      const result = await createExportAction(IDLE, form(ORDERS));
      expect(result.status).toBe('error');
      expect(result.message).toContain(text);
      expect(result.message).not.toContain('must not reach');
    }
  });

  it('sends a signed-out visitor to sign in and rejects an untrusted form', async () => {
    state.outcome = 'signed_out';
    await expect(createExportAction(IDLE, form(ORDERS))).rejects.toThrow('redirect:');
    state.outcome = 'untrusted';
    const result = await createExportAction(IDLE, form(ORDERS));
    expect(result.status).toBe('error');
    expect(api.adminCreateExport).not.toHaveBeenCalled();
  });
});
