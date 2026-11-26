import { randomUUID } from 'node:crypto';
import {
  HOMEPAGE_SECTION_KEYS,
  MENU_MAX_ITEMS,
  SITE_PAGE_SLUGS,
  type AdminHomepageSection,
  type AdminSitePage,
  type HomepageSection,
  type MenuItem,
  type MenuName,
  type Navigation,
  type PublicSitePage,
  type SitePageSlug,
} from '@nilzora/contracts';
import { toAdminStoreError } from '../modules/admin/errors';
import type { SiteContentStore } from '../modules/site/content-store';
import type { FakeIdentity } from './fakes';

/*
 * In-memory stand-ins for the static-page, navigation and homepage functions. Like the
 * database they check the CALLER's settings.manage (NZ403), refuse unknown pages and links
 * (NZ404) and invalid input (NZ412), keep a draft page out of public reads, and record
 * audit rows. The SQL itself is covered by supabase/tests/storefront_management.test.sql.
 */

function raise(code: string): never {
  throw toAdminStoreError(
    { code, message: 'internal detail: private.site_page_json', details: null },
    'fake',
  );
}

const TITLES: Readonly<Record<SitePageSlug, string>> = {
  about: 'About us',
  privacy: 'Privacy policy',
  terms: 'Terms of service',
  returns: 'Returns and refunds',
  shipping: 'Delivery information',
  faq: 'Frequently asked questions',
};

const AT = '2026-11-08T08:00:00.000Z';

/** Today's home page, as the migration seeds it. */
const DEFAULT_ORDER = [
  'hero',
  'services',
  'categories',
  'new_arrivals',
  'featured',
  'promotions',
  'brands',
] as const;

export class FakeContent implements SiteContentStore {
  readonly pages = new Map<SitePageSlug, AdminSitePage>();
  readonly items: MenuItem[] = [];
  sections: AdminHomepageSection[] = DEFAULT_ORDER.map((key, index) => ({
    key,
    title: null,
    itemLimit: null,
    config: {},
    isEnabled: true,
    sortOrder: index,
    updatedAt: AT,
  }));
  readonly audits: { actorId: string; action: string }[] = [];
  /** The next store call fails with this SQLSTATE, as the database would. */
  nextFailure: string | undefined;
  private tick = 0;

  constructor(
    private readonly identity: FakeIdentity,
    private readonly enter: (operation: string) => void,
  ) {}

  private now(): string {
    this.tick += 1;
    return new Date(Date.UTC(2026, 10, 8, 9, 0, this.tick)).toISOString();
  }

  /** private.require_permission('settings.manage'): the caller's id, or NZ403. */
  private manager(accessToken: string, operation: string): string {
    this.enter(operation);
    if (this.nextFailure) {
      const code = this.nextFailure;
      this.nextFailure = undefined;
      raise(code);
    }
    const user = this.identity.userFor(accessToken);
    if (!user) raise('42501');
    if (!this.identity.permissionsOf(user).has('settings.manage')) raise('NZ403');
    return user.id;
  }

  private audit(actorId: string, action: string): void {
    this.audits.push({ actorId, action });
  }

  /** What visitors may read: the published pages, active links and enabled sections. */
  publicPage(slug: SitePageSlug): PublicSitePage | null {
    const page = this.pages.get(slug);
    if (!page?.isPublished || page.updatedAt === null) return null;
    return {
      slug: page.slug,
      title: page.title,
      body: page.body,
      seoTitle: page.seoTitle,
      seoDescription: page.seoDescription,
      updatedAt: page.updatedAt,
    };
  }

