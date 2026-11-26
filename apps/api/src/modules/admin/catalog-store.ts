import {
  adminAttributeSchema,
  adminCategorySchema,
  adminProductDetailSchema,
  adminProductSummarySchema,
  adminVariantSchema,
  inventoryMovementSchema,
  LOW_STOCK_THRESHOLD,
  slugAvailabilityResponseSchema,
  type AdminAttribute,
  type AdminCategory,
  type AdminProductDetail,
  type AdminSaveAttributeRequest,
  type AdminSaveAttributeValueRequest,
  type AdminSaveVariantRequest,
  type AdminVariant,
  type AdminProductSort,
  type AdminProductSummary,
  type categoryInputSchema,
  type createProductRequestSchema,
  type InventoryMovement,
  type InventoryReason,
  type ModerationStatus,
  type ProductStatus,
  type SlugAvailabilityResponse,
  type SlugKind,
  type updateProductRequestSchema,
} from '@nilzora/contracts';
import { z } from 'zod';
import type { Pool } from 'pg';
import { disabledCatalogCache, type CatalogCache } from '../../cache';
import { withUser } from '../../db/user-context';
import type { NilzoraSupabaseClient, SupabaseClients } from '../../supabase/clients';
import { conform, isoTimestamp, StoreUnavailableError } from '../commerce/errors';
import { FULL_FILE, IMAGE_COLUMNS, toProductImages, type ImageRow } from '../media/images';
import { toAdminStoreError } from './errors';
import {
  accountRef,
  RANGE_NOT_SATISFIABLE,
  sqlNull,
  staffNames,
  staffNamesForUser,
  type Page,
} from './shared';

export type CreateProductInput = z.output<typeof createProductRequestSchema>;
export type UpdateProductInput = z.output<typeof updateProductRequestSchema>;
export type CategoryInput = z.output<typeof categoryInputSchema>;

/** What admin_delete_product answers: the files to remove once the delete committed. */
const deletedFilesSchema = z.object({
  imageKeys: z.array(z.string()),
  videoKeys: z.array(z.string()),
});

export interface AdminProductFilters {
  /** Prepared by searchTerm(): letters, digits, spaces and hyphens only. */
  search?: string | undefined;
  status?: ProductStatus | undefined;
  moderationStatus?: ModerationStatus | undefined;
  categoryId?: string | undefined;
  stock?: 'low' | 'out' | undefined;
}

/** Column and direction of each admin product order; ties are broken by id. */
const PRODUCT_ORDER: Readonly<Record<AdminProductSort, readonly [string, boolean]>> = {
  updated_desc: ['updated_at', false],
  name_asc: ['name', true],
  name_desc: ['name', false],
  price_asc: ['price_minor', true],
  price_desc: ['price_minor', false],
  stock_asc: ['stock_quantity', true],
  stock_desc: ['stock_quantity', false],
};

/** A slug to check, as GET /admin/slugs/availability validated it. */
export interface SlugQuery {
  kind: SlugKind;
  slug: string;
  /** The item being edited, whose own address counts as free. */
  excludeId?: string | undefined;
}

export interface MovementFilters {
  productId?: string | undefined;
  reason?: InventoryReason | undefined;
}

/**
 * The admin catalog, always as the signed-in caller: reads run under Row Level Security
 * (products.read sees every product and category), and every change is a database
 * function that checks the caller's own permission again and writes the audit log.
 */
export interface AdminCatalogStore {
  /** In the given order (most recently changed first by default), ties broken by id. */
  listProducts(
    accessToken: string,
    userId: string,
    filters: AdminProductFilters,
    sort: AdminProductSort,
    page: Page,
  ): Promise<{ products: AdminProductSummary[]; total: number }>;
  getProduct(
    accessToken: string,
    userId: string,
    productId: string,
  ): Promise<AdminProductDetail | null>;
  createProduct(
    accessToken: string,
    userId: string,
    input: CreateProductInput,
  ): Promise<AdminProductDetail>;
  updateProduct(
    accessToken: string,
    userId: string,
    productId: string,
    input: UpdateProductInput,
  ): Promise<AdminProductDetail>;
  setProductStatus(
    accessToken: string,
    userId: string,
    productId: string,
    status: ProductStatus,
  ): Promise<AdminProductDetail>;
  adjustStock(
    accessToken: string,
    userId: string,
    productId: string,
    change: number,
    note: string,
  ): Promise<AdminProductDetail>;
  submitForReview(
    accessToken: string,
    userId: string,
    productId: string,
  ): Promise<AdminProductDetail>;
  /** Whether a product, category or brand address is free (admin_slug_availability). */
  slugAvailability(
    accessToken: string,
    userId: string,
    query: SlugQuery,
  ): Promise<SlugAvailabilityResponse>;
  /** Every category, hidden ones included, in storefront order. */
  listCategories(accessToken: string, userId: string): Promise<AdminCategory[]>;
  /** Creates a category (null id) or replaces one's fields. */
  saveCategory(
    accessToken: string,
    userId: string,
    categoryId: string | null,
    input: CategoryInput,
  ): Promise<AdminCategory>;
  /**
   * Deletes a category. The database refuses when products or subcategories still
   * reference it, so nothing is ever cascade-deleted.
   */
  /**
   * Rewrites the order of one group of categories (a parent's subcategories, or the top level
   * for a null parent) in one atomic step. The list must be exactly that group.
   */
  reorderCategories(
    accessToken: string,
    userId: string,
    parentId: string | null,
    ids: readonly string[],
  ): Promise<void>;
  /** Deletes a category; returns its cover picture's base key so its files can be removed. */
  deleteCategory(accessToken: string, userId: string, categoryId: string): Promise<string | null>;
  /**
   * Deletes a product that was never ordered (admin_delete_product). Answers the storage
   * keys of its images and videos, for removing the files after the delete committed.
   */
  deleteProduct(
    accessToken: string,
    userId: string,
    productId: string,
  ): Promise<{ imageKeys: string[]; videoKeys: string[] }>;
  /**
   * Points the category at a stored picture key. Returns the key it replaced, so the
   * caller can delete the old object only after this committed.
   */
  setCategoryImage(
    accessToken: string,
    userId: string,
    categoryId: string,
    imageKey: string | null,
  ): Promise<string | null>;
  /**
   * Points the category's page banner at a stored picture key (null clears it). Returns the
   * key it replaced so the caller can delete that object once this committed.
   */
  setCategoryBanner(
    accessToken: string,
    userId: string,
    categoryId: string,
    bannerKey: string | null,
  ): Promise<string | null>;
  /** A category's banner key, for deleting its object after the category is deleted. */
  categoryBannerKey(
    accessToken: string,
    userId: string,
    categoryId: string,
  ): Promise<string | null>;
  /** The stock ledger, newest first. */
  listMovements(
    accessToken: string,
    userId: string,
    filters: MovementFilters,
    page: Page,
  ): Promise<{ movements: InventoryMovement[]; total: number }>;
  /** Every attribute and its values, in display order. */
  listAttributes(accessToken: string, userId: string): Promise<AdminAttribute[]>;
  /** Creates (null id) or renames an attribute; answers with the full list. */
  saveAttribute(
    accessToken: string,
    userId: string,
    attributeId: string | null,
    input: AdminSaveAttributeRequest,
  ): Promise<AdminAttribute[]>;
  /** Creates (null id) or renames one value of an attribute. */
  saveAttributeValue(
    accessToken: string,
    userId: string,
    input: AdminSaveAttributeValueRequest,
  ): Promise<AdminAttribute[]>;
  /** A product's variants, inactive ones included, in display order. */
  listVariants(accessToken: string, userId: string, productId: string): Promise<AdminVariant[]>;
  /** Creates (null id) or replaces a variant's SKU, price, options and state. */
  saveVariant(
    accessToken: string,
    userId: string,
    productId: string,
    input: AdminSaveVariantRequest,
  ): Promise<AdminVariant[]>;
  setVariantActive(
    accessToken: string,
    userId: string,
    variantId: string,
    isActive: boolean,
  ): Promise<void>;
  /** Deletes a variant. Past orders keep their snapshot, so history is never rewritten. */
  deleteVariant(accessToken: string, userId: string, variantId: string): Promise<void>;
  adjustVariantStock(
    accessToken: string,
    userId: string,
    variantId: string,
    change: number,
    note: string,
  ): Promise<void>;
  /** Sets a variant's stock to an exact count, with a required reason. */
  setVariantStock(
    accessToken: string,
    userId: string,
    variantId: string,
    stock: number,
    note: string,
  ): Promise<void>;
}

