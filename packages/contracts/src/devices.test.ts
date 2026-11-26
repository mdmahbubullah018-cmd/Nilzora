import { describe, expect, it } from 'vitest';
import {
  DEVICE_PLATFORMS,
  deviceRegistrationRequestSchema,
  deviceRegistrationResponseSchema,
  deviceRemovalRequestSchema,
} from './index';

const TOKEN = 'fcm:APA91bHexample-token_value.with~allowed+chars/and=padding';

describe('device registration request', () => {
  it('accepts a token with a platform, trimming the token and version', () => {
    expect(
      deviceRegistrationRequestSchema.parse({
        token: `  ${TOKEN} `,
        platform: 'android',
        appVersion: ' 1.4.0 ',
      }),
    ).toStrictEqual({ token: TOKEN, platform: 'android', appVersion: '1.4.0' });
    expect(deviceRegistrationRequestSchema.parse({ token: TOKEN, platform: 'ios' })).toStrictEqual({
      token: TOKEN,
      platform: 'ios',
    });
    expect(DEVICE_PLATFORMS).toEqual(['android', 'ios']);
  });

  it.each([
    ['a token that is too short', { token: 'short-token' }],
    ['a token over 1,024 characters', { token: 'a'.repeat(1025) }],
    ['a token the old 4,096 limit allowed', { token: 'a'.repeat(3000) }],
    ['a token with a space inside', { token: 'abcdefghij abcdefghijklmn' }],
    ['a token with a newline', { token: 'abcdefghijabcdefghij\nklmn' }],
    ['a token with quotes', { token: `abcdefghijabcdefghij"'<>` }],
    ['a non-string token', { token: 1_234_567_890 }],
    ['an unknown platform', { platform: 'windows' }],
    ['a missing platform', { platform: undefined }],
    ['an empty app version', { appVersion: '  ' }],
    ['an app version over 32 characters', { appVersion: '1'.repeat(33) }],
    ['an owner', { userId: '3f8e2a52-7b1c-4d3e-9f0a-1b2c3d4e5f60' }],
    ['an invalidation time', { invalidatedAt: '2026-10-26T08:00:00.000Z' }],
  ])('rejects %s', (_label, change) => {
    expect(
      deviceRegistrationRequestSchema.safeParse({ token: TOKEN, platform: 'android', ...change })
        .success,
    ).toBe(false);
  });

  it('accepts a token of exactly 20 and exactly 1,024 characters', () => {
    for (const length of [20, 1024]) {
      expect(
        deviceRegistrationRequestSchema.safeParse({
          token: 'a'.repeat(length),
          platform: 'android',
        }).success,
        String(length),
      ).toBe(true);
    }
  });
});

describe('device removal request and registration response', () => {
  it('takes only the token', () => {
    expect(deviceRemovalRequestSchema.parse({ token: ` ${TOKEN}` })).toStrictEqual({
      token: TOKEN,
    });
    expect(deviceRemovalRequestSchema.safeParse({ token: TOKEN, platform: 'ios' }).success).toBe(
      false,
    );
    expect(deviceRemovalRequestSchema.safeParse({ token: 'short' }).success).toBe(false);
  });

  it('describes a registered device by its id only', () => {
    const device = { id: 'de000000-0000-4000-8000-000000000001' };
    expect(deviceRegistrationResponseSchema.parse({ device })).toStrictEqual({ device });
    expect(deviceRegistrationResponseSchema.safeParse({ device: { id: 'x' } }).success).toBe(false);
  });
});
