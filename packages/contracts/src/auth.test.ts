import { describe, expect, it } from 'vitest';
import {
  APP_ROLES,
  assignRoleRequestSchema,
  confirmEmailRequestSchema,
  loginRequestSchema,
  meResponseSchema,
  registerRequestSchema,
  updateProfileRequestSchema,
} from './auth';

const validRegistration = {
  email: ' New.Customer@Example.com ',
  password: 'shopping2026',
  fullName: '  Rahima Khatun ',
  phone: '01712-345678',
};

describe('registerRequestSchema', () => {
  it('normalises a customer registration', () => {
    expect(registerRequestSchema.parse(validRegistration)).toStrictEqual({
      email: 'new.customer@example.com',
      password: 'shopping2026',
      fullName: 'Rahima Khatun',
      phone: '+8801712345678',
    });
  });

  it.each([
    ['role', { role: 'admin' }],
    ['roles', { roles: ['super_admin'] }],
    ['permissions', { permissions: ['settings.manage'] }],
    ['status', { status: 'active' }],
    ['id', { id: '3f8e2a52-7b1c-4d3e-9f0a-1b2c3d4e5f60' }],
    ['metadata', { user_metadata: { role: 'staff' } }],
  ])('rejects a client-supplied %s field', (_, extra) => {
    expect(registerRequestSchema.safeParse({ ...validRegistration, ...extra }).success).toBe(false);
  });

  it('enforces the password policy', () => {
    expect(
      registerRequestSchema.safeParse({ ...validRegistration, password: 'short1' }).success,
    ).toBe(false);
  });
});

describe('loginRequestSchema', () => {
  it('accepts existing passwords without re-applying the creation policy', () => {
    expect(loginRequestSchema.parse({ email: 'A@B.CO', password: 'x' })).toStrictEqual({
      email: 'a@b.co',
      password: 'x',
    });
  });
});

describe('confirmEmailRequestSchema', () => {
  it('accepts a confirmation token hash', () => {
    const tokenHash = 'pkce_4f6b0c2e9a1d7e3b5c8f0a2d4e6b8c1a3e5d7f9b2c4e6a8d0f1b3c5e';
    expect(confirmEmailRequestSchema.parse({ tokenHash })).toStrictEqual({ tokenHash });
  });

  it.each([
    ['too short', { tokenHash: 'abc' }],
    ['URL characters', { tokenHash: 'abcdefghijklmnop/../../x' }],
    ['extra fields', { tokenHash: 'abcdefghijklmnopqrstuvwx', type: 'recovery' }],
  ])('rejects %s', (_label, input) => {
    expect(confirmEmailRequestSchema.safeParse(input).success).toBe(false);
  });
});

describe('updateProfileRequestSchema', () => {
  it('accepts customer-editable fields, including clearing them', () => {
    expect(
      updateProfileRequestSchema.parse({ fullName: null, phone: '01812345678' }),
    ).toStrictEqual({ fullName: null, phone: '+8801812345678' });
  });

  it.each([{}, { status: 'active' }, { role: 'admin' }, { fullName: 'A', id: 'someone-else' }])(
    'rejects %j',
    (body) => {
      expect(updateProfileRequestSchema.safeParse(body).success).toBe(false);
    },
  );
});

describe('roles', () => {
  it('lists the five application roles', () => {
    expect(APP_ROLES).toEqual(['super_admin', 'admin', 'staff', 'moderator', 'customer']);
  });

  it('rejects unknown roles in assignments', () => {
    expect(assignRoleRequestSchema.safeParse({ role: 'root' }).success).toBe(false);
  });

  it('describes the current user without any secret fields', () => {
    const shape = Object.keys(meResponseSchema.shape.user.shape).sort();
    // twoFactor is a status summary (required / enrolled / verified), never a secret.
    expect(shape).toEqual(['email', 'id', 'permissions', 'profile', 'role', 'twoFactor']);
    expect(Object.keys(meResponseSchema.shape.user.shape.twoFactor.unwrap().shape).sort()).toEqual([
      'enrolled',
      'required',
      'verified',
    ]);
  });
});