const SUMMARY_COLUMNS = `id, slug, sku, name, summary, status, moderation_status, price_minor, compare_at_price_minor, stock_quantity, max_order_quantity, is_featured, published_at, updated_at, category:categories!inner(id, slug, name, is_active), product_images(${IMAGE_COLUMNS})`;
const DETAIL_COLUMNS = `${SUMMARY_COLUMNS}, description, created_at, size_chart, moderation_tasks(id, status, decision_note, submitted_at, decided_at, assigned_to)`;
// product_count is a computed column (a SQL function on the row): signed-in callers hold
// column-level SELECT on products only, which PostgREST's embedded count cannot use.
const CATEGORY_COLUMNS =
  'id, slug, name, description, sort_order, is_active, parent_id, is_featured, image_key, product_count';
const MOVEMENT_COLUMNS =
  'id, product_id, change, stock_after, reason, note, actor_id, created_at, product:products!inner(name, sku), order:orders(order_number)';

interface SummaryRow {
  id: string;
  slug: string;
  sku: string;
  name: string;
  summary: string | null;
  status: string;
  moderation_status: string;
  price_minor: number | string;
  compare_at_price_minor: number | string | null;
  stock_quantity: number;
  max_order_quantity: number;
  is_featured: boolean;
  published_at: string | Date | null;
  updated_at: string | Date;
  category: { id: string; slug: string; name: string; is_active: boolean };
  product_images: ImageRow[];
}

interface DetailRow extends SummaryRow {
  description: string | null;
  created_at: string | Date;
  /** jsonb; validated by the contract's size chart schema. */
  size_chart: unknown;
  /** From admin_product_tags(): null when the caller may not read them. */
  tags: string[] | null;
  moderation_tasks: {
    id: string;
    status: string;
    decision_note: string | null;
    submitted_at: string;
    decided_at: string | null;
    assigned_to: string | null;
  }[];
}

function toSummary(row: SummaryRow, mediaBaseUrl: string | undefined) {
  const images = toProductImages(row.product_images, mediaBaseUrl);
  return {
    id: row.id,
    slug: row.slug,
    sku: row.sku,
    name: row.name,
    summary: row.summary,
    status: row.status,
    moderationStatus: row.moderation_status,
    priceMinor: Number(row.price_minor),
    compareAtPriceMinor:
      row.compare_at_price_minor === null ? null : Number(row.compare_at_price_minor),
    stockQuantity: row.stock_quantity,
    maxOrderQuantity: row.max_order_quantity,
    isFeatured: row.is_featured,
    category: {
      id: row.category.id,
      slug: row.category.slug,
      name: row.category.name,
      isActive: row.category.is_active,
    },
    publishedAt: row.published_at === null ? null : isoTimestamp(row.published_at),
    updatedAt: isoTimestamp(row.updated_at),
    image: images[0] ?? null,
  };
}

function toDetail(row: DetailRow, mediaBaseUrl: string | undefined): AdminProductDetail {
  const review = row.moderation_tasks[0];
  return conform(
    adminProductDetailSchema,
    {
      ...toSummary(row, mediaBaseUrl),
      images: toProductImages(row.product_images, mediaBaseUrl),
      description: row.description,
      createdAt: isoTimestamp(row.created_at),
      tags: row.tags ?? [],
      sizeChart: row.size_chart ?? null,
      latestReview: review
        ? {
            taskId: review.id,
            status: review.status,
            note: review.decision_note,
            submittedAt: isoTimestamp(review.submitted_at),
            decidedAt: review.decided_at === null ? null : isoTimestamp(review.decided_at),
            assigned: review.assigned_to !== null,
          }
        : null,
    },
    'products',
  );
}

const summariesSchema = z.array(adminProductSummarySchema);
const movementsSchema = z.array(inventoryMovementSchema);

export interface AdminCatalogStoreOptions {
  /** Public base URL of the media bucket; without it products carry no images. */
  mediaBaseUrl?: string | undefined;
  /** Catalog cache to clear after a category change; a no-op cache when Redis is off. */
  cache?: CatalogCache | undefined;
}

