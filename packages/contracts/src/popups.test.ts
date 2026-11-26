import { describe, expect, it } from 'vitest';
import {
  POPUP_ANIMATED_KEY,
  POPUP_DELAY_SECONDS,
  POPUP_FREQUENCIES,
  POPUP_STILL_KEY,
  adminPopupSchema,
  popupResponseSchema,
  publicPopupSchema,
  savePopupSchema,
  setPopupActiveSchema,
} from './index';

/*
 * Popup contracts. The shape exists to refuse, before anything reaches the database: half a
 * button, words over complete artwork, an end before a start, a delay nobody offered, and any
 * address that is not a path inside the store. The public payload must also be unable to carry a
 * management field.
 */

const template = {
  internalName: 'Eid campaign',
  displayMode: 'template',
  title: 'Eid on Nilzora',
  subtitle: 'Delivered across Bangladesh',
  description: 'Order before Thursday.',
  buttonLabel: 'Shop the offer',
  buttonHref: '/categories/fashion',
  imageAlt: 'Two cotton sarees in blue and gold',
  delaySeconds: 10,
  frequency: 'once_per_session',
  isActive: false,
  startsAt: null,
  endsAt: null,
};

const publicPopup = {
  id: '6f1a1f5a-1b7c-4f2b-9d3e-6a0b5c8d9e10',
  displayMode: 'template',
  imageUrl: 'https://media.nilzora.test/popups/6f1a1f5a-1b7c-4f2b-9d3e-6a0b5c8d9e10/7c9f29d1.webp',
  imageWidth: 1200,
  imageHeight: 860,
  isAnimated: false,
  imageAlt: null,
  title: 'Eid on Nilzora',
  subtitle: null,
  description: null,
  buttonLabel: null,
  buttonHref: null,
  delaySeconds: 15,
  frequency: 'once_per_day',
  endsAt: null,
};

describe('popup choices', () => {
  it('offers the delay presets and four frequencies, and nothing else', () => {
    expect(POPUP_DELAY_SECONDS).toEqual([0, 3, 5, 10, 15, 30, 60]);
    expect(POPUP_FREQUENCIES).toEqual([
      'once_ever',
      'once_per_session',
      'once_per_day',
      'every_visit',
    ]);
  });
});

