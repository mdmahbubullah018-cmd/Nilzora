import {
  adminAdjustVariantStockRequestSchema,
  adminProductListQuerySchema,
  adminSaveAttributeRequestSchema,
  adminSaveAttributeValueRequestSchema,
  adminSaveVariantRequestSchema,
  adminSetVariantStockRequestSchema,
  categoryInputSchema,
  categoryReorderSchema,
  createProductRequestSchema,
  inventoryMovementListQuerySchema,
  productStatusRequestSchema,
  slugAvailabilityQuerySchema,
  stockAdjustmentRequestSchema,
  updateProductRequestSchema,
  type AdminCategory,
  type AdminAttributesResponse,
  type AdminCategoryListResponse,
  type AdminProductVariantsResponse,
  type AdminCategoryResponse,
  type AdminProductListResponse,
  type AdminProductResponse,
  type InventoryMovementListResponse,
  type SlugAvailabilityResponse,
} from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { Router } from 'express';
import { z } from 'zod';
import { sendError } from '../../http/send-error';
import {
  currentIdentity,
  requireAnyPermission,
  requirePermission,
} from '../../middleware/authorize';
import { requestInput, validate } from '../../middleware/validate';
import { noStore } from '../commerce/http';
import {
  createPictureUploads,
  imageContentType,
  readImageBody,
  requireStorage as requireStorageFor,
} from '../media/upload';
import { sendAdminFailure, type AdminRefusal, type RefusalAnswer } from './errors';
import type { AdminRouteDependencies } from './routes';
import { emptyBodySchema, pageInfo, pageOf, searchTerm } from './shared';

const productParams = z.object({ productId: uuidSchema });
const categoryParams = z.object({ categoryId: uuidSchema });

const listSchemas = { query: adminProductListQuerySchema };
const detailSchemas = { params: productParams };
const createSchemas = { body: createProductRequestSchema };
const updateSchemas = { params: productParams, body: updateProductRequestSchema };
const statusSchemas = { params: productParams, body: productStatusRequestSchema };
const stockSchemas = { params: productParams, body: stockAdjustmentRequestSchema };
const submitSchemas = { params: productParams, body: emptyBodySchema };
const createCategorySchemas = { body: categoryInputSchema };
const updateCategorySchemas = { params: categoryParams, body: categoryInputSchema };
const deleteCategorySchemas = { params: categoryParams };
const reorderCategoriesSchemas = { body: categoryReorderSchema };
const deleteProductSchemas = { params: productParams };
const movementSchemas = { query: inventoryMovementListQuerySchema };
const slugSchemas = { query: slugAvailabilityQuerySchema };

const saveAttributeSchemas = { body: adminSaveAttributeRequestSchema };
const saveAttributeValueSchemas = { body: adminSaveAttributeValueRequestSchema };
const saveVariantSchemas = { params: productParams, body: adminSaveVariantRequestSchema };
const variantParams = z.object({ productId: uuidSchema, variantId: uuidSchema });
const deleteVariantSchemas = { params: variantParams };
const variantActiveSchemas = {
  params: variantParams,
  body: z.strictObject({ isActive: z.boolean() }),
};
const variantStockSchemas = {
  params: variantParams,
  body: adminAdjustVariantStockRequestSchema,
};
const variantStockSetSchemas = {
  params: variantParams,
  body: adminSetVariantStockRequestSchema,
};

const ATTRIBUTE_ANSWERS: Partial<Record<AdminRefusal, RefusalAnswer>> = {
  not_found: [404, 'not_found', 'Attribute not found'],
  invalid_input: [400, 'bad_request', 'Check the name, address and values'],
  slug_taken: [409, 'name_taken', 'Another attribute already uses that address or value'],
};