export function createSupabaseAdminCatalogStore(
  clients: SupabaseClients,
  { mediaBaseUrl, cache = disabledCatalogCache() }: AdminCatalogStoreOptions = {},
): AdminCatalogStore {
  const summaryOf = (row: SummaryRow) => toSummary(row, mediaBaseUrl);

  async function getProduct(accessToken: string, _userId: string, productId: string) {
    const client = clients.asUser(accessToken);
    // Tags have no column privilege: staff read them through a permission-checking function.
    const [{ data, error }, tags] = await Promise.all([
      client
        .from('products')
        .select(DETAIL_COLUMNS)
        .eq('id', productId)
        .order('submitted_at', { referencedTable: 'moderation_tasks', ascending: false })
        .order('position', { referencedTable: 'product_images' })
        .limit(1, { referencedTable: 'moderation_tasks' })
        .maybeSingle(),
      client.rpc('admin_product_tags', { p_product_id: productId }),
    ]);
    if (error) throw toAdminStoreError(error, 'products');
    if (tags.error) throw toAdminStoreError(tags.error, 'admin_product_tags');
    return data ? toDetail({ ...data, tags: tags.data ?? null }, mediaBaseUrl) : null;
  }

  /** The product a database function just changed; the change is saved either way. */
  async function readBack(
    accessToken: string,
    userId: string,
    productId: string,
    operation: string,
  ) {
    const product = await getProduct(accessToken, userId, productId);
    if (!product)
      throw new StoreUnavailableError(
        `${operation} committed, but the product could not be read back`,
      );
    return product;
  }

  async function rpcFailure<T>(
    call: PromiseLike<{
      data: T | null;
      error: { code: string; message: string; details?: string | null } | null;
    }>,
    operation: string,
  ): Promise<T | null> {
    const { data, error } = await call;
    if (error) throw toAdminStoreError(error, operation);
    return data;
  }

  /** A category's id plus the ids of every category beneath it (at most three levels exist). */
  async function branchIds(client: NilzoraSupabaseClient, categoryId: string): Promise<string[]> {
    const { data, error } = await client.from('categories').select('id, parent_id');
    if (error) throw toAdminStoreError(error, 'categories');
    const ids = new Set<string>([categoryId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const row of data) {
        if (row.parent_id !== null && ids.has(row.parent_id) && !ids.has(row.id)) {
          ids.add(row.id);
          grew = true;
        }
      }
    }
    return [...ids];
  }

  async function getCategory(client: NilzoraSupabaseClient, categoryId: string) {
    const { data, error } = await client
      .from('categories')
      .select(CATEGORY_COLUMNS)
      .eq('id', categoryId)
      .maybeSingle();
    if (error) throw toAdminStoreError(error, 'categories');
    if (!data)
      throw new StoreUnavailableError(
        'admin_save_category committed, but the category could not be read back',
      );
    return toCategory(data, mediaBaseUrl);
  }

  return {
    async listProducts(accessToken, _userId, filters, sort, { limit, offset }) {
      const client = clients.asUser(accessToken);
      // A category filter means "this category and everything under it": a department lists the
      // products of its subcategories too, as the storefront does.
      const branch = filters.categoryId ? await branchIds(client, filters.categoryId) : null;
      const build = (columns: string, head: boolean) => {
        let query = client.from('products').select(columns, { count: 'exact', head });
        if (filters.status) query = query.eq('status', filters.status);
        if (filters.moderationStatus) {
          query = query.eq('moderation_status', filters.moderationStatus);
        }
        if (branch) query = query.in('category_id', branch);
        if (filters.stock === 'out') query = query.eq('stock_quantity', 0);
        if (filters.stock === 'low') query = query.lte('stock_quantity', LOW_STOCK_THRESHOLD);
        if (filters.search) {
          const pattern = `*${filters.search}*`;
          query = query.or(`name.ilike.${pattern},sku.ilike.${pattern},slug.ilike.${pattern}`);
        }
        return query;
      };

      const [column, ascending] = PRODUCT_ORDER[sort];
      const { data, error, count } = await build(SUMMARY_COLUMNS, false)
        .order(column, { ascending })
        .order('id')
        .order('position', { referencedTable: 'product_images' })
        .range(offset, offset + limit - 1)
        .overrideTypes<SummaryRow[], { merge: false }>();
      if (error?.code === RANGE_NOT_SATISFIABLE) {
        const counted = await build('id', true);
        if (counted.error) throw toAdminStoreError(counted.error, 'products');
        return { products: [], total: counted.count ?? 0 };
      }
      if (error) throw toAdminStoreError(error, 'products');
      return {
        products: conform(summariesSchema, data.map(summaryOf), 'products'),
        total: count ?? data.length,
      };
    },

    getProduct: (accessToken, userId, productId) => getProduct(accessToken, userId, productId),

    async createProduct(accessToken, userId, input) {
      const productId = await rpcFailure(
        clients.asUser(accessToken).rpc('admin_create_product', {
          p_category_id: input.categoryId,
          p_slug: input.slug,
          p_sku: input.sku,
          p_name: input.name,
          p_summary: sqlNull(input.summary),
          p_description: sqlNull(input.description),
          p_price_minor: input.priceMinor,
          p_compare_at_price_minor: sqlNull(input.compareAtPriceMinor),
          p_max_order_quantity: input.maxOrderQuantity,
          p_is_featured: input.isFeatured,
          p_initial_stock: input.initialStock,
          p_tags: input.tags ?? [],
          p_size_chart: input.sizeChart ?? null,
        }),
        'admin_create_product',
      );
      const id = conform(z.uuid(), productId, 'admin_create_product');
      return readBack(accessToken, userId, id, 'admin_create_product');
    },

    async updateProduct(accessToken, userId, productId, input) {
      await rpcFailure(
        clients.asUser(accessToken).rpc('admin_update_product', {
          p_product_id: productId,
          p_category_id: input.categoryId,
          p_slug: input.slug,
          p_name: input.name,
          p_summary: sqlNull(input.summary),
          p_description: sqlNull(input.description),
          p_price_minor: input.priceMinor,
          p_compare_at_price_minor: sqlNull(input.compareAtPriceMinor),
          p_max_order_quantity: input.maxOrderQuantity,
          p_is_featured: input.isFeatured,
          // Left out (older clients), the tags and the size chart are kept as they are.
          p_tags: sqlNull(input.tags),
          p_size_chart: input.sizeChart ?? null,
          p_replace_size_chart: input.sizeChart !== undefined,
        }),
        'admin_update_product',
      );
      return readBack(accessToken, userId, productId, 'admin_update_product');
    },

    async setProductStatus(accessToken, userId, productId, status) {
      await rpcFailure(
        clients
          .asUser(accessToken)
          .rpc('admin_set_product_status', { p_product_id: productId, p_status: status }),
        'admin_set_product_status',
      );
      return readBack(accessToken, userId, productId, 'admin_set_product_status');
    },

    async adjustStock(accessToken, userId, productId, change, note) {
      await rpcFailure(
        clients
          .asUser(accessToken)
          .rpc('admin_adjust_stock', { p_product_id: productId, p_change: change, p_note: note }),
        'admin_adjust_stock',
      );
      return readBack(accessToken, userId, productId, 'admin_adjust_stock');
    },

    async submitForReview(accessToken, userId, productId) {
      await rpcFailure(
        clients.asUser(accessToken).rpc('submit_product_for_review', { p_product_id: productId }),
        'submit_product_for_review',
      );
      return readBack(accessToken, userId, productId, 'submit_product_for_review');
    },

    async slugAvailability(accessToken, _userId, query) {
      const { data, error } = await clients.asUser(accessToken).rpc('admin_slug_availability', {
        p_kind: query.kind,
        p_slug: query.slug,
        p_exclude_id: sqlNull(query.excludeId),
      });
      if (error) throw toAdminStoreError(error, 'admin_slug_availability');
      return conform(slugAvailabilityResponseSchema, data, 'admin_slug_availability');
    },

    async listCategories(accessToken, _userId) {
      const { data, error } = await clients
        .asUser(accessToken)
        .from('categories')
        .select(CATEGORY_COLUMNS)
        .order('sort_order')
        .order('name');
      if (error) throw toAdminStoreError(error, 'categories');
      // Banners come from a separate, tolerant read: a database that has not run the banner
      // migration has no column, and that must not take the category list down.
      const banners = new Map<string, string>();
      const bannerRows = await clients
        .asUser(accessToken)
        .from('categories')
        .select('id, banner_key')
        .not('banner_key', 'is', null);
      for (const row of (bannerRows.data ?? []) as unknown as {
        id: string;
        banner_key: string | null;
      }[]) {
        if (row.banner_key !== null) banners.set(row.id, row.banner_key);
      }
      return data.map((row) => toCategory(row, mediaBaseUrl, banners.get(row.id) ?? null));
    },

    async saveCategory(accessToken, _userId, categoryId, input) {
      const client = clients.asUser(accessToken);
      const savedId = await rpcFailure(
        client.rpc('admin_save_category', {
          p_category_id: sqlNull(categoryId),
          p_slug: input.slug,
          p_name: input.name,
          p_description: sqlNull(input.description),
          p_sort_order: input.sortOrder,
          p_is_active: input.isActive,
        }),
        'admin_save_category',
      );
      const id = conform(z.uuid(), savedId, 'admin_save_category');
      await rpcFailure(
        client.rpc('admin_save_category_placement', {
          p_category_id: id,
          p_parent_id: sqlNull(input.parentId ?? null),
          p_is_featured: input.isFeatured,
        }),
        'admin_save_category_placement',
      );
      // Both writes are committed: the public tree must not be served from an older copy.
      await cache.invalidate();
      return getCategory(client, id);
    },

    async deleteProduct(accessToken, _userId, productId) {
      const data = await rpcFailure(
        clients.asUser(accessToken).rpc('admin_delete_product', { p_product_id: productId }),
        'admin_delete_product',
      );
      await cache.invalidate();
      return conform(deletedFilesSchema, data, 'admin_delete_product');
    },

    async reorderCategories(accessToken, _userId, parentId, ids) {
      await rpcFailure(
        clients.asUser(accessToken).rpc('admin_reorder_categories', {
          p_parent_id: sqlNull(parentId),
          p_ids: [...ids],
        }),
        'admin_reorder_categories',
      );
      await cache.invalidate();
    },

    async deleteCategory(accessToken, _userId, categoryId) {
      const client = clients.asUser(accessToken);
      // The row carries the picture's key; read it before the row goes.
      const { data: current } = await client
        .from('categories')
        .select('image_key')
        .eq('id', categoryId)
        .maybeSingle();
      await rpcFailure(
        client.rpc('admin_delete_category', { p_category_id: categoryId }),
        'admin_delete_category',
      );
      await cache.invalidate();
      return conform(z.string().nullable(), current?.image_key ?? null, 'admin_delete_category');
    },

    async setCategoryImage(accessToken, _userId, categoryId, imageKey) {
      const client = clients.asUser(accessToken);
      if (imageKey === null) {
        const cleared = await rpcFailure(
          client.rpc('admin_clear_category_image', { p_category_id: categoryId }),
          'admin_clear_category_image',
        );
        await cache.invalidate();
        return conform(z.string().nullable(), cleared, 'admin_clear_category_image');
      }
      const { data, error } = await client
        .from('categories')
        .select('image_key')
        .eq('id', categoryId)
        .maybeSingle();
      if (error) throw toAdminStoreError(error, 'categories');
      await rpcFailure(
        client.rpc('admin_set_category_image', {
          p_category_id: categoryId,
          p_image_key: imageKey,
        }),
        'admin_set_category_image',
      );
      await cache.invalidate();
      return data?.image_key ?? null;
    },

    async setCategoryBanner(accessToken, _userId, categoryId, bannerKey) {
      const client = clients.asUser(accessToken);
      const previous = await rpcFailure(
        client.rpc('admin_set_category_banner', {
          p_category_id: categoryId,
          p_banner_key: sqlNull(bannerKey),
        }),
        'admin_set_category_banner',
      );
      await cache.invalidate();
      return conform(z.string().nullable(), previous ?? null, 'admin_set_category_banner');
    },

    async categoryBannerKey(accessToken, _userId, categoryId) {
      const { data } = await clients
        .asUser(accessToken)
        .from('categories')
        .select('banner_key')
        .eq('id', categoryId)
        .maybeSingle();
      return data?.banner_key ?? null;
    },

    async listMovements(accessToken, _userId, filters, { limit, offset }) {
      const client = clients.asUser(accessToken);
      const build = (columns: string, head: boolean) => {
        let query = client.from('inventory_movements').select(columns, { count: 'exact', head });
        if (filters.productId) query = query.eq('product_id', filters.productId);
        if (filters.reason) query = query.eq('reason', filters.reason);
        return query;
      };

      const { data, error, count } = await build(MOVEMENT_COLUMNS, false)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(offset, offset + limit - 1)
        .overrideTypes<MovementRow[], { merge: false }>();
      if (error?.code === RANGE_NOT_SATISFIABLE) {
        const counted = await build('id', true);
        if (counted.error) throw toAdminStoreError(counted.error, 'inventory_movements');
        return { movements: [], total: counted.count ?? 0 };
      }
      if (error) throw toAdminStoreError(error, 'inventory_movements');

      const names = await staffNames(
        client,
        data.map((row) => row.actor_id),
      );
      const movements = data.map((row) => ({
        id: Number(row.id),
        product: { id: row.product_id, name: row.product.name, sku: row.product.sku },
        change: row.change,
        stockAfter: row.stock_after,
        reason: row.reason,
        note: row.note,
        orderNumber: row.order?.order_number ?? null,
        actor: accountRef(row.actor_id, names),
        createdAt: isoTimestamp(row.created_at),
      }));
      return {
        movements: conform(movementsSchema, movements, 'inventory_movements'),
        total: count ?? data.length,
      };
    },

    async listAttributes(accessToken, _userId) {
      const client = clients.asUser(accessToken);
      return readAttributes(client);
    },

    async saveAttribute(accessToken, _userId, attributeId, input) {
      const client = clients.asUser(accessToken);
      await rpcFailure(
        client.rpc('admin_save_attribute', {
          p_attribute_id: sqlNull(attributeId),
          p_slug: input.slug,
          p_name: input.name,
          p_position: input.position,
          p_is_active: input.isActive,
          p_kind: input.kind ?? 'other',
        }),
        'admin_save_attribute',
      );
      return readAttributes(client);
    },

    async saveAttributeValue(accessToken, _userId, input) {
      const client = clients.asUser(accessToken);
      await rpcFailure(
        client.rpc('admin_save_attribute_value', {
          p_value_id: sqlNull(input.valueId ?? null),
          p_attribute_id: input.attributeId,
          p_slug: input.slug,
          p_value: input.value,
          p_position: input.position,
          p_swatch_hex: sqlNull(input.swatchHex ?? null),
        }),
        'admin_save_attribute_value',
      );
      return readAttributes(client);
    },

    async listVariants(accessToken, _userId, productId) {
      return readVariants(clients.asUser(accessToken), productId);
    },

    async saveVariant(accessToken, _userId, productId, input) {
      const client = clients.asUser(accessToken);
      await rpcFailure(
        client.rpc('admin_save_variant', {
          p_variant_id: sqlNull(input.variantId ?? null),
          p_product_id: productId,
          p_sku: input.sku,
          p_price_minor: sqlNull(input.priceMinor ?? null),
          p_compare_at_price_minor: sqlNull(input.compareAtPriceMinor ?? null),
          p_image_url: sqlNull(input.imageUrl ?? null),
          p_position: input.position ?? 0,
          p_is_active: input.isActive ?? true,
          p_attribute_value_ids: input.attributeValueIds,
        }),
        'admin_save_variant',
      );
      return readVariants(client, productId);
    },

    async setVariantActive(accessToken, _userId, variantId, isActive) {
      await rpcFailure(
        clients.asUser(accessToken).rpc('admin_set_variant_active', {
          p_variant_id: variantId,
          p_is_active: isActive,
        }),
        'admin_set_variant_active',
      );
    },

    async deleteVariant(accessToken, _userId, variantId) {
      await rpcFailure(
        clients.asUser(accessToken).rpc('admin_delete_variant', { p_variant_id: variantId }),
        'admin_delete_variant',
      );
    },

    async adjustVariantStock(accessToken, _userId, variantId, change, note) {
      await rpcFailure(
        clients.asUser(accessToken).rpc('admin_adjust_variant_stock', {
          p_variant_id: variantId,
          p_change: change,
          p_note: note,
        }),
        'admin_adjust_variant_stock',
      );
    },

    async setVariantStock(accessToken, _userId, variantId, stock, note) {
      await rpcFailure(
        clients.asUser(accessToken).rpc('admin_set_variant_stock', {
          p_variant_id: variantId,
          p_stock: stock,
          p_note: note,
        }),
        'admin_set_variant_stock',
      );
    },
  };
}

