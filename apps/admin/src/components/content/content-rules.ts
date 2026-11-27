import {
  HOMEPAGE_ITEM_LIMIT_MAX,
  HOMEPAGE_SECTION_KEYS,
  MENU_MAX_ITEMS,
  MENU_NAMES,
  saveHomepageRequestSchema,
  saveMenuItemRequestSchema,
  saveSitePageRequestSchema,
  SITE_PAGE_BODY_MAX,
  SITE_PAGE_PATHS,
  SITE_PAGE_SLUGS,
  type HomepageSectionKey,
  type MenuName,
  type SaveHomepageRequest,
  type SaveMenuItemRequest,
  type SaveSitePageRequest,
  type SitePageSlug,
} from '@nilzora/contracts';

/*
 * The storefront-content forms' rules (static pages, navigation menus, homepage sections),
 * shared by the forms (which check while staff type) and the Server Actions (which check
 * again before calling the API, which checks a third time) through the contract schemas.
 * Free of server and Next.js imports.
 */

export type FieldErrors = Partial<Record<string, string>>;
export type Checked<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

type Issue = { path: readonly PropertyKey[]; message: string };

function errorsFrom(issues: readonly Issue[], messages: FieldErrors, rowKey?: string): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field !== 'string') continue;
    errors[rowKey ? `${field}_${rowKey}` : field] ??= messages[field] ?? issue.message;
  }
  return errors;
}

function nullable(value: string | undefined): string | null {
  const text = (value ?? '').trim();
  return text === '' ? null : text;
}

export function isSitePageSlug(value: string): value is SitePageSlug {
  return (SITE_PAGE_SLUGS as readonly string[]).includes(value);
}

export function isMenuName(value: string): value is MenuName {
  return (MENU_NAMES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Static pages
// ---------------------------------------------------------------------------

export const SITE_PAGE_LABELS: Record<SitePageSlug, string> = {
  about: 'About us',
  privacy: 'Privacy policy',
  terms: 'Terms and conditions',
  returns: 'Returns policy',
  shipping: 'Shipping and delivery',
  faq: 'Frequently asked questions',
};

export const SITE_PAGE_LIMITS = {
  title: 120,
  body: SITE_PAGE_BODY_MAX,
  seoTitle: 70,
  seoDescription: 200,
} as const;

const PAGE_MESSAGES: FieldErrors = {
  title: 'Enter a title of up to 120 characters.',
  seoTitle: 'Keep the search title under 70 characters.',
  seoDescription: 'Keep the search description under 200 characters.',
};

export function storefrontPagePath(slug: SitePageSlug): string {
  return SITE_PAGE_PATHS[slug];
}

export function checkSitePage(
  values: Partial<Record<'title' | 'body' | 'seoTitle' | 'seoDescription', string>>,
  isPublished: boolean,
): Checked<SaveSitePageRequest> {
  const parsed = saveSitePageRequestSchema.safeParse({
    title: (values.title ?? '').trim(),
    // The text is kept as written: only the line endings are normalised.
    body: (values.body ?? '').replace(/\r\n?/g, '\n'),
    isPublished,
    seoTitle: nullable(values.seoTitle),
    seoDescription: nullable(values.seoDescription),
  });
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    errors: errorsFrom(parsed.error.issues, {
      ...PAGE_MESSAGES,
      body:
        isPublished && (values.body ?? '').trim() === ''
          ? 'A published page needs text. Write it, or save it as a draft.'
          : (values.body ?? '').length > SITE_PAGE_BODY_MAX
            ? `Keep the text under ${SITE_PAGE_BODY_MAX.toLocaleString('en-US')} characters.`
            : 'Remove the control characters from the text.',
    }),
  };
}

// ---------------------------------------------------------------------------
// Navigation menus
// ---------------------------------------------------------------------------

export const MENU_LABELS: Record<MenuName, { title: string; description: string }> = {
  header: {
    title: 'Header menu',
    description: 'The links across the top of every storefront page.',
  },
  footer_shop: { title: 'Footer: Shop', description: 'The shopping links in the footer.' },
  footer_help: { title: 'Footer: Help', description: 'The help and policy links in the footer.' },
};

export { MENU_MAX_ITEMS, MENU_NAMES };

const MENU_MESSAGES: FieldErrors = {
  menu: 'Choose which menu the link belongs to.',
  label: 'Enter a label of up to 40 characters.',
  href: 'Use a store path such as /products, or an https address.',
};

export function checkMenuItem(
  values: Partial<Record<'menu' | 'label' | 'href', string>>,
  isActive: boolean,
): Checked<SaveMenuItemRequest> {
  const parsed = saveMenuItemRequestSchema.safeParse({
    menu: values.menu,
    label: (values.label ?? '').trim(),
    href: (values.href ?? '').trim(),
    isActive,
  });
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, errors: errorsFrom(parsed.error.issues, MENU_MESSAGES) };
}