const VARIANT_ANSWERS: Partial<Record<AdminRefusal, RefusalAnswer>> = {
  not_found: [404, 'not_found', 'Variant not found'],
  invalid_input: [400, 'bad_request', 'Check the SKU, price and chosen options'],
  variant_sku_taken: [409, 'variant_sku_taken', 'This SKU or option combination is already used'],
  variant_has_history: [
    409,
    'variant_has_history',
    'This combination has order or stock history. Hide it instead of deleting it.',
  ],
  variant_invalid: [409, 'variant_invalid', 'That variant no longer exists'],
  variant_required: [400, 'variant_required', 'Choose one value per attribute'],
  stock_below_zero: [409, 'stock_below_zero', 'Stock cannot go below zero'],
};

const PRODUCT_ANSWERS: Partial<Record<AdminRefusal, RefusalAnswer>> = {
  not_found: [404, 'not_found', 'Product not found'],
  invalid_input: [400, 'bad_request', 'Choose an existing category and values within range'],
};

/** admin_update_product: what shoppers pay for a product on sale is for publishers only. */
const UPDATE_ANSWERS: Partial<Record<AdminRefusal, RefusalAnswer>> = {
  ...PRODUCT_ANSWERS,
  missing_permission: [
    403,
    'forbidden',
    'Changing the price, order limit or featuring of a product on sale needs publish permission',
  ],
};

const CATEGORY_ANSWERS: Partial<Record<AdminRefusal, RefusalAnswer>> = {
  not_found: [404, 'not_found', 'Category not found'],
  slug_taken: [409, 'slug_taken', 'Another category already uses this address'],
  category_in_use: [
    409,
    'category_in_use',
    'Move or delete this category’s products and subcategories first',
  ],
};

/**
 * GET/POST /admin/products, GET/PUT /admin/products/:productId and its status, stock
 * and submit actions; GET /admin/slugs/availability; GET/POST /admin/categories, PUT /admin/categories/:categoryId;
 * GET /admin/inventory-movements (also inventory.adjust or products.update).
 *
 * Each route requires products.read (changes answer with the product as it is now)
 * plus the permission its database function checks again for the caller.
 */