const attributeValuesSchema = z.array(
  z.object({
    id: z.uuid(),
    slug: z.string(),
    value: z.string(),
    position: z.number(),
    swatchHex: z.string().nullable().optional(),
  }),
);

const attributeRowsSchema = z.array(
  z.object({
    id: z.uuid(),
    slug: z.string(),
    name: z.string(),
    position: z.number(),
    is_active: z.boolean(),
    kind: z.enum(['color', 'size', 'other']).optional(),
    values: z.unknown(),
  }),
);

const variantRowsSchema = z.array(
  z.object({
    id: z.uuid(),
    sku: z.string(),
    price_minor: z.union([z.number(), z.string()]).nullable(),
    compare_at_price_minor: z.union([z.number(), z.string()]).nullable(),
    stock_quantity: z.union([z.number(), z.string()]),
    image_url: z.string().nullable(),
    position: z.union([z.number(), z.string()]),
    is_active: z.boolean(),
    label: z.string().nullable(),
    attribute_value_ids: z.array(z.uuid()),
  }),
);

/** admin_list_attributes, mapped to the contract. */
async function readAttributes(client: NilzoraSupabaseClient): Promise<AdminAttribute[]> {
  const { data, error } = await client.rpc('admin_list_attributes');
  if (error) throw toAdminStoreError(error, 'admin_list_attributes');
  const rows = attributeRowsSchema.parse(data ?? []);
  return rows.map((row) =>
    conform(
      adminAttributeSchema,
      {
        id: row.id,
        slug: row.slug,
        name: row.name,
        position: Number(row.position),
        isActive: row.is_active,
        kind: row.kind ?? 'other',
        values: attributeValuesSchema.parse(row.values ?? []),
      },
      'admin_list_attributes',
    ),
  );
}

