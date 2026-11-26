import type { PublicStoreProfile } from '@nilzora/contracts';
import type { BrandGlyphName } from '@/components/brand/social-icons';

/*
 * Links built from the store profile. The profile is already validated by the API, but a link
 * on a page is a public claim, so each one is checked again here and anything unexpected is
 * left out rather than rendered.
 */

/** A Bangladeshi mobile number in E.164 form (the API stores WhatsApp numbers this way). */
const WHATSAPP_NUMBER = /^\+8801[3-9][0-9]{8}$/;

/** `https://wa.me/8801712345678` for a valid WhatsApp number, otherwise null. */
export function whatsappUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !WHATSAPP_NUMBER.test(value)) return null;
  return `https://wa.me/${value.slice(1)}`;
}

function httpsLink(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value === '') return null;
  try {
    const url = new URL(value);
    // The stored address is returned as typed, so a link keeps its exact form.
    return url.protocol === 'https:' && url.username === '' && url.password === '' ? value : null;
  } catch {
    return null;
  }
}

export interface SocialProfile {
  glyph: BrandGlyphName;
  label: string;
  href: string;
}

/** The store's published social profiles, in a fixed order. */
export function socialProfiles(profile: PublicStoreProfile | null): SocialProfile[] {
  if (profile === null) return [];
  const candidates: { glyph: BrandGlyphName; label: string; href: string | null | undefined }[] = [
    { glyph: 'facebook', label: 'Facebook', href: profile.social.facebook },
    { glyph: 'instagram', label: 'Instagram', href: profile.social.instagram },
    { glyph: 'youtube', label: 'YouTube', href: profile.social.youtube },
    { glyph: 'tiktok', label: 'TikTok', href: profile.social.tiktok },
    { glyph: 'x', label: 'X', href: profile.social.x },
  ];
  return candidates.flatMap(({ glyph, label, href }) => {
    const safe = httpsLink(href);
    return safe === null ? [] : [{ glyph, label, href: safe }];
  });
}
