import type { PublicStoreProfile } from '@nilzora/contracts';
import { describe, expect, it } from 'vitest';
import { socialProfiles, whatsappUrl } from './contact-links';

function profile(social: Partial<PublicStoreProfile['social']> = {}): PublicStoreProfile {
  return {
    displayName: 'Nilzora',
    tagline: null,
    description: null,
    logoKey: null,
    logoUrl: null,
    codAvailable: true,
    contactEmail: null,
    contactPhone: null,
    addressLine: null,
    addressArea: null,
    addressDistrict: null,
    businessHours: null,
    supportEmail: null,
    supportPhone: null,
    social: { facebook: null, instagram: null, youtube: null, ...social },
    defaultSeoTitle: null,
    defaultSeoDescription: null,
    ogImageKey: null,
    ogImageUrl: null,
    updatedAt: '2026-11-08T00:00:00.000Z',
  };
}

describe('whatsappUrl', () => {
  it('opens a chat with the number, without the plus sign', () => {
    expect(whatsappUrl('+8801712345678')).toBe('https://wa.me/8801712345678');
  });

  it.each([
    null,
    undefined,
    '',
    '01712345678',
    '+8801212345678',
    '+880171234567',
    'wa.me/1',
    '+8801712345678 ',
  ])('refuses %s', (value) => {
    expect(whatsappUrl(value)).toBeNull();
  });
});

describe('socialProfiles', () => {
  it('lists the published profiles in a fixed order, with TikTok and X', () => {
    const links = socialProfiles(
      profile({
        x: 'https://x.com/nilzora',
        facebook: 'https://facebook.com/nilzora',
        tiktok: 'https://www.tiktok.com/@nilzora',
      }),
    );

    expect(links.map((link) => [link.label, link.href])).toEqual([
      ['Facebook', 'https://facebook.com/nilzora'],
      ['TikTok', 'https://www.tiktok.com/@nilzora'],
      ['X', 'https://x.com/nilzora'],
    ]);
  });

  it('leaves out anything that is not a plain https address, and an absent profile', () => {
    expect(
      socialProfiles(
        profile({
          facebook: 'http://facebook.com/nilzora',
          instagram: 'javascript:alert(1)',
          youtube: 'https://user:pw@youtube.com/x',
        }),
      ),
    ).toEqual([]);
    expect(socialProfiles(null)).toEqual([]);
    expect(socialProfiles(profile())).toEqual([]);
  });
});