/** admin_product_variants, mapped to the contract. */
async function readVariants(
  client: NilzoraSupabaseClient,
  productId: string,
): Promise<AdminVariant[]> {
  const { data, error } = await client.rpc('admin_product_variants', {
    p_product_id: productId,
  });
  if (error) throw toAdminStoreError(error, 'admin_product_variants');
  const rows = variantRowsSchema.parse(data ?? []);
  return rows.map((row) =>
    conform(
      adminVariantSchema,
      {
        id: row.id,
        sku: row.sku,
        priceMinor: row.price_minor === null ? null : Number(row.price_minor),
        compareAtPriceMinor:
          row.compare_at_price_minor === null ? null : Number(row.compare_at_price_minor),
        stockQuantity: Number(row.stock_quantity),
        imageUrl: row.image_url,
        position: Number(row.position),
        isActive: row.is_active,
        label: row.label,
        attributeValueIds: row.attribute_value_ids,
      },
      'admin_product_variants',
    ),
  );
}

interface MovementRow {
  id: number | string;
  product_id: string;
  change: number;
  stock_after: number;
  reason: string;
  note: string | null;
  actor_id: string | null;
  created_at: string | Date;
  product: { name: string; sku: string };
  order: { order_number: string } | null;
}

interface CategoryRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  parent_id: string | null;
  is_featured: boolean;
  image_key: string | null;
  product_count: number | string | null;
}

/**
 * Banner keys by category id, or none when the banner column does not exist yet (a database
 * that has not run the banner migration) or the read fails. Run on its own connection so a
 * failed statement cannot abort another transaction.
 */
async function readBannerKeys(pool: Pool, userId: string): Promise<Map<string, string>> {
  const keys = new Map<string, string>();
  try {
    await withUser(pool, userId, async (client) => {
      const result = await client.query<{ id: string; banner_key: string }>(
        'select id, banner_key from public.categories where banner_key is not null',
      );
      for (const row of result.rows) keys.set(row.id, row.banner_key);
    });
  } catch {
    // No banner column yet: no banners.
  }
  return keys;
}

/** Public URL of a category cover image, built from the stored key. */
function categoryImageUrl(
  imageKey: string | null,
  mediaBaseUrl: string | undefined,
): string | null {
  if (!imageKey || !mediaBaseUrl) return null;
  return `${mediaBaseUrl}/${imageKey}/${FULL_FILE}`;
}

function toCategory(
  row: CategoryRow,
  mediaBaseUrl: string | undefined,
  bannerKey: string | null = null,
): AdminCategory {
  return conform(
    adminCategorySchema,
    {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      sortOrder: row.sort_order,
      isActive: row.is_active,
      parentId: row.parent_id,
      isFeatured: row.is_featured,
      imageUrl: categoryImageUrl(row.image_key, mediaBaseUrl),
      bannerUrl: categoryImageUrl(bannerKey, mediaBaseUrl),
      productCount: Number(row.product_count ?? 0),
    },
    'categories',
  );
}

/** PostgreSQL exposes custom SQLSTATEs (`NZ4xx`, `23505`, `23514`) as a string `code`. */
function pgFailure(error: unknown): { code: string; message: string; details: string | null } {
  const fields = error as { code?: unknown; message?: unknown; detail?: unknown } | null;
  return {
    code: typeof fields?.code === 'string' ? fields.code : '',
    message: typeof fields?.message === 'string' ? fields.message : 'database request failed',
    details: typeof fields?.detail === 'string' ? fields.detail : null,
  };
}

/** The product row, its category and its images in one statement (images as JSON). */
const SQL_PRODUCT_COLUMNS = `p.id, p.slug, p.sku, p.name, p.summary, p.status::text as status,
    p.moderation_status::text as moderation_status, p.price_minor, p.compare_at_price_minor,
    p.stock_quantity, p.max_order_quantity, p.is_featured, p.published_at, p.updated_at,
    p.description, p.created_at,
    c.id as category_id, c.slug as category_slug, c.name as category_name,
    c.is_active as category_active,
    coalesce(img.images, '[]'::jsonb) as product_images,
    latest.review as latest_review`;

const SQL_PRODUCT_FROM = `from public.products p
  join public.categories c on c.id = p.category_id
  left join lateral (
    select jsonb_agg(
      jsonb_build_object('id', i.id, 'storage_key', i.storage_key, 'width', i.width,
        'height', i.height, 'alt_text', i.alt_text, 'position', i.position)
      order by i.position) as images
    from public.product_images i where i.product_id = p.id
  ) img on true
  left join lateral (
    select jsonb_build_object('id', t.id, 'status', t.status::text, 'decision_note', t.decision_note,
        'submitted_at', t.submitted_at, 'decided_at', t.decided_at, 'assigned_to', t.assigned_to) as review
    from public.moderation_tasks t
    where t.product_id = p.id
    order by t.submitted_at desc
    limit 1
  ) latest on true`;

