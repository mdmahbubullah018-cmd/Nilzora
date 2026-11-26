import {
  adminHomepageSectionSchema,
  adminSitePageSchema,
  menuItemSchema,
  type AdminHomepageSection,
  type AdminSitePage,
  type MenuItem,
  type MenuName,
  type saveHomepageRequestSchema,
  type saveMenuItemRequestSchema,
  type saveSitePageRequestSchema,
  type SitePageSlug,
} from '@nilzora/contracts';
import type { Pool } from 'pg';
import { z } from 'zod';
import { withUser } from '../../db/user-context';
import type { SupabaseClients } from '../../supabase/clients';
import { toAdminStoreError } from '../admin/errors';
import { conform, isoTimestamp, StoreUnavailableError } from '../commerce/errors';

/*
 * Static pages, navigation links and homepage sections, as staff manage them. Every
 * method is a database function that checks settings.manage for the CALLER and writes the
 * audit log; the API validates the request first and never decides who may do what.
 * (The public reads of the same content are on SiteStore, next to the store profile.)
 */

export interface SiteContentStore {
  /** Every known page, written or not, in the store's order. */
  listPages(accessToken: string, userId: string): Promise<AdminSitePage[]>;
  savePage(
    accessToken: string,
    userId: string,
    slug: SitePageSlug,
    input: SaveSitePageInput,
  ): Promise<AdminSitePage>;
  listMenuItems(accessToken: string, userId: string): Promise<MenuItem[]>;
  /** Creates a link (null id, added last) or changes one (its menu cannot change). */
  saveMenuItem(
    accessToken: string,
    userId: string,
    id: string | null,
    input: SaveMenuItemInput,
  ): Promise<MenuItem>;
  deleteMenuItem(accessToken: string, userId: string, id: string): Promise<void>;
  /** Orders one menu; answers every link of every menu. */
  reorderMenu(
    accessToken: string,
    userId: string,
    menu: MenuName,
    ids: readonly string[],
  ): Promise<MenuItem[]>;
  listHomepage(accessToken: string, userId: string): Promise<AdminHomepageSection[]>;
  saveHomepage(
    accessToken: string,
    userId: string,
    sections: SaveHomepageInput['sections'],
  ): Promise<AdminHomepageSection[]>;
}

/** The validated (parsed) shapes of the requests. */
export type SaveSitePageInput = z.output<typeof saveSitePageRequestSchema>;
export type SaveMenuItemInput = z.output<typeof saveMenuItemRequestSchema>;
export type SaveHomepageInput = z.output<typeof saveHomepageRequestSchema>;

/** jsonb writes a timestamp as `…+00:00`; the contracts require the `Z` form. */
function withIsoUpdatedAt<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withIsoUpdatedAt) as T;
  if (value !== null && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return typeof row.updatedAt === 'string'
      ? ({ ...row, updatedAt: isoTimestamp(row.updatedAt) } as T)
      : value;
  }
  return value;
}

const pagesSchema = z.array(adminSitePageSchema);
const itemsSchema = z.array(menuItemSchema);
const sectionsSchema = z.array(adminHomepageSectionSchema);

function sectionsPayload(sections: SaveHomepageInput['sections']): string {
  return JSON.stringify(
    sections.map((section) => ({
      key: section.key,
      isEnabled: section.isEnabled,
      title: section.title,
      itemLimit: section.itemLimit,
      config: section.config,
    })),
  );
}

export function createSupabaseSiteContentStore(clients: SupabaseClients): SiteContentStore {
  async function call(
    accessToken: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const client = clients.asUser(accessToken);
    const rpc = client.rpc.bind(client) as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { code: string; message: string } | null }>;
    const { data, error } = await rpc(name, args);
    if (error) throw toAdminStoreError(error, name);
    return data;
  }

  return {
    async listPages(accessToken) {
      return conform(
        pagesSchema,
        withIsoUpdatedAt(await call(accessToken, 'admin_list_site_pages', {})),
        'admin_list_site_pages',
      );
    },
    async savePage(accessToken, _userId, slug, input) {
      const data = await call(accessToken, 'admin_save_site_page', {
        p_slug: slug,
        p_title: input.title,
        p_body: input.body,
        p_is_published: input.isPublished,
        p_seo_title: input.seoTitle,
        p_seo_description: input.seoDescription,
      });
      return conform(adminSitePageSchema, withIsoUpdatedAt(data), 'admin_save_site_page');
    },
    async listMenuItems(accessToken) {
      return conform(
        itemsSchema,
        withIsoUpdatedAt(await call(accessToken, 'admin_list_menu_items', {})),
        'admin_list_menu_items',
      );
    },
    async saveMenuItem(accessToken, _userId, id, input) {
      const data = await call(accessToken, 'admin_save_menu_item', {
        p_id: id,
        p_menu: input.menu,
        p_label: input.label,
        p_href: input.href,
        p_is_active: input.isActive,
      });
      return conform(menuItemSchema, withIsoUpdatedAt(data), 'admin_save_menu_item');
    },
    async deleteMenuItem(accessToken, _userId, id) {
      await call(accessToken, 'admin_delete_menu_item', { p_id: id });
    },
    async reorderMenu(accessToken, _userId, menu, ids) {
      const data = await call(accessToken, 'admin_reorder_menu', { p_menu: menu, p_ids: [...ids] });
      return conform(itemsSchema, withIsoUpdatedAt(data), 'admin_reorder_menu');
    },
    async listHomepage(accessToken) {
      return conform(
        sectionsSchema,
        withIsoUpdatedAt(await call(accessToken, 'admin_homepage', {})),
        'admin_homepage',
      );
    },
    async saveHomepage(accessToken, _userId, sections) {
      const data = await call(accessToken, 'admin_save_homepage', {
        p_sections: JSON.parse(sectionsPayload(sections)) as unknown,
      });
      return conform(sectionsSchema, withIsoUpdatedAt(data), 'admin_save_homepage');
    },
  };
}

