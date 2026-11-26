import { describe, expect, it } from 'vitest';
import {
  adminRolesResponseSchema,
  AUDIT_LOG_MAX_DAYS,
  auditLogQuerySchema,
  PERMISSIONS,
  saveStoreSettingsRequestSchema,
  storeSettingsResponseSchema,
} from './index';

const base = { returnWindowDays: 7, cartInactivityMinutes: 120 };

describe('audit-log filters', () => {
  it('takes no filter, as before', () => {
    expect(auditLogQuerySchema.safeParse({}).success).toBe(true);
    expect(auditLogQuerySchema.safeParse({ action: 'order.', page: '2' }).success).toBe(true);
  });

  it('takes either day alone, or both, and a one-day range', () => {
    expect(auditLogQuerySchema.safeParse({ from: '2026-10-01' }).success).toBe(true);
    expect(auditLogQuerySchema.safeParse({ to: '2026-10-31' }).success).toBe(true);
    expect(auditLogQuerySchema.safeParse({ from: '2026-10-05', to: '2026-10-05' }).success).toBe(
      true,
    );
  });

  it('refuses a range that ends before it starts, naming the end', () => {
    const result = auditLogQuerySchema.safeParse({ from: '2026-10-31', to: '2026-10-01' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['to']);
  });

  it('allows exactly 366 days (a leap year) and refuses 367', () => {
    expect(AUDIT_LOG_MAX_DAYS).toBe(366);
    expect(auditLogQuerySchema.safeParse({ from: '2028-01-01', to: '2028-12-31' }).success).toBe(
      true,
    );
    const over = auditLogQuerySchema.safeParse({ from: '2028-01-01', to: '2029-01-01' });
    expect(over.success).toBe(false);
    expect(over.error?.issues[0]?.path).toEqual(['from']);
  });

  it.each(['2026-02-30', '2026-13-01', '01-10-2026', '2026-1-5', '2026-10-01T00:00:00Z', ''])(
    'refuses the day %j',
    (day) => {
      expect(auditLogQuerySchema.safeParse({ from: day }).success).toBe(false);
      expect(auditLogQuerySchema.safeParse({ to: day }).success).toBe(false);
    },
  );

  it('trims the search and keeps it between 1 and 100 characters', () => {
    expect(auditLogQuerySchema.parse({ q: '  NZ100001 ' }).q).toBe('NZ100001');
    expect(auditLogQuerySchema.safeParse({ q: 'a'.repeat(100) }).success).toBe(true);
    expect(auditLogQuerySchema.safeParse({ q: 'a'.repeat(101) }).success).toBe(false);
    expect(auditLogQuerySchema.safeParse({ q: '' }).success).toBe(false);
  });
});

describe('the roles matrix answer', () => {
  it('accepts known roles holding known permissions', () => {
    const answer = {
      roles: [
        { role: 'super_admin', permissions: [...PERMISSIONS] },
        { role: 'customer', permissions: [] },
      ],
    };

    expect(adminRolesResponseSchema.parse(answer)).toStrictEqual(answer);
  });

  it('refuses an unknown role or permission', () => {
    expect(
      adminRolesResponseSchema.safeParse({ roles: [{ role: 'root', permissions: [] }] }).success,
    ).toBe(false);
    expect(
      adminRolesResponseSchema.safeParse({ roles: [{ role: 'admin', permissions: ['x.y'] }] })
        .success,
    ).toBe(false);
  });
});

describe('saving the store settings', () => {
  it('needs the return window and cart inactivity, with the thresholds optional', () => {
    expect(saveStoreSettingsRequestSchema.safeParse(base).success).toBe(true);
    expect(
      saveStoreSettingsRequestSchema.safeParse({
        ...base,
        repeatOrderThreshold: 3,
        highSpendThresholdMinor: 750_000,
        inactiveDays: 45,
      }).success,
    ).toBe(true);
    expect(saveStoreSettingsRequestSchema.safeParse({ returnWindowDays: 7 }).success).toBe(false);
    expect(saveStoreSettingsRequestSchema.safeParse({ cartInactivityMinutes: 120 }).success).toBe(
      false,
    );
  });

  it.each([
    [{ returnWindowDays: 1 }, true],
    [{ returnWindowDays: 90 }, true],
    [{ returnWindowDays: 0 }, false],
    [{ returnWindowDays: 91 }, false],
    [{ cartInactivityMinutes: 15 }, true],
    [{ cartInactivityMinutes: 10_080 }, true],
    [{ cartInactivityMinutes: 14 }, false],
    [{ cartInactivityMinutes: 10_081 }, false],
    [{ repeatOrderThreshold: 2 }, true],
    [{ repeatOrderThreshold: 20 }, true],
    [{ repeatOrderThreshold: 1 }, false],
    [{ repeatOrderThreshold: 21 }, false],
    [{ highSpendThresholdMinor: 1 }, true],
    [{ highSpendThresholdMinor: 1_000_000_000 }, true],
    [{ highSpendThresholdMinor: 0 }, false],
    [{ highSpendThresholdMinor: 1_000_000_001 }, false],
    [{ inactiveDays: 7 }, true],
    [{ inactiveDays: 730 }, true],
    [{ inactiveDays: 6 }, false],
    [{ inactiveDays: 731 }, false],
    [{ returnWindowDays: 7.5 }, false],
    [{ cartInactivityMinutes: '120' }, false],
  ])('checks the range of %j', (change, valid) => {
    expect(saveStoreSettingsRequestSchema.safeParse({ ...base, ...change }).success).toBe(valid);
  });

  it('refuses a field it does not own, such as the sales target or a role', () => {
    expect(
      saveStoreSettingsRequestSchema.safeParse({ ...base, monthlySalesTargetMinor: 1 }).success,
    ).toBe(false);
    expect(saveStoreSettingsRequestSchema.safeParse({ ...base, role: 'admin' }).success).toBe(
      false,
    );
  });
});

describe('the store settings answer', () => {
  const settings = {
    ...base,
    repeatOrderThreshold: 2,
    highSpendThresholdMinor: 500_000,
    inactiveDays: 60,
    monthlySalesTargetMinor: null,
    // Every setting the store keeps, including the payment switch the checkout reads.
    codEnabled: false,
    updatedAt: '2026-11-08T08:00:00.000Z',
  };

  it('carries every setting, the sales target being null until one is set', () => {
    expect(storeSettingsResponseSchema.parse({ settings })).toStrictEqual({ settings });
    expect(
      storeSettingsResponseSchema.safeParse({
        settings: { ...settings, monthlySalesTargetMinor: 5_000_000 },
      }).success,
    ).toBe(true);
  });

  it('refuses an answer missing a setting or holding one outside its range', () => {
    const { inactiveDays: _omitted, ...missing } = settings;

    expect(storeSettingsResponseSchema.safeParse({ settings: missing }).success).toBe(false);
    expect(
      storeSettingsResponseSchema.safeParse({ settings: { ...settings, inactiveDays: 3 } }).success,
    ).toBe(false);
  });
});