/** `ids` with the one named moved a place; undefined when it cannot move that way. */
export function moveId(
  ids: readonly string[],
  id: string,
  direction: 'earlier' | 'later',
): string[] | undefined {
  const index = ids.indexOf(id);
  const target = direction === 'earlier' ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= ids.length) return undefined;
  const next = [...ids];
  [next[index], next[target]] = [next[target] as string, next[index] as string];
  return next;
}

// ---------------------------------------------------------------------------
// Homepage sections
// ---------------------------------------------------------------------------

export const HOMEPAGE_LABELS: Record<HomepageSectionKey, { title: string; description: string }> = {
  hero: {
    title: 'Hero banner',
    description: 'The large banner at the top. Its pictures are the Homepage hero banners.',
  },
  categories: { title: 'Categories', description: 'Shortcuts to the store’s categories.' },
  featured: { title: 'Featured products', description: 'A row of the products you feature.' },
  new_arrivals: { title: 'New arrivals', description: 'A row of the newest products on sale.' },
  brands: { title: 'Brands', description: 'A row of the store’s brands.' },
  promotions: {
    title: 'Promotions',
    description: 'The campaign banners. Their pictures are the Homepage campaign banners.',
  },
  services: { title: 'Services', description: 'The services strip.' },
};

/** The product rows may narrow to one category and/or brand. */
export function takesFilter(key: HomepageSectionKey): boolean {
  return key === 'featured' || key === 'new_arrivals';
}

export { HOMEPAGE_ITEM_LIMIT_MAX, HOMEPAGE_SECTION_KEYS };

export interface HomepageRow {
  key: HomepageSectionKey;
  isEnabled: boolean;
  title: string;
  itemLimit: string;
  categorySlug: string;
  brandSlug: string;
}

const HOMEPAGE_MESSAGES: FieldErrors = {
  title: 'Keep the heading to 1–60 characters, or leave it empty for the built-in one.',
  itemLimit: `Use a whole number from 1 to ${String(HOMEPAGE_ITEM_LIMIT_MAX)}, or leave it empty.`,
  config: 'Choose an existing category or brand.',
};

/** Rows in the order to show them; errors are keyed `field_sectionKey`. */
export function checkHomepage(rows: readonly HomepageRow[]): Checked<SaveHomepageRequest> {
  const errors: FieldErrors = {};
  const sections = rows.map((row) => {
    const limitText = row.itemLimit.trim();
    const limit =
      limitText === '' ? null : /^\d{1,3}$/.test(limitText) ? Number(limitText) : Number.NaN;
    if (Number.isNaN(limit)) errors[`itemLimit_${row.key}`] = HOMEPAGE_MESSAGES.itemLimit;
    const config: { categorySlug?: string; brandSlug?: string } = {};
    if (takesFilter(row.key)) {
      if (row.categorySlug.trim() !== '') config.categorySlug = row.categorySlug.trim();
      if (row.brandSlug.trim() !== '') config.brandSlug = row.brandSlug.trim();
    }
    return {
      key: row.key,
      isEnabled: row.isEnabled,
      title: nullable(row.title),
      itemLimit: Number.isNaN(limit) ? null : limit,
      config,
    };
  });
  const parsed = saveHomepageRequestSchema.safeParse({ sections });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const index = issue.path[1];
      const field = issue.path[2];
      const row = typeof index === 'number' ? rows[index] : undefined;
      if (!row || typeof field !== 'string') continue;
      errors[`${field}_${row.key}`] ??=
        HOMEPAGE_MESSAGES[field === 'config' ? 'config' : field] ?? issue.message;
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, errors };
}

/** The saved sections as editable rows, in the order saved. */
export function homepageRows(
  sections: readonly {
    key: HomepageSectionKey;
    isEnabled: boolean;
    title: string | null;
    itemLimit: number | null;
    config: { categorySlug?: string | undefined; brandSlug?: string | undefined };
    sortOrder: number;
  }[],
): HomepageRow[] {
  return [...sections]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((section) => ({
      key: section.key,
      isEnabled: section.isEnabled,
      title: section.title ?? '',
      itemLimit: section.itemLimit === null ? '' : String(section.itemLimit),
      categorySlug: section.config.categorySlug ?? '',
      brandSlug: section.config.brandSlug ?? '',
    }));
}

/** The rows of the homepage form, sorted by the position typed beside each (ties keep the saved order). */
export function rowsFromForm(formData: FormData): HomepageRow[] {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === 'string' ? value : '';
  };
  const rows = HOMEPAGE_SECTION_KEYS.map((key, index) => {
    const position = Number(text(`position_${key}`));
    return {
      index,
      position: Number.isFinite(position) && position > 0 ? position : index + 1,
      row: {
        key,
        isEnabled: text(`enabled_${key}`) === 'on',
        title: text(`title_${key}`),
        itemLimit: text(`itemLimit_${key}`),
        categorySlug: text(`categorySlug_${key}`),
        brandSlug: text(`brandSlug_${key}`),
      } satisfies HomepageRow,
    };
  });
  return rows.sort((a, b) => a.position - b.position || a.index - b.index).map((item) => item.row);
}
