import { describe, expect, it } from 'vitest';
import { publicStoreProfileSchema } from '../store-profile';
import { storeContactDetails, storeContactSection } from './contact';
import { FAQ_CATEGORIES, FAQ_ENTRIES, faqMatches, groupFaq, searchFaq } from './faq';
import { INFO_PAGES, INFO_PAGE_SLUGS, infoPage, sectionAnchor } from './info-pages';

/*
 * These tests guard the promises the information pages make rather than their layout: every
 * page has content, the FAQ is searchable, and no page text contains a contact detail, a
 * phone-shaped number or a URL — those must come from the store profile, never from a guess.
 */

const PAGES = INFO_PAGE_SLUGS.map((slug) => INFO_PAGES[slug]);

function everyLineOf(slug: (typeof INFO_PAGE_SLUGS)[number]): string[] {
  const page = INFO_PAGES[slug];
  return [
    page.title,
    page.summary,
    ...page.intro,
    ...(page.notice === undefined ? [] : [page.notice]),
    ...page.sections.flatMap((section) => [
      section.heading,
      ...section.paragraphs,
      ...(section.bullets ?? []),
    ]),
  ];
}

const ALL_TEXT = [...INFO_PAGE_SLUGS.flatMap((slug) => everyLineOf(slug))];

describe('information pages', () => {
  it('offers exactly the five editorial pages, each with sections', () => {
    expect(INFO_PAGE_SLUGS).toEqual(['about', 'privacy', 'terms', 'returns', 'shipping']);
    for (const page of PAGES) {
      expect(page.title.length).toBeGreaterThan(0);
      expect(page.summary.length).toBeGreaterThan(0);
      expect(page.intro.length).toBeGreaterThan(0);
      expect(page.sections.length).toBeGreaterThanOrEqual(3);
      for (const section of page.sections) {
        expect(section.heading.trim()).not.toBe('');
        expect(section.paragraphs.length + (section.bullets?.length ?? 0)).toBeGreaterThan(0);
      }
    }
  });

  it('never promises a delivery time, refund deadline or return window (none is decided)', () => {
    for (const page of [INFO_PAGES.returns, INFO_PAGES.shipping]) {
      const text = [
        page.summary,
        ...page.intro,
        ...page.sections.flatMap((section) => [...section.paragraphs, ...(section.bullets ?? [])]),
      ];
      for (const line of text) {
        expect(line).not.toMatch(/\d+\s*(working\s+)?(day|days|hour|hours|week|weeks)\b/i);
      }
    }
  });

  it('answers an unknown slug with nothing rather than a fallback page', () => {
    expect(infoPage('about')?.title).toBe('About Nilzora');
    expect(infoPage('shipping')?.title).toBe('Delivery policy');
    expect(infoPage('faq')).toBeUndefined();
    expect(infoPage('')).toBeUndefined();
  });

  it('points each page at other pages that exist', () => {
    const known = new Set([
      'shop',
      'faq',
      'privacy',
      'terms',
      'about',
      'support',
      'returns',
      'shipping',
    ]);
    for (const page of PAGES) {
      expect(page.related.length).toBeGreaterThan(0);
      for (const key of page.related) expect(known.has(key)).toBe(true);
    }
  });

  it('never puts a contact detail, a link or a phone number in the wording', () => {
    for (const line of ALL_TEXT) {
      expect(line).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
      expect(line).not.toMatch(/https?:\/\//);
      // A run of digits long enough to be a phone number is a decision, not copy.
      expect(line).not.toMatch(/\d{5,}/);
    }
  });

  it('does not promise a delivery time, a refund deadline or a retention period', () => {
    for (const line of ALL_TEXT) {
      expect(line).not.toMatch(/\bwithin \d+ (business )?(days?|hours?|weeks?)\b/i);
      expect(line).not.toMatch(/\brefunds? (within|in) \d+/i);
      expect(line).not.toMatch(/\bwe keep (your )?(data|information) for \d+/i);
    }
  });

  it('makes headings usable as anchors', () => {
    expect(sectionAnchor('What you give us')).toBe('what-you-give-us');
    expect(sectionAnchor('Cookies on the website')).toBe('cookies-on-the-website');
    expect(sectionAnchor('Your account')).toBe('your-account');
    for (const page of PAGES) {
      const anchors = page.sections.map((section) => sectionAnchor(section.heading));
      expect(new Set(anchors).size).toBe(anchors.length);
    }
  });
});

describe('FAQ', () => {
  it('gives every question a unique id and a known category', () => {
    const ids = FAQ_ENTRIES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    const categories = new Set<string>(FAQ_CATEGORIES);
    for (const entry of FAQ_ENTRIES) {
      expect(categories.has(entry.category)).toBe(true);
      expect(entry.question.trim().endsWith('?')).toBe(true);
      expect(entry.answer.trim().length).toBeGreaterThan(40);
    }
  });

  it('covers every category with at least one question', () => {
    for (const group of groupFaq(FAQ_ENTRIES)) {
      expect(group.entries.length).toBeGreaterThan(0);
    }
    expect(groupFaq(FAQ_ENTRIES)).toHaveLength(FAQ_CATEGORIES.length);
  });

  it('matches every word the customer typed, in any order', () => {
    const byId = (id: string) => {
      const found = FAQ_ENTRIES.find((entry) => entry.id === id);
      if (found === undefined) throw new Error(`missing FAQ ${id}`);
      return found;
    };
    expect(faqMatches(byId('payment-methods'), 'cash delivery')).toBe(true);
    expect(faqMatches(byId('payment-methods'), 'delivery cash')).toBe(true);
    expect(faqMatches(byId('payment-methods'), 'cash refund')).toBe(false);
    expect(faqMatches(byId('payment-methods'), '   ')).toBe(true);
  });

  it('searches questions and answers, ignoring capitals and extra spaces', () => {
    const results = searchFaq('  bKash ');
    expect(results.map((entry) => entry.id)).toContain('cards-and-wallets');
    expect(searchFaq('').length).toBe(FAQ_ENTRIES.length);
    expect(searchFaq('nothing-matches-this')).toEqual([]);
  });

  it('keeps the groups the search left empty out of the page', () => {
    const groups = groupFaq(searchFaq('bKash'));
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe('Payment');
  });
});

describe('contact block', () => {
  const profile = publicStoreProfileSchema.parse({
    displayName: 'Nilzora',
    supportEmail: 'support@example.test',
    contactEmail: 'hello@example.test',
    supportPhone: '+8801700000000',
    addressLine: 'House 1, Road 2',
    addressArea: 'Banani',
    addressDistrict: 'Dhaka',
    logoUrl: null,
    updatedAt: '2026-11-07T00:00:00.000Z',
  });

  it('prefers the support details over the general ones', () => {
    expect(storeContactDetails(profile)).toEqual({
      email: 'support@example.test',
      phone: '+8801700000000',
      address: 'House 1, Road 2, Banani, Dhaka',
    });
  });

  it('lists only what the store published', () => {
    const section = storeContactSection(profile);
    expect(section.heading).toBe('Contacting Nilzora');
    expect(section.bullets).toEqual([
      'Email: support@example.test',
      'Phone: +8801700000000',
      'Address: House 1, Road 2, Banani, Dhaka',
    ]);
  });

  it('says the details could not be read — not that none exist — when the profile is unavailable', () => {
    const section = storeContactSection(null);
    expect(section.bullets).toBeUndefined();
    expect(section.paragraphs.join(' ')).toContain('could not be read just now');
  });

  it('says nothing is published when the store published a profile with no details', () => {
    const empty = publicStoreProfileSchema.parse({
      displayName: 'Nilzora',
      logoUrl: null,
      updatedAt: '2026-11-07T00:00:00.000Z',
    });
    const section = storeContactSection(empty);
    expect(section.bullets).toBeUndefined();
    expect(section.paragraphs.join(' ')).toContain('has not published contact details');
  });
});