describe('savePopupSchema', () => {
  it('accepts a complete template popup', () => {
    const parsed = savePopupSchema.safeParse(template);
    expect(parsed.success).toBe(true);
  });

  it('refuses half a designed-template button', () => {
    const missingHref = savePopupSchema.safeParse({ ...template, buttonHref: null });
    const missingLabel = savePopupSchema.safeParse({ ...template, buttonLabel: '' });
    expect(missingHref.success).toBe(false);
    expect(missingLabel.success).toBe(false);
    if (!missingHref.success) {
      expect(missingHref.error.issues[0]?.path).toEqual(['buttonHref']);
    }
    if (!missingLabel.success) {
      expect(missingLabel.error.issues[0]?.path).toEqual(['buttonLabel']);
    }
  });

  it('refuses words over complete artwork, because the picture carries them', () => {
    const parsed = savePopupSchema.safeParse({
      ...template,
      displayMode: 'artwork',
      title: 'Still here',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]?.path).toEqual(['displayMode']);
  });

  it('accepts complete artwork with only a link', () => {
    const parsed = savePopupSchema.safeParse({
      internalName: 'GIF promotion',
      displayMode: 'artwork',
      title: null,
      subtitle: null,
      description: null,
      buttonLabel: null,
      buttonHref: '/categories/fashion',
      imageAlt: 'An animated banner',
      delaySeconds: 15,
      frequency: 'every_visit',
      isActive: true,
      startsAt: null,
      endsAt: null,
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts a delay from 0 to 120 seconds and refuses the rest', () => {
    expect(savePopupSchema.safeParse({ ...template, delaySeconds: 0 }).success).toBe(true);
    expect(savePopupSchema.safeParse({ ...template, delaySeconds: 45 }).success).toBe(true);
    expect(savePopupSchema.safeParse({ ...template, delaySeconds: 121 }).success).toBe(false);
    expect(savePopupSchema.safeParse({ ...template, delaySeconds: -1 }).success).toBe(false);
    expect(savePopupSchema.safeParse({ ...template, delaySeconds: 2.5 }).success).toBe(false);
  });

  it('defaults and validates platform, audience and priority', () => {
    const parsed = savePopupSchema.parse(template);
    expect([parsed.platform, parsed.audience, parsed.priority]).toEqual(['both', 'all', 0]);
    expect(savePopupSchema.safeParse({ ...template, platform: 'tv' }).success).toBe(false);
    expect(savePopupSchema.safeParse({ ...template, audience: 'vip' }).success).toBe(false);
    expect(savePopupSchema.safeParse({ ...template, priority: 1001 }).success).toBe(false);
  });

  it('refuses an end that is not after the start', () => {
    const parsed = savePopupSchema.safeParse({
      ...template,
      startsAt: '2026-12-01T10:00:00.000Z',
      endsAt: '2026-12-01T09:00:00.000Z',
    });
    expect(parsed.success).toBe(false);
  });

  it('refuses an off-site destination: a popup may only send a customer deeper into the store', () => {
    expect(
      savePopupSchema.safeParse({ ...template, buttonHref: 'https://example.test/x' }).success,
    ).toBe(false);
    expect(savePopupSchema.safeParse({ ...template, buttonHref: '//example.test/x' }).success).toBe(
      false,
    );
  });

  it('turns empty copy into null rather than an empty string', () => {
    const parsed = savePopupSchema.parse({ ...template, title: '   ', subtitle: '' });
    expect(parsed.title).toBeNull();
    expect(parsed.subtitle).toBeNull();
  });

  it('saves a popup whose every word is empty, so a picture alone is a complete campaign', () => {
    const parsed = savePopupSchema.parse({
      ...template,
      title: '',
      subtitle: '   ',
      description: '',
      buttonLabel: '',
      buttonHref: null,
      imageAlt: '',
    });

    expect(parsed).toMatchObject({
      displayMode: 'template',
      title: null,
      subtitle: null,
      description: null,
      buttonLabel: null,
      buttonHref: null,
      imageAlt: null,
    });
  });

  it('takes an unknown field as a mistake rather than ignoring it', () => {
    expect(savePopupSchema.safeParse({ ...template, couponCode: 'EID20' }).success).toBe(false);
  });
});

describe('setPopupActiveSchema', () => {
  it('requires a real boolean', () => {
    expect(setPopupActiveSchema.safeParse({ active: true }).success).toBe(true);
    expect(setPopupActiveSchema.safeParse({ active: 'true' }).success).toBe(false);
  });
});

describe('publicPopupSchema', () => {
  it('accepts the customer-facing shape', () => {
    expect(publicPopupSchema.safeParse(publicPopup).success).toBe(true);
  });

  it('carries no management field, even when one is sent', () => {
    const parsed = publicPopupSchema.safeParse({
      ...publicPopup,
      internalName: 'Eid campaign',
      isActive: true,
      imageKey: 'popups/x/y',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && 'internalName' in parsed.data).toBe(false);
    expect(parsed.success && 'isActive' in parsed.data).toBe(false);
  });

  it('requires a resolved image address and real dimensions', () => {
    expect(publicPopupSchema.safeParse({ ...publicPopup, imageUrl: null }).success).toBe(false);
    expect(publicPopupSchema.safeParse({ ...publicPopup, imageWidth: 0 }).success).toBe(false);
  });
  it('allows nothing to show at all', () => {
    expect(popupResponseSchema.safeParse({ popup: null }).success).toBe(true);
    expect(popupResponseSchema.safeParse({}).success).toBe(false);
  });
});

describe('adminPopupSchema', () => {
  it('records the artwork facts beside the copy', () => {
    const parsed = adminPopupSchema.safeParse({
      ...publicPopup,
      internalName: 'Eid campaign',
      thumbUrl: 'https://media.nilzora.test/popups/x/thumb.webp',
      imageBytes: 240_000,
      imageKind: 'animated',
      imageFormat: 'gif',
      isActive: true,
      startsAt: null,
      updatedAt: '2026-12-30T09:00:00.000Z',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.imageKind).toBe('animated');
  });
});

describe('stored artwork keys', () => {
  const popupId = '6f1a1f5a-1b7c-4f2b-9d3e-6a0b5c8d9e10';
  const fileId = '7c9f29d1-2ab5-4dc8-8de0-1f2a3b4c5d6e';

  it('matches the two shapes the API stores', () => {
    expect(POPUP_STILL_KEY.test(`popups/${popupId}/${fileId}`)).toBe(true);
    expect(POPUP_ANIMATED_KEY.test(`popups/${popupId}/${fileId}.gif`)).toBe(true);
  });

  it('refuses a key that would address somewhere else', () => {
    expect(POPUP_STILL_KEY.test(`popups/${popupId}/../../etc`)).toBe(false);
    expect(POPUP_ANIMATED_KEY.test(`products/${popupId}/${fileId}.gif`)).toBe(false);
    expect(POPUP_ANIMATED_KEY.test(`popups/${popupId}/${fileId}.exe`)).toBe(false);
  });
});