/** PostgreSQL exposes custom SQLSTATEs (`NZ4xx`, `23514`) as a string `code`. */
function pgFailure(error: unknown): { code: string; message: string; details: string | null } {
  const fields = error as { code?: unknown; message?: unknown; detail?: unknown } | null;
  return {
    code: typeof fields?.code === 'string' ? fields.code : '',
    message: typeof fields?.message === 'string' ? fields.message : 'database request failed',
    details: typeof fields?.detail === 'string' ? fields.detail : null,
  };
}

/** The same store over a direct connection, always as the signed-in caller. */
export function createPostgresSiteContentStore(pool: Pool): SiteContentStore {
  async function value(
    userId: string,
    operation: string,
    sql: string,
    values: unknown[],
  ): Promise<unknown> {
    try {
      return await withUser(pool, userId, async (client) => {
        const result = await client.query<{ value: unknown }>(sql, values);
        return result.rows[0]?.value ?? null;
      });
    } catch (error) {
      if (error instanceof StoreUnavailableError) throw error;
      throw toAdminStoreError(pgFailure(error), operation);
    }
  }

  return {
    async listPages(_token, userId) {
      return conform(
        pagesSchema,
        withIsoUpdatedAt(
          await value(
            userId,
            'admin_list_site_pages',
            'select public.admin_list_site_pages() as value',
            [],
          ),
        ),
        'admin_list_site_pages',
      );
    },
    async savePage(_token, userId, slug, input) {
      const data = await value(
        userId,
        'admin_save_site_page',
        'select public.admin_save_site_page($1, $2, $3, $4, $5, $6) as value',
        [slug, input.title, input.body, input.isPublished, input.seoTitle, input.seoDescription],
      );
      return conform(adminSitePageSchema, withIsoUpdatedAt(data), 'admin_save_site_page');
    },
    async listMenuItems(_token, userId) {
      return conform(
        itemsSchema,
        withIsoUpdatedAt(
          await value(
            userId,
            'admin_list_menu_items',
            'select public.admin_list_menu_items() as value',
            [],
          ),
        ),
        'admin_list_menu_items',
      );
    },
    async saveMenuItem(_token, userId, id, input) {
      const data = await value(
        userId,
        'admin_save_menu_item',
        'select public.admin_save_menu_item($1::uuid, $2, $3, $4, $5) as value',
        [id, input.menu, input.label, input.href, input.isActive],
      );
      return conform(menuItemSchema, withIsoUpdatedAt(data), 'admin_save_menu_item');
    },
    async deleteMenuItem(_token, userId, id) {
      await value(
        userId,
        'admin_delete_menu_item',
        'select public.admin_delete_menu_item($1::uuid) as value',
        [id],
      );
    },
    async reorderMenu(_token, userId, menu, ids) {
      const data = await value(
        userId,
        'admin_reorder_menu',
        'select public.admin_reorder_menu($1, $2::uuid[]) as value',
        [menu, [...ids]],
      );
      return conform(itemsSchema, withIsoUpdatedAt(data), 'admin_reorder_menu');
    },
    async listHomepage(_token, userId) {
      return conform(
        sectionsSchema,
        withIsoUpdatedAt(
          await value(userId, 'admin_homepage', 'select public.admin_homepage() as value', []),
        ),
        'admin_homepage',
      );
    },
    async saveHomepage(_token, userId, sections) {
      const data = await value(
        userId,
        'admin_save_homepage',
        'select public.admin_save_homepage($1::jsonb) as value',
        [sectionsPayload(sections)],
      );
      return conform(sectionsSchema, withIsoUpdatedAt(data), 'admin_save_homepage');
    },
  };
}