  publicNavigation(): Navigation {
    const links = (menu: MenuName) =>
      this.items
        .filter((item) => item.menu === menu && item.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(({ label, href }) => ({ label, href }));
    return {
      menus: {
        header: links('header'),
        footerShop: links('footer_shop'),
        footerHelp: links('footer_help'),
      },
      pages: SITE_PAGE_SLUGS.flatMap((slug) => {
        const page = this.publicPage(slug);
        return page ? [{ slug, title: page.title }] : [];
      }),
    };
  }

  publicHomepage(): HomepageSection[] {
    return [...this.sections]
      .filter((section) => section.isEnabled)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(({ key, title, itemLimit, config }) => ({ key, title, itemLimit, config }));
  }

  listPages(accessToken: string): Promise<AdminSitePage[]> {
    this.manager(accessToken, 'content.listPages');
    return Promise.resolve(
      SITE_PAGE_SLUGS.map(
        (slug) =>
          this.pages.get(slug) ?? {
            slug,
            title: TITLES[slug],
            body: '',
            isPublished: false,
            seoTitle: null,
            seoDescription: null,
            updatedAt: null,
          },
      ),
    );
  }

  savePage(
    accessToken: string,
    _userId: string,
    slug: SitePageSlug,
    input: Parameters<SiteContentStore['savePage']>[3],
  ) {
    const actor = this.manager(accessToken, 'content.savePage');
    if (!SITE_PAGE_SLUGS.includes(slug)) raise('NZ404');
    if (input.isPublished && input.body.trim() === '') raise('NZ412');
    const page: AdminSitePage = {
      slug,
      title: input.title,
      body: input.body,
      isPublished: input.isPublished,
      seoTitle: input.seoTitle,
      seoDescription: input.seoDescription,
      updatedAt: this.now(),
    };
    this.pages.set(slug, page);
    this.audit(actor, 'site_page.saved');
    return Promise.resolve(page);
  }

  listMenuItems(accessToken: string): Promise<MenuItem[]> {
    this.manager(accessToken, 'content.listMenuItems');
    return Promise.resolve([...this.items].sort(byMenuThenOrder));
  }

  saveMenuItem(
    accessToken: string,
    _userId: string,
    id: string | null,
    input: Parameters<SiteContentStore['saveMenuItem']>[3],
  ) {
    const actor = this.manager(accessToken, 'content.saveMenuItem');
    if (id === null) {
      const inMenu = this.items.filter((item) => item.menu === input.menu);
      if (inMenu.length >= MENU_MAX_ITEMS) raise('NZ412');
      const item: MenuItem = {
        id: randomUUID(),
        menu: input.menu,
        label: input.label,
        href: input.href,
        sortOrder: inMenu.length === 0 ? 0 : Math.max(...inMenu.map((i) => i.sortOrder)) + 1,
        isActive: input.isActive,
        updatedAt: this.now(),
      };
      this.items.push(item);
      this.audit(actor, 'menu_item.saved');
      return Promise.resolve({ ...item });
    }
    const item = this.items.find(
      (candidate) => candidate.id === id && candidate.menu === input.menu,
    );
    if (!item) raise('NZ404');
    Object.assign(item, {
      label: input.label,
      href: input.href,
      isActive: input.isActive,
      updatedAt: this.now(),
    });
    this.audit(actor, 'menu_item.saved');
    return Promise.resolve({ ...item });
  }

  deleteMenuItem(accessToken: string, _userId: string, id: string): Promise<void> {
    const actor = this.manager(accessToken, 'content.deleteMenuItem');
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) raise('NZ404');
    this.items.splice(index, 1);
    this.audit(actor, 'menu_item.deleted');
    return Promise.resolve();
  }

  reorderMenu(accessToken: string, _userId: string, menu: MenuName, ids: readonly string[]) {
    const actor = this.manager(accessToken, 'content.reorderMenu');
    const current = this.items.filter((item) => item.menu === menu).map((item) => item.id);
    if (
      new Set(ids).size !== ids.length ||
      ids.length !== current.length ||
      !current.every((id) => ids.includes(id))
    ) {
      raise('NZ412');
    }
    ids.forEach((id, index) => {
      const item = this.items.find((candidate) => candidate.id === id);
      if (item) item.sortOrder = index;
    });
    this.audit(actor, 'menu.reordered');
    return Promise.resolve([...this.items].sort(byMenuThenOrder));
  }

  listHomepage(accessToken: string): Promise<AdminHomepageSection[]> {
    this.manager(accessToken, 'content.listHomepage');
    return Promise.resolve([...this.sections].sort((a, b) => a.sortOrder - b.sortOrder));
  }

  saveHomepage(
    accessToken: string,
    _userId: string,
    sections: Parameters<SiteContentStore['saveHomepage']>[2],
  ) {
    const actor = this.manager(accessToken, 'content.saveHomepage');
    if (
      sections.length !== HOMEPAGE_SECTION_KEYS.length ||
      new Set(sections.map((section) => section.key)).size !== sections.length
    ) {
      raise('NZ412');
    }
    this.sections = sections.map((section, index) => ({
      key: section.key,
      title: section.title,
      itemLimit: section.itemLimit,
      config: section.config,
      isEnabled: section.isEnabled,
      sortOrder: index,
      updatedAt: this.now(),
    }));
    this.audit(actor, 'homepage.saved');
    return Promise.resolve([...this.sections]);
  }
}

function byMenuThenOrder(a: MenuItem, b: MenuItem): number {
  return a.menu.localeCompare(b.menu) || a.sortOrder - b.sortOrder;
}
