import type { Banner } from '@nilzora/contracts';

/**
 * How the admin refers to a banner in lists, buttons and dialogs. Headings are optional, so a
 * picture-only banner is named by its picture description, and failing that by its kind.
 */
export function bannerName(banner: Pick<Banner, 'title' | 'imageAlt'>): string {
  if (banner.title.trim() !== '') return banner.title;
  const alt = banner.imageAlt?.trim() ?? '';
  return alt !== '' ? alt : 'Picture-only banner';
}
