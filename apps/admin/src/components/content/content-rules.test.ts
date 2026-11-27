import { describe, expect, it } from 'vitest';
import {
  checkHomepage,
  checkMenuItem,
  checkSitePage,
  homepageRows,
  isMenuName,
  isSitePageSlug,
  moveId,
  rowsFromForm,
  storefrontPagePath,
  takesFilter,
  HOMEPAGE_SECTION_KEYS,
  type HomepageRow,
} from './content-rules';

/*
 * The storefront-content forms check what staff type with the contract schemas the Server
 * Actions and the API use. These tests pin the messages staff see and what is sent.
 */

describe('slug and menu names', () => {
  it('accepts only the six pages and three menus the storefront has', () => {
    expect(['about', 'privacy', 'terms', 'returns', 'shipping', 'faq'].every(isSitePageSlug)).toBe(
      true,
    );
    expect(isSitePageSlug('contact')).toBe(false);
    expect(isSitePageSlug('../about')).toBe(false);
    expect(['header', 'footer_shop', 'footer_help'].every(isMenuName)).toBe(true);
    expect(isMenuName('sidebar')).toBe(false);
  });

  it('places a page at the address the storefront serves it from', () => {
    expect(storefrontPagePath('about')).toBe('/about');
    expect(storefrontPagePath('faq').startsWith('/help')).toBe(true);
  });
});

describe('checkSitePage', () => {
  const page = {
    title: ' About us ',
    body: 'Line one\r\n\r\nLine two  ',
    seoTitle: '',
    seoDescription: ' ',
  };

  it('trims the title, keeps the text as written apart from line endings, and nulls empty metadata', () => {
    const checked = checkSitePage(page, true);
    expect(checked).toEqual({
      ok: true,
      value: {
        title: 'About us',
        body: 'Line one\n\nLine two  ',
        isPublished: true,
        seoTitle: null,
        seoDescription: null,
      },
    });
  });

  it('lets a draft be empty but not a published page', () => {
    expect(checkSitePage({ ...page, body: '' }, false).ok).toBe(true);
    const published = checkSitePage({ ...page, body: '   ' }, true);
    expect(published.ok).toBe(false);
    if (!published.ok) {
      expect(published.errors.body).toBe(
        'A published page needs text. Write it, or save it as a draft.',
      );
    }
  });

  it('explains an empty or over-long title, a long body, search fields and control characters', () => {
    const empty = checkSitePage({ ...page, title: '  ' }, false);
    expect(!empty.ok && empty.errors.title).toBe('Enter a title of up to 120 characters.');

    const long = checkSitePage(
      {
        title: 'x'.repeat(121),
        body: 'y'.repeat(20_001),
        seoTitle: 's'.repeat(71),
        seoDescription: 'd'.repeat(201),
      },
      false,
    );
    expect(long.ok).toBe(false);
    if (!long.ok) {
      expect(long.errors).toMatchObject({
        title: 'Enter a title of up to 120 characters.',
        body: 'Keep the text under 20,000 characters.',
        seoTitle: 'Keep the search title under 70 characters.',
        seoDescription: 'Keep the search description under 200 characters.',
      });
    }

    const control = checkSitePage({ ...page, body: 'a\u0001b' }, false);
    expect(!control.ok && control.errors.body).toBe('Remove the control characters from the text.');
  });
});

describe('checkMenuItem', () => {
  it('trims and accepts a store path or an https address', () => {
    expect(checkMenuItem({ menu: 'header', label: ' Sale ', href: ' /products ' }, true)).toEqual({
      ok: true,
      value: { menu: 'header', label: 'Sale', href: '/products', isActive: true },
    });
    expect(
      checkMenuItem({ menu: 'footer_help', label: 'Blog', href: 'https://blog.example/x' }, false)
        .ok,
    ).toBe(true);
  });

  it.each(['http://plain.example', '//evil.example', 'javascript:alert(1)', 'products', ''])(
    'refuses the link %j with the link message',
    (href) => {
      const checked = checkMenuItem({ menu: 'header', label: 'Sale', href }, true);
      expect(checked.ok).toBe(false);
      if (!checked.ok) {
        expect(checked.errors.href).toBe(
          'Use a store path such as /products, or an https address.',
        );
      }
    },
  );

  it('refuses an unknown menu, an empty label and a label over 40 characters', () => {
    const checked = checkMenuItem({ menu: 'sidebar', label: '', href: '/x' }, true);
    expect(checked.ok).toBe(false);
    if (!checked.ok) {
      expect(checked.errors.menu).toBe('Choose which menu the link belongs to.');
      expect(checked.errors.label).toBe('Enter a label of up to 40 characters.');
    }
    const long = checkMenuItem({ menu: 'header', label: 'x'.repeat(41), href: '/x' }, true);
    expect(!long.ok && long.errors.label).toBe('Enter a label of up to 40 characters.');
  });
});