/** One product's detail: the list columns plus the size chart and (permission-checked) tags. */
const SQL_PRODUCT = `select ${SQL_PRODUCT_COLUMNS}, p.size_chart,
    public.admin_product_tags(p.id) as tags ${SQL_PRODUCT_FROM}`;

interface PgProductRow {
  id: string;
  slug: string;
  sku: string;
  name: string;
  summary: string | null;
  status: string;
  moderation_status: string;
  price_minor: number | string;
  compare_at_price_minor: number | string | null;
  stock_quantity: number;
  max_order_quantity: number;
  is_featured: boolean;
  published_at: string | Date | null;
  updated_at: string | Date;
  description: string | null;
  created_at: string | Date;
  category_id: string;
  category_slug: string;
  category_name: string;
  category_active: boolean;
  product_images: ImageRow[];
  /** Present on detail reads only. */
  size_chart?: unknown;
  tags?: string[] | null;
  latest_review: {
    id: string;
    status: string;
    decision_note: string | null;
    submitted_at: string;
    decided_at: string | null;
    assigned_to: string | null;
  } | null;
}

function toSummaryRow(row: PgProductRow): SummaryRow {
  return {
    id: row.id,
    slug: row.slug,
    sku: row.sku,
    name: row.name,
    summary: row.summary,
    status: row.status,
    moderation_status: row.moderation_status,
    price_minor: row.price_minor,
    compare_at_price_minor: row.compare_at_price_minor,
    stock_quantity: row.stock_quantity,
    max_order_quantity: row.max_order_quantity,
    is_featured: row.is_featured,
    published_at: row.published_at,
    updated_at: row.updated_at,
    category: {
      id: row.category_id,
      slug: row.category_slug,
      name: row.category_name,
      is_active: row.category_active,
    },
    product_images: row.product_images,
  };
}

function toDetailRow(row: PgProductRow): DetailRow {
  return {
    ...toSummaryRow(row),
    description: row.description,
    created_at: row.created_at,
    size_chart: row.size_chart ?? null,
    tags: row.tags ?? null,
    moderation_tasks: row.latest_review === null ? [] : [row.latest_review],
  };
}

/**
 * The admin catalog over a direct PostgreSQL connection, always as the signed-in
 * caller: `products.read` still decides what a caller may see, and every change still
 * goes through the permission-checking database functions.
 */