export function adminCatalogRouter(deps: AdminRouteDependencies): Router {
  const router = Router();
  const { catalog } = deps.stores;
  const { requireUser, limiter } = deps;
  const canRead = requirePermission('products.read');
  const canEditCategories = requirePermission('products.read', 'products.publish');
  const canEditAttributes = requirePermission('products.read', 'products.update');
  const canDeleteVariants = requirePermission('products.read', 'products.publish');
  const requireStorage = requireStorageFor(deps.storage);
  const { storePicture, removePicture } = createPictureUploads(deps.storage, deps.logger);

  router.get(
    '/admin/products',
    noStore,
    requireUser,
    canRead,
    validate(listSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { query } = requestInput<typeof listSchemas>(res);
      const search = query.q === undefined ? undefined : searchTerm(query.q);
      // A search with nothing searchable left matches nothing; the database is not asked.
      const { products, total } =
        search === null
          ? { products: [], total: 0 }
          : await catalog.listProducts(
              identity.accessToken,
              identity.userId,
              {
                search,
                status: query.status,
                moderationStatus: query.moderationStatus,
                categoryId: query.categoryId,
                stock: query.stock,
              },
              query.sort,
              pageOf(query),
            );
      const response: AdminProductListResponse = { products, ...pageInfo(query, total) };
      res.json(response);
    },
  );

  /** Whether an address is free before a product, category or brand form saves it. */
  router.get(
    '/admin/slugs/availability',
    noStore,
    requireUser,
    canRead,
    validate(slugSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { query } = requestInput<typeof slugSchemas>(res);
      const answer: SlugAvailabilityResponse = await catalog.slugAvailability(
        identity.accessToken,
        identity.userId,
        { kind: query.kind, slug: query.slug, excludeId: query.excludeId },
      );
      res.json(answer);
    },
  );

  router.get(
    '/admin/products/:productId',
    noStore,
    requireUser,
    canRead,
    validate(detailSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof detailSchemas>(res);
      const product = await catalog.getProduct(
        identity.accessToken,
        identity.userId,
        params.productId,
      );
      if (!product) {
        sendError(res, 404, 'not_found', 'Product not found');
        return;
      }
      const response: AdminProductResponse = { product };
      res.json(response);
    },
  );

  router.post(
    '/admin/products',
    noStore,
    limiter,
    requireUser,
    requirePermission('products.read', 'products.create'),
    validate(createSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { body } = requestInput<typeof createSchemas>(res);
      try {
        const product = await catalog.createProduct(identity.accessToken, identity.userId, body);
        const response: AdminProductResponse = { product };
        res.status(201).json(response);
      } catch (error) {
        sendAdminFailure(res, error, PRODUCT_ANSWERS);
      }
    },
  );

  router.put(
    '/admin/products/:productId',
    noStore,
    limiter,
    requireUser,
    requirePermission('products.read', 'products.update'),
    validate(updateSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof updateSchemas>(res);
      try {
        const product = await catalog.updateProduct(
          identity.accessToken,
          identity.userId,
          params.productId,
          body,
        );
        const response: AdminProductResponse = { product };
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error, UPDATE_ANSWERS);
      }
    },
  );

  router.post(
    '/admin/products/:productId/status',
    noStore,
    limiter,
    requireUser,
    requirePermission('products.read', 'products.publish'),
    validate(statusSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof statusSchemas>(res);
      try {
        const product = await catalog.setProductStatus(
          identity.accessToken,
          identity.userId,
          params.productId,
          body.status,
        );
        const response: AdminProductResponse = { product };
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error, PRODUCT_ANSWERS);
      }
    },
  );

  router.post(
    '/admin/products/:productId/stock',
    noStore,
    limiter,
    requireUser,
    requirePermission('products.read', 'inventory.adjust'),
    validate(stockSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof stockSchemas>(res);
      try {
        const product = await catalog.adjustStock(
          identity.accessToken,
          identity.userId,
          params.productId,
          body.change,
          body.note,
        );
        const response: AdminProductResponse = { product };
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error, PRODUCT_ANSWERS);
      }
    },
  );

  router.post(
    '/admin/products/:productId/submit',
    noStore,
    limiter,
    requireUser,
    requirePermission('products.read', 'products.update'),
    validate(submitSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof submitSchemas>(res);
      try {
        const product = await catalog.submitForReview(
          identity.accessToken,
          identity.userId,
          params.productId,
        );
        const response: AdminProductResponse = { product };
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error, {
          ...PRODUCT_ANSWERS,
          content_locked: [
            409,
            'product_content_locked',
            'Only draft products can be submitted for review',
          ],
        });
      }
    },
  );

  router.get('/admin/categories', noStore, requireUser, canRead, async (_req, res) => {
    const identity = currentIdentity(res);
    const response: AdminCategoryListResponse = {
      categories: await catalog.listCategories(identity.accessToken, identity.userId),
    };
    res.json(response);
  });

  router.post(
    '/admin/categories',
    noStore,
    limiter,
    requireUser,
    requirePermission('products.read', 'products.publish'),
    validate(createCategorySchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { body } = requestInput<typeof createCategorySchemas>(res);
      try {
        const category = await catalog.saveCategory(
          identity.accessToken,
          identity.userId,
          null,
          body,
        );
        const response: AdminCategoryResponse = { category };
        res.status(201).json(response);
      } catch (error) {
        sendAdminFailure(res, error, CATEGORY_ANSWERS);
      }
    },
  );

  // One group of categories, in the order it should appear: atomic, audited, and refused when
  // the list is not exactly that group (so a stale screen cannot scramble the order).
  router.post(
    '/admin/categories/reorder',
    noStore,
    limiter,
    requireUser,
    requirePermission('products.read', 'products.publish'),
    validate(reorderCategoriesSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { body } = requestInput<typeof reorderCategoriesSchemas>(res);
      try {
        await catalog.reorderCategories(
          identity.accessToken,
          identity.userId,
          body.parentId,
          body.ids,
        );
        res.status(204).end();
      } catch (error) {
        sendAdminFailure(res, error, CATEGORY_ANSWERS);
      }
    },
  );

  router.put(
    '/admin/categories/:categoryId',
    noStore,
    limiter,
    requireUser,
    requirePermission('products.read', 'products.publish'),
    validate(updateCategorySchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof updateCategorySchemas>(res);
      try {
        const category = await catalog.saveCategory(
          identity.accessToken,
          identity.userId,
          params.categoryId,
          body,
        );
        const response: AdminCategoryResponse = { category };
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error, CATEGORY_ANSWERS);
      }
    },
  );

  // Refuses (409) while products or subcategories still reference the category, so a
  // A product that was never ordered can be deleted for good; one with orders is archived.
  router.delete(
    '/admin/products/:productId',
    noStore,
    limiter,
    requireUser,
    requirePermission('products.read', 'products.publish'),
    validate(deleteProductSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof deleteProductSchemas>(res);
      let files: { imageKeys: string[]; videoKeys: string[] };
      try {
        files = await catalog.deleteProduct(
          identity.accessToken,
          identity.userId,
          params.productId,
        );
      } catch (error) {
        sendAdminFailure(res, error, {
          ...PRODUCT_ANSWERS,
          content_locked: [
            409,
            'product_content_locked',
            'Unpublish the product before deleting it',
          ],
          in_use: [
            409,
            'in_use',
            'This product has orders, so it cannot be deleted. Archive it instead.',
          ],
        });
        return;
      }
      // The rows are gone; their files go only now, so a refused delete keeps them.
      for (const key of files.imageKeys) await removePicture(key, res);
      if (files.videoKeys.length > 0 && deps.storage) {
        await deps.storage.objects.deleteMany(files.videoKeys).catch((error: unknown) => {
          res.req.log.warn({ err: error }, 'Product video files not deleted');
        });
      }
      res.status(204).end();
    },
  );

  // delete never cascades into catalog or order records.
  router.delete(
    '/admin/categories/:categoryId',
    noStore,
    limiter,
    requireUser,
    requirePermission('products.read', 'products.publish'),
    validate(deleteCategorySchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof deleteCategorySchemas>(res);
      try {
        const banner = await catalog.categoryBannerKey(
          identity.accessToken,
          identity.userId,
          params.categoryId,
        );
        const picture = await catalog.deleteCategory(
          identity.accessToken,
          identity.userId,
          params.categoryId,
        );
        // The row is gone; its pictures' files go only now, so a refused delete keeps them.
        await removePicture(picture, res);
        await removePicture(banner, res);
        res.status(204).end();
      } catch (error) {
        sendAdminFailure(res, error, CATEGORY_ANSWERS);
      }
    },
  );

  // Category cover image. The server derives the storage key from the category id, so a
  // client can never point the category at an object it does not own.
  router.post(
    '/admin/categories/:categoryId/image',
    noStore,
    limiter,
    requireUser,
    canEditCategories,
    validate(deleteCategorySchemas),
    imageContentType,
    requireStorage,
    readImageBody,
    async (req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof deleteCategorySchemas>(res);
      // storePicture adds a fresh picture id, which the database checks: a replacement must
      // never reuse the address of the picture it replaced (the objects cache forever).
      const key = await storePicture(req.body as unknown, res, `categories/${params.categoryId}`);
      if (key === null) return;
      try {
        const replaced = await catalog.setCategoryImage(
          identity.accessToken,
          identity.userId,
          params.categoryId,
          key,
        );
        await removePicture(replaced, res);
      } catch (error) {
        await removePicture(key, res);
        sendAdminFailure(res, error, CATEGORY_ANSWERS);
        return;
      }
      const response: AdminCategoryResponse = {
        category: (await catalog.listCategories(identity.accessToken, identity.userId)).find(
          (category) => category.id === params.categoryId,
        ) as AdminCategory,
      };
      res.json(response);
    },
  );

  router.delete(
    '/admin/categories/:categoryId/image',
    noStore,
    limiter,
    requireUser,
    canEditCategories,
    validate(deleteCategorySchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof deleteCategorySchemas>(res);
      try {
        const cleared = await catalog.setCategoryImage(
          identity.accessToken,
          identity.userId,
          params.categoryId,
          null,
        );
        await removePicture(cleared, res);
        res.status(204).end();
      } catch (error) {
        sendAdminFailure(res, error, CATEGORY_ANSWERS);
      }
    },
  );

  // Category page banner: wide artwork for the category's own screen. The same upload pipeline,
  // validation and key derivation as the cover image; only the column it is saved in differs.
  router.post(
    '/admin/categories/:categoryId/banner',
    noStore,
    limiter,
    requireUser,
    canEditCategories,
    validate(deleteCategorySchemas),
    imageContentType,
    requireStorage,
    readImageBody,
    async (req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof deleteCategorySchemas>(res);
      const key = await storePicture(req.body as unknown, res, `categories/${params.categoryId}`);
      if (key === null) return;
      try {
        const replaced = await catalog.setCategoryBanner(
          identity.accessToken,
          identity.userId,
          params.categoryId,
          key,
        );
        await removePicture(replaced, res);
      } catch (error) {
        await removePicture(key, res);
        sendAdminFailure(res, error, CATEGORY_ANSWERS);
        return;
      }
      const response: AdminCategoryResponse = {
        category: (await catalog.listCategories(identity.accessToken, identity.userId)).find(
          (category) => category.id === params.categoryId,
        ) as AdminCategory,
      };
      res.json(response);
    },
  );

  router.delete(
    '/admin/categories/:categoryId/banner',
    noStore,
    limiter,
    requireUser,
    canEditCategories,
    validate(deleteCategorySchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof deleteCategorySchemas>(res);
      try {
        const cleared = await catalog.setCategoryBanner(
          identity.accessToken,
          identity.userId,
          params.categoryId,
          null,
        );
        await removePicture(cleared, res);
        res.status(204).end();
      } catch (error) {
        sendAdminFailure(res, error, CATEGORY_ANSWERS);
      }
    },
  );

  // The stock ledger is readable by those who adjust stock or edit products (its RLS policy).
  router.get(
    '/admin/inventory-movements',
    noStore,
    requireUser,
    canRead,
    requireAnyPermission(['inventory.adjust', 'products.update']),
    validate(movementSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { query } = requestInput<typeof movementSchemas>(res);
      const { movements, total } = await catalog.listMovements(
        identity.accessToken,
        identity.userId,
        { productId: query.productId, reason: query.reason },
        pageOf(query),
      );
      const response: InventoryMovementListResponse = { movements, ...pageInfo(query, total) };
      res.json(response);
    },
  );

  // ---------------------------------------------------------------------------
  // Product attributes and variants. The database re-checks every permission.
  // ---------------------------------------------------------------------------

  router.get('/admin/attributes', noStore, requireUser, canRead, async (_req, res) => {
    const identity = currentIdentity(res);
    try {
      const attributes = await catalog.listAttributes(identity.accessToken, identity.userId);
      const response: AdminAttributesResponse = { attributes };
      res.json(response);
    } catch (error) {
      sendAdminFailure(res, error, ATTRIBUTE_ANSWERS);
    }
  });

  router.post(
    '/admin/attributes',
    noStore,
    limiter,
    requireUser,
    canEditAttributes,
    validate(saveAttributeSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { body } = requestInput<typeof saveAttributeSchemas>(res);
      try {
        const attributes = await catalog.saveAttribute(
          identity.accessToken,
          identity.userId,
          body.attributeId ?? null,
          body,
        );
        const response: AdminAttributesResponse = { attributes };
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error, ATTRIBUTE_ANSWERS);
      }
    },
  );

  router.post(
    '/admin/attributes/values',
    noStore,
    limiter,
    requireUser,
    canEditAttributes,
    validate(saveAttributeValueSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { body } = requestInput<typeof saveAttributeValueSchemas>(res);
      try {
        const attributes = await catalog.saveAttributeValue(
          identity.accessToken,
          identity.userId,
          body,
        );
        const response: AdminAttributesResponse = { attributes };
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error, ATTRIBUTE_ANSWERS);
      }
    },
  );

  router.get(
    '/admin/products/:productId/variants',
    noStore,
    requireUser,
    canRead,
    validate(detailSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof detailSchemas>(res);
      try {
        const variants = await catalog.listVariants(
          identity.accessToken,
          identity.userId,
          params.productId,
        );
        const response: AdminProductVariantsResponse = { variants };
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error, VARIANT_ANSWERS);
      }
    },
  );

  router.post(
    '/admin/products/:productId/variants',
    noStore,
    limiter,
    requireUser,
    canEditAttributes,
    validate(saveVariantSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof saveVariantSchemas>(res);
      try {
        const variants = await catalog.saveVariant(
          identity.accessToken,
          identity.userId,
          params.productId,
          body,
        );
        const response: AdminProductVariantsResponse = { variants };
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error, VARIANT_ANSWERS);
      }
    },
  );

  router.post(
    '/admin/products/:productId/variants/:variantId/active',
    noStore,
    limiter,
    requireUser,
    canEditAttributes,
    validate(variantActiveSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof variantActiveSchemas>(res);
      try {
        await catalog.setVariantActive(
          identity.accessToken,
          identity.userId,
          params.variantId,
          body.isActive,
        );
        const variants = await catalog.listVariants(
          identity.accessToken,
          identity.userId,
          params.productId,
        );
        const response: AdminProductVariantsResponse = { variants };
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error, VARIANT_ANSWERS);
      }
    },
  );

  router.post(
    '/admin/products/:productId/variants/:variantId/stock',
    noStore,
    limiter,
    requireUser,
    requirePermission('products.read', 'inventory.adjust'),
    validate(variantStockSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof variantStockSchemas>(res);
      try {
        await catalog.adjustVariantStock(
          identity.accessToken,
          identity.userId,
          params.variantId,
          body.change,
          body.note,
        );
        const variants = await catalog.listVariants(
          identity.accessToken,
          identity.userId,
          params.productId,
        );
        const response: AdminProductVariantsResponse = { variants };
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error, VARIANT_ANSWERS);
      }
    },
  );

  router.post(
    '/admin/products/:productId/variants/:variantId/stock/set',
    noStore,
    limiter,
    requireUser,
    requirePermission('products.read', 'inventory.adjust'),
    validate(variantStockSetSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof variantStockSetSchemas>(res);
      try {
        await catalog.setVariantStock(
          identity.accessToken,
          identity.userId,
          params.variantId,
          body.stock,
          body.note,
        );
        const variants = await catalog.listVariants(
          identity.accessToken,
          identity.userId,
          params.productId,
        );
        const response: AdminProductVariantsResponse = { variants };
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error, VARIANT_ANSWERS);
      }
    },
  );

  router.delete(
    '/admin/products/:productId/variants/:variantId',
    noStore,
    limiter,
    requireUser,
    canDeleteVariants,
    validate(deleteVariantSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof deleteVariantSchemas>(res);
      try {
        await catalog.deleteVariant(identity.accessToken, identity.userId, params.variantId);
        res.status(204).end();
      } catch (error) {
        sendAdminFailure(res, error, VARIANT_ANSWERS);
      }
    },
  );

  return router;
}