describe('moveId', () => {
  const ids = ['a', 'b', 'c'];

  it('swaps a link with its neighbour without changing the original list', () => {
    expect(moveId(ids, 'b', 'earlier')).toEqual(['b', 'a', 'c']);
    expect(moveId(ids, 'b', 'later')).toEqual(['a', 'c', 'b']);
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('cannot move past either end, or move an id that is not in the list', () => {
    expect(moveId(ids, 'a', 'earlier')).toBeUndefined();
    expect(moveId(ids, 'c', 'later')).toBeUndefined();
    expect(moveId(ids, 'z', 'later')).toBeUndefined();
  });
});

describe('homepage rows', () => {
  const rows = (): HomepageRow[] =>
    HOMEPAGE_SECTION_KEYS.map((key) => ({
      key,
      isEnabled: true,
      title: '',
      itemLimit: '',
      categorySlug: '',
      brandSlug: '',
    }));
  const withRow = (key: string, patch: Partial<HomepageRow>) =>
    rows().map((row) => (row.key === key ? { ...row, ...patch } : row));

  it('sends every section in the order shown, with nulls for the built-in heading and limit', () => {
    const checked = checkHomepage(rows());
    expect(checked.ok).toBe(true);
    if (checked.ok) {
      expect(checked.value.sections.map((section) => section.key)).toEqual([
        ...HOMEPAGE_SECTION_KEYS,
      ]);
      expect(checked.value.sections[0]).toMatchObject({
        isEnabled: true,
        title: null,
        itemLimit: null,
      });
    }
  });

  it('keeps the order of the rows it is given', () => {
    const reversed = [...rows()].reverse();
    const checked = checkHomepage(reversed);
    expect(checked.ok && checked.value.sections.map((section) => section.key)).toEqual(
      reversed.map((row) => row.key),
    );
  });

  it('accepts 1 to 24 items and marks 0, 25 and non-numbers on that section', () => {
    expect(checkHomepage(withRow('featured', { itemLimit: '24' })).ok).toBe(true);
    for (const bad of ['0', '25', '1.5', 'many', '-3']) {
      const checked = checkHomepage(withRow('featured', { itemLimit: bad }));
      expect(checked.ok).toBe(false);
      if (!checked.ok) {
        expect(checked.errors.itemLimit_featured).toBe(
          'Use a whole number from 1 to 24, or leave it empty.',
        );
        expect(Object.keys(checked.errors)).toEqual(['itemLimit_featured']);
      }
    }
  });

  it('marks a heading over 60 characters on that section', () => {
    const checked = checkHomepage(withRow('categories', { title: 'x'.repeat(61) }));
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.errors.title_categories).toBeDefined();
  });

  it('takes a category or brand filter only for the two product rows', () => {
    expect(takesFilter('featured')).toBe(true);
    expect(takesFilter('new_arrivals')).toBe(true);
    expect(takesFilter('brands')).toBe(false);

    const checked = checkHomepage([
      ...withRow('featured', { categorySlug: ' eid ', brandSlug: 'acme' }).map((row) =>
        // A smuggled filter on a row that takes none is dropped, not sent.
        row.key === 'brands' ? { ...row, categorySlug: 'eid' } : row,
      ),
    ]);
    expect(checked.ok).toBe(true);
    if (checked.ok) {
      const byKey = Object.fromEntries(
        checked.value.sections.map((section) => [section.key, section]),
      );
      expect(byKey.featured?.config).toEqual({ categorySlug: 'eid', brandSlug: 'acme' });
      expect(byKey.brands?.config).toEqual({});
    }
  });

  it('turns saved sections into rows in the saved order and back into text', () => {
    const saved = [
      { key: 'brands', isEnabled: false, title: null, itemLimit: null, config: {}, sortOrder: 2 },
      {
        key: 'featured',
        isEnabled: true,
        title: 'Picks',
        itemLimit: 8,
        config: { categorySlug: 'eid' },
        sortOrder: 1,
      },
    ] as const;
    expect(homepageRows(saved)).toEqual([
      {
        key: 'featured',
        isEnabled: true,
        title: 'Picks',
        itemLimit: '8',
        categorySlug: 'eid',
        brandSlug: '',
      },
      {
        key: 'brands',
        isEnabled: false,
        title: '',
        itemLimit: '',
        categorySlug: '',
        brandSlug: '',
      },
    ]);
  });
});

describe('rowsFromForm', () => {
  function form(fields: Record<string, string>): FormData {
    const data = new FormData();
    for (const [name, value] of Object.entries(fields)) data.set(name, value);
    return data;
  }

  it('reads enabled boxes as checked only when they say on', () => {
    const rows = rowsFromForm(form({ enabled_hero: 'on', enabled_brands: 'true' }));
    expect(rows.find((row) => row.key === 'hero')?.isEnabled).toBe(true);
    expect(rows.find((row) => row.key === 'brands')?.isEnabled).toBe(false);
    expect(rows).toHaveLength(HOMEPAGE_SECTION_KEYS.length);
  });

  it('orders rows by the position typed beside each, keeping the default order for ties and nonsense', () => {
    const rows = rowsFromForm(
      form({
        position_services: '1',
        position_hero: '2',
        position_brands: 'abc',
        position_featured: '-4',
      }),
    );
    expect(rows[0]?.key).toBe('services');
    expect(rows[1]?.key).toBe('hero');
    // Positions that are not positive numbers fall back to the section's own place.
    expect(rows.map((row) => row.key).slice(2)).toEqual(
      HOMEPAGE_SECTION_KEYS.filter((key) => key !== 'services' && key !== 'hero'),
    );
  });
});
