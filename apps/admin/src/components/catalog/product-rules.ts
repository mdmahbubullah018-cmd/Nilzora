import type { AdminProductDetail, AppRole, Permission } from '@nilzora/contracts';

/*
 * What can be done to a product right now, mirroring the database's rules (the
 * admin_permissions_moderation migration) so the page offers only actions that can
 * succeed and explains the others. Display only: the API and the database decide.
 *
 * - Content (category, address, name, texts) is locked while the product is on sale
 *   (NZ430) or under review (NZ431); changing it sends approved content back to
 *   "not submitted".
 * - Only drafts whose content is not under review or approved can be submitted.
 * - Only a pending review can be withdrawn.
 * - Publishing needs approved content (NZ432), unless the account is the store owner:
 *   a super admin publishing content that is not approved approves it as it stands.
 *   Unpublishing and archiving work anytime.
 * - Price, former price, order limit and featuring of a product ON SALE change only
 *   with products.publish; on drafts and archived products products.update is enough.
 */

type ProductState = Pick<AdminProductDetail, 'status' | 'moderationStatus' | 'latestReview'>;

/** Why the content cannot be edited now, or null when it can. */
export type ContentLock = 'live' | 'review' | null;

export function contentLock(
  product: Pick<ProductState, 'status' | 'moderationStatus'>,
): ContentLock {
  if (product.status === 'active') return 'live';
  if (product.moderationStatus === 'pending') return 'review';
  return null;
}

export function canSubmitForReview(
  product: Pick<ProductState, 'status' | 'moderationStatus'>,
): boolean {
  return (
    product.status === 'draft' &&
    product.moderationStatus !== 'pending' &&
    product.moderationStatus !== 'approved'
  );
}

export function canWithdrawReview(product: ProductState): boolean {
  return product.moderationStatus === 'pending' && product.latestReview?.status === 'pending';
}

export function canPublish(
  product: Pick<ProductState, 'status' | 'moderationStatus'>,
  abilities: Pick<ProductAbilities, 'owner'> = { owner: false },
): boolean {
  return (
    product.status !== 'active' &&
    (product.moderationStatus === 'approved' || abilities.owner)
  );
}

/** The permissions behind each product control (the API checks them again). */
export interface ProductAbilities {
  /** products.update: content, pricing, ordering, submit and withdraw. */
  edit: boolean;
  /** products.publish: publish, unpublish, archive and restore. */
  publish: boolean;
  /** inventory.adjust */
  adjustStock: boolean;
  /** super_admin: may publish content that no review has approved yet. */
  owner: boolean;
}

export function productAbilities(
  permissions: readonly Permission[],
  role?: AppRole,
): ProductAbilities {
  return {
    edit: permissions.includes('products.update'),
    publish: permissions.includes('products.publish'),
    adjustStock: permissions.includes('inventory.adjust'),
    owner: role === 'super_admin',
  };
}

/**
 * Whether the account may change price, former price, order limit and featuring now:
 * products.update, plus products.publish while the product is on sale.
 */
export function canEditOperations(
  product: Pick<ProductState, 'status'>,
  abilities: ProductAbilities,
): boolean {
  return abilities.edit && (product.status !== 'active' || abilities.publish);
}