export function createPostgresAdminCatalogStore(
  pool: Pool,
  { mediaBaseUrl, cache = disabledCatalogCache() }: AdminCatalogStoreOptions = {},
): AdminCatalogStore {
  function failure(error: unknown, operation: string): Error {
    if (error instanceof StoreUnavailableError) return error;
    return toAdminStoreError(pgFailure(error), operation);
  }

  async function getProduct(userId: string, productId: string) {
    return withUser(pool, userId, async (client) => {
      const result = await client.query<PgProductRow>(`${SQL_PRODUCT} where p.id = $1::uuid`, [
        productId,
      ]);
      const row = result.rows[0];
      return row ? toDetail(toDetailRow(row), mediaBaseUrl) : null;
    });
  }

  /** The product a database function just changed; the change is saved either way. */
  async function readBack(userId: string, productId: string, operation: string) {
    const product = await getProduct(userId, productId);
    if (!product) {
      throw new StoreUnavailableError(
        `${operation} committed, but the product could not be read back`,
      );
    }
    return product;
  }

  async function getCategory(userId: string, categoryId: string) {
    return withUser(pool, userId, async (client) => {
      const result = await client.query<CategoryRow>(
        `select c.id, c.slug, c.name, c.description, c.sort_order, c.is_active,
                c.parent_id, c.is_featured, c.image_key,
                public.product_count(c) as product_count
           from public.categories c
          where c.id = $1::uuid`,
        [categoryId],
      );
      const row = result.rows[0];
      if (!row) {
        throw new StoreUnavailableError(
          'admin_save_category committed, but the category could not be read back',
        );
      }
      return toCategory(row, mediaBaseUrl);
    });
  }

  return {
    async listProducts(_accessToken, userId, filters, sort, { limit, offset }) {
      const where = ['true'];
      const parameters: unknown[] = [];
      const add = (clause: (index: number) => string, value: unknown) => {
        parameters.push(value);
        where.push(clause(parameters.length));
      };

      if (filters.status) add((i) => `p.status = $${i}::public.product_status`, filters.status);
      if (filters.moderationStatus) {
        add(
          (i) => `p.moderation_status = $${i}::public.moderation_status`,
          filters.moderationStatus,
        );
      }
      // This category and everything under it (a department lists its subcategories' products).
      if (filters.categoryId) {
        add(
          (i) =>
            `p.category_id in (with recursive branch(id) as (select $${i}::uuid union all select c.id from public.categories c join branch b on c.parent_id = b.id) select id from branch)`,
          filters.categoryId,
        );
      }
      if (filters.stock === 'out') where.push('p.stock_quantity = 0');
      if (filters.stock === 'low') {
        parameters.push(LOW_STOCK_THRESHOLD);
        where.push(`p.stock_quantity <= $${parameters.length}`);
      }
      if (filters.search) {
        parameters.push(`%${filters.search}%`);
        const index = parameters.length;
        where.push(`(p.name ilike $${index} or p.sku ilike $${index} or p.slug ilike $${index})`);
      }

      const [column, ascending] = PRODUCT_ORDER[sort];
      const direction = ascending ? 'asc' : 'desc';
      parameters.push(limit, offset);
      const limitIndex = parameters.length - 1;
      const offsetIndex = parameters.length;
      const condition = where.join(' and ');

      try {
        return await withUser(pool, userId, async (client) => {
          const page = await client.query<PgProductRow & { total: string }>(
            `select ${SQL_PRODUCT_COLUMNS}, count(*) over () as total
               ${SQL_PRODUCT_FROM}
              where ${condition}
              order by p.${column} ${direction}, p.id
              limit $${limitIndex} offset $${offsetIndex}`,
            parameters,
          );
          const first = page.rows[0];
          if (!first) {
            const counted = await client.query<{ total: string }>(
              `select count(*) as total from public.products p where ${condition}`,
              parameters.slice(0, limitIndex - 1),
            );
            return { products: [], total: Number(counted.rows[0]?.total ?? 0) };
          }
          return {
            products: conform(
              summariesSchema,
              page.rows.map((row) => toSummary(toSummaryRow(row), mediaBaseUrl)),
              'products',
            ),
            total: Number(first.total),
          };
        });
      } catch (error) {
        throw failure(error, 'products');
      }
    },

    async getProduct(_accessToken, userId, productId) {
      try {
        return await getProduct(userId, productId);
      } catch (error) {
        throw failure(error, 'products');
      }
    },

    async createProduct(_accessToken, userId, input) {
      try {
        const id = await withUser(pool, userId, async (client) => {
          const result = await client.query<{ id: string }>(
            `select public.admin_create_product($1::uuid, $2, $3, $4, $5, $6, $7::bigint,
               $8::bigint, $9, $10, $11, $12::text[], $13::jsonb) as id`,
            [
              input.categoryId,
              input.slug,
              input.sku,
              input.name,
              input.summary ?? null,
              input.description ?? null,
              input.priceMinor,
              input.compareAtPriceMinor ?? null,
              input.maxOrderQuantity,
              input.isFeatured,
              input.initialStock,
              input.tags ?? [],
              input.sizeChart === undefined || input.sizeChart === null
                ? null
                : JSON.stringify(input.sizeChart),
            ],
          );
          return conform(z.uuid(), result.rows[0]?.id, 'admin_create_product');
        });
        return await readBack(userId, id, 'admin_create_product');
      } catch (error) {
        throw failure(error, 'admin_create_product');
      }
    },

    async updateProduct(_accessToken, userId, productId, input) {
      try {
        await withUser(pool, userId, async (client) => {
          await client.query(
            `select public.admin_update_product($1::uuid, $2::uuid, $3, $4, $5, $6, $7::bigint,
               $8::bigint, $9, $10, $11::text[], $12::jsonb, $13::boolean)`,
            [
              productId,
              input.categoryId,
              input.slug,
              input.name,
              input.summary ?? null,
              input.description ?? null,
              input.priceMinor,
              input.compareAtPriceMinor ?? null,
              input.maxOrderQuantity,
              input.isFeatured,
              // Left out (older clients), the tags and the size chart are kept as they are.
              input.tags ?? null,
              input.sizeChart === undefined || input.sizeChart === null
                ? null
                : JSON.stringify(input.sizeChart),
              input.sizeChart !== undefined,
            ],
          );
        });
        return await readBack(userId, productId, 'admin_update_product');
      } catch (error) {
        throw failure(error, 'admin_update_product');
      }
    },

    async setProductStatus(_accessToken, userId, productId, status) {
      try {
        await withUser(pool, userId, async (client) => {
          await client.query(
            'select public.admin_set_product_status($1::uuid, $2::public.product_status)',
            [productId, status],
          );
        });
        return await readBack(userId, productId, 'admin_set_product_status');
      } catch (error) {
        throw failure(error, 'admin_set_product_status');
      }
    },

    async adjustStock(_accessToken, userId, productId, change, note) {
      try {
        await withUser(pool, userId, async (client) => {
          await client.query('select public.admin_adjust_stock($1::uuid, $2, $3)', [
            productId,
            change,
            note,
          ]);
        });
        return await readBack(userId, productId, 'admin_adjust_stock');
      } catch (error) {
        throw failure(error, 'admin_adjust_stock');
      }
    },

    async submitForReview(_accessToken, userId, productId) {
      try {
        await withUser(pool, userId, async (client) => {
          await client.query('select public.submit_product_for_review($1::uuid)', [productId]);
        });
        return await readBack(userId, productId, 'submit_product_for_review');
      } catch (error) {
        throw failure(error, 'submit_product_for_review');
      }
    },

    async slugAvailability(_accessToken, userId, query) {
      try {
        return await withUser(pool, userId, async (client) => {
          const result = await client.query<{ answer: unknown }>(
            'select public.admin_slug_availability($1, $2, $3::uuid) as answer',
            [query.kind, query.slug, query.excludeId ?? null],
          );
          return conform(
            slugAvailabilityResponseSchema,
            result.rows[0]?.answer,
            'admin_slug_availability',
          );
        });
      } catch (error) {
        throw failure(error, 'admin_slug_availability');
      }
    },

    async listCategories(_accessToken, userId) {
      try {
        return await withUser(pool, userId, async (client) => {
          const result = await client.query<CategoryRow>(
            `select c.id, c.slug, c.name, c.description, c.sort_order, c.is_active,
                    c.parent_id, c.is_featured, c.image_key,
                    public.product_count(c) as product_count
               from public.categories c
              order by c.sort_order, c.name`,
          );
          return result.rows.map((row) => toCategory(row, mediaBaseUrl));
        }).then(async (categories) => {
          // Banners: a separate, tolerant read (see the Supabase store).
          const banners = await readBannerKeys(pool, userId);
          return categories.map((category) => {
            const key = banners.get(category.id);
            return key === undefined
              ? category
              : { ...category, bannerUrl: categoryImageUrl(key, mediaBaseUrl) };
          });
        });
      } catch (error) {
        throw failure(error, 'categories');
      }
    },

    async saveCategory(_accessToken, userId, categoryId, input) {
      try {
        const savedId = await withUser(pool, userId, async (client) => {
          const result = await client.query<{ id: string }>(
            'select public.admin_save_category($1::uuid, $2, $3, $4, $5, $6) as id',
            [
              categoryId,
              input.slug,
              input.name,
              input.description ?? null,
              input.sortOrder,
              input.isActive,
            ],
          );
          const id = conform(z.uuid(), result.rows[0]?.id, 'admin_save_category');
          await client.query(
            'select public.admin_save_category_placement($1::uuid, $2::uuid, $3)',
            [id, input.parentId ?? null, input.isFeatured],
          );
          return id;
        });
        await cache.invalidate();
        return await getCategory(userId, savedId);
      } catch (error) {
        throw failure(error, 'admin_save_category');
      }
    },

    async deleteProduct(_accessToken, userId, productId) {
      try {
        const files = await withUser(pool, userId, async (client) => {
          const result = await client.query<{ value: unknown }>(
            'select public.admin_delete_product($1::uuid) as value',
            [productId],
          );
          return conform(deletedFilesSchema, result.rows[0]?.value, 'admin_delete_product');
        });
        await cache.invalidate();
        return files;
      } catch (error) {
        throw failure(error, 'admin_delete_product');
      }
    },

    async reorderCategories(_accessToken, userId, parentId, ids) {
      try {
        await withUser(pool, userId, async (client) => {
          await client.query('select public.admin_reorder_categories($1::uuid, $2::uuid[])', [
            parentId,
            [...ids],
          ]);
        });
        await cache.invalidate();
      } catch (error) {
        throw failure(error, 'admin_reorder_categories');
      }
    },

    async deleteCategory(_accessToken, userId, categoryId) {
      try {
        const imageKey = await withUser(pool, userId, async (client) => {
          const current = await client.query<{ image_key: string | null }>(
            'select image_key from public.categories where id = $1::uuid',
            [categoryId],
          );
          await client.query('select public.admin_delete_category($1::uuid)', [categoryId]);
          return current.rows[0]?.image_key ?? null;
        });
        await cache.invalidate();
        return imageKey;
      } catch (error) {
        throw failure(error, 'admin_delete_category');
      }
    },

    async setCategoryImage(_accessToken, userId, categoryId, imageKey) {
      try {
        return await withUser(pool, userId, async (client) => {
          // Read-only on purpose: the caller can select a category but not lock or update it,
          // and the ordering of concurrent changes is the database function's job, not ours.
          const previous = await client.query<{ image_key: string | null }>(
            'select image_key from public.categories where id = $1::uuid',
            [categoryId],
          );
          const row = previous.rows[0];
          if (!row) throw new StoreUnavailableError('category not found');
          if (imageKey === null) {
            await client.query('select public.admin_clear_category_image($1::uuid)', [categoryId]);
          } else {
            await client.query('select public.admin_set_category_image($1::uuid, $2)', [
              categoryId,
              imageKey,
            ]);
          }
          return row.image_key;
        });
        await cache.invalidate();
      } catch (error) {
        throw failure(error, 'admin_set_category_image');
      }
    },

    async setCategoryBanner(_accessToken, userId, categoryId, bannerKey) {
      try {
        const previous = await withUser(pool, userId, async (client) => {
          const result = await client.query<{ previous: string | null }>(
            'select public.admin_set_category_banner($1::uuid, $2) as previous',
            [categoryId, bannerKey],
          );
          return result.rows[0]?.previous ?? null;
        });
        await cache.invalidate();
        return previous;
      } catch (error) {
        throw failure(error, 'admin_set_category_banner');
      }
    },

    async categoryBannerKey(_accessToken, userId, categoryId) {
      return (await readBannerKeys(pool, userId)).get(categoryId) ?? null;
    },

    async listMovements(_accessToken, userId, filters, { limit, offset }) {
      const where = ['true'];
      const parameters: unknown[] = [];
      if (filters.productId) {
        parameters.push(filters.productId);
        where.push(`m.product_id = $${parameters.length}::uuid`);
      }
      if (filters.reason) {
        parameters.push(filters.reason);
        where.push(`m.reason = $${parameters.length}::public.inventory_reason`);
      }
      const condition = where.join(' and ');
      parameters.push(limit, offset);
      const limitIndex = parameters.length - 1;
      const offsetIndex = parameters.length;

      try {
        return await withUser(pool, userId, async (client) => {
          const page = await client.query<{
            id: number | string;
            product_id: string;
            change: number;
            stock_after: number;
            reason: string;
            note: string | null;
            actor_id: string | null;
            created_at: string | Date;
            product_name: string;
            product_sku: string;
            order_number: string | null;
            total: string;
          }>(
            `select m.id, m.product_id, m.change, m.stock_after, m.reason::text as reason, m.note,
                    m.actor_id, m.created_at, p.name as product_name, p.sku as product_sku,
                    o.order_number, count(*) over () as total
               from public.inventory_movements m
               join public.products p on p.id = m.product_id
               left join public.orders o on o.id = m.order_id
              where ${condition}
              order by m.created_at desc, m.id desc
              limit $${limitIndex} offset $${offsetIndex}`,
            parameters,
          );
          const first = page.rows[0];
          if (!first) {
            const counted = await client.query<{ total: string }>(
              `select count(*) as total from public.inventory_movements m where ${condition}`,
              parameters.slice(0, limitIndex - 1),
            );
            return { movements: [], total: Number(counted.rows[0]?.total ?? 0) };
          }
          const names = await staffNamesForUser(
            pool,
            userId,
            page.rows.map((row) => row.actor_id),
          );
          const movements = page.rows.map((row) => ({
            id: Number(row.id),
            product: { id: row.product_id, name: row.product_name, sku: row.product_sku },
            change: row.change,
            stockAfter: row.stock_after,
            reason: row.reason,
            note: row.note,
            orderNumber: row.order_number,
            actor: accountRef(row.actor_id, names),
            createdAt: isoTimestamp(row.created_at),
          }));
          return {
            movements: conform(movementsSchema, movements, 'inventory_movements'),
            total: Number(first.total),
          };
        });
      } catch (error) {
        throw failure(error, 'inventory_movements');
      }
    },

    async listAttributes(_accessToken, userId) {
      return pgAttributes(userId);
    },

    async saveAttribute(_accessToken, userId, attributeId, input) {
      await pgCall(userId, 'admin_save_attribute', [
        attributeId,
        input.slug,
        input.name,
        input.position,
        input.isActive,
        input.kind ?? 'other',
      ]);
      return pgAttributes(userId);
    },

    async saveAttributeValue(_accessToken, userId, input) {
      await pgCall(userId, 'admin_save_attribute_value', [
        input.valueId ?? null,
        input.attributeId,
        input.slug,
        input.value,
        input.position,
        input.swatchHex ?? null,
      ]);
      return pgAttributes(userId);
    },

    async listVariants(_accessToken, userId, productId) {
      return pgVariants(userId, productId);
    },

    async saveVariant(_accessToken, userId, productId, input) {
      await pgCall(userId, 'admin_save_variant', [
        input.variantId ?? null,
        productId,
        input.sku,
        input.priceMinor ?? null,
        input.compareAtPriceMinor ?? null,
        input.imageUrl ?? null,
        input.position ?? 0,
        input.isActive ?? true,
        input.attributeValueIds,
      ]);
      return pgVariants(userId, productId);
    },

    async setVariantActive(_accessToken, userId, variantId, isActive) {
      await pgCall(userId, 'admin_set_variant_active', [variantId, isActive]);
    },

    async deleteVariant(_accessToken, userId, variantId) {
      await pgCall(userId, 'admin_delete_variant', [variantId]);
    },

    async adjustVariantStock(_accessToken, userId, variantId, change, note) {
      await pgCall(userId, 'admin_adjust_variant_stock', [variantId, change, note]);
    },

    async setVariantStock(_accessToken, userId, variantId, stock, note) {
      await pgCall(userId, 'admin_set_variant_stock', [variantId, stock, note]);
    },
  };

  /** Calls one permission-checking database function as the caller. */
  async function pgCall(userId: string, name: string, parameters: unknown[]) {
    try {
      await withUser(pool, userId, async (client) => {
        const placeholders = parameters.map((_, index) => `$${index + 1}`).join(', ');
        await client.query(`select public.${name}(${placeholders})`, parameters);
      });
    } catch (error) {
      throw failure(error, name);
    }
  }

  async function pgAttributes(userId: string): Promise<AdminAttribute[]> {
    try {
      return await withUser(pool, userId, async (client) => {
        const result = await client.query<{
          id: string;
          slug: string;
          name: string;
          position: number;
          is_active: boolean;
          kind: 'color' | 'size' | 'other';
          values: unknown;
        }>('select * from public.admin_list_attributes()');
        return result.rows.map((row) =>
          conform(
            adminAttributeSchema,
            {
              id: row.id,
              slug: row.slug,
              name: row.name,
              position: Number(row.position),
              isActive: row.is_active,
              kind: row.kind,
              values: attributeValuesSchema.parse(row.values ?? []),
            },
            'admin_list_attributes',
          ),
        );
      });
    } catch (error) {
      throw failure(error, 'admin_list_attributes');
    }
  }

  async function pgVariants(userId: string, productId: string): Promise<AdminVariant[]> {
    try {
      return await withUser(pool, userId, async (client) => {
        const result = await client.query<{
          id: string;
          sku: string;
          price_minor: string | number | null;
          compare_at_price_minor: string | number | null;
          stock_quantity: string | number;
          image_url: string | null;
          position: string | number;
          is_active: boolean;
          label: string | null;
          attribute_value_ids: string[];
        }>('select * from public.admin_product_variants($1::uuid)', [productId]);
        return result.rows.map((row) =>
          conform(
            adminVariantSchema,
            {
              id: row.id,
              sku: row.sku,
              priceMinor: row.price_minor === null ? null : Number(row.price_minor),
              compareAtPriceMinor:
                row.compare_at_price_minor === null ? null : Number(row.compare_at_price_minor),
              stockQuantity: Number(row.stock_quantity),
              imageUrl: row.image_url,
              position: Number(row.position),
              isActive: row.is_active,
              label: row.label,
              attributeValueIds: row.attribute_value_ids,
            },
            'admin_product_variants',
          ),
        );
      });
    } catch (error) {
      throw failure(error, 'admin_product_variants');
    }
  }
}
