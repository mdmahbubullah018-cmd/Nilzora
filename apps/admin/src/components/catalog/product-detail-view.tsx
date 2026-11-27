import type {
  ProductVideo,
  AccountRef,
  AdminBrand,
  AdminCategory,
  AdminProductDetail,
  AdminShoppingZone,
  AdminVariant,
  InventoryMovementListResponse,
  SeoOverviewRow,
} from '@nilzora/contracts';
import { Alert, buttonClasses } from '@nilzora/ui';
import {
  BadgeCheck,
  Boxes,
  ClipboardCheck,
  FileText,
  Images,
  Info,
  Layers,
  Rocket,
  Ruler,
  Search,
  Shapes,
  Sparkles,
  Tag,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  Chip,
  DetailList,
  ModerationStatusBadge,
  ModerationTaskStatusBadge,
  MODERATION_STATUS,
  PageToolbar,
  ProductStatusBadge,
  ReadState,
  SectionCard,
  StockBadge,
  type ReadFailure,
} from '@/components/admin-kit';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { ProductBrandForm } from '@/components/merch/merch-forms';
import { accountName, adminReviewHref } from '@/components/moderation/moderation-views';
import { formatCount, formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { movementListHref } from './catalog-query';
import { TOUCH, ViewOnly } from './catalog-ui';
import { poishaToTaka, type FormValues } from './form-values';
import { RecentMovementList } from './movements';
import { SuccessNotice } from './page-states';
import {
  BasicInfoFields,
  MerchandisingFields,
  OrderLimitField,
  PricingFields,
  ProductForm,
  SizeChartField,
} from './product-editor';
import {
  ArchiveForm,
  PublishForm,
  RestoreForm,
  StockAdjustForm,
  SubmitForReviewForm,
  UnpublishForm,
  WithdrawReviewForm,
} from './product-forms';
import { ProductMedia } from './product-image-gallery';
import { ProductVideos } from './product-videos';
import { ProductZoneForm } from '@/components/zones/assignment-forms';
import { DeleteProductForm } from './delete-forms';
import { ProductPreview } from './product-preview';
import { ProductShare } from './product-share';
import {
  canEditOperations,
  canPublish,
  canSubmitForReview,
  canWithdrawReview,
  contentLock,
  type ProductAbilities,
} from './product-rules';
import {
  Anchored,
  launchChecklist,
  LaunchChecklist,
  PRODUCT_ANCHORS,
  ProductSectionNav,
  SeoSnippet,
  type ProductAnchor,
} from './product-overview';
import { ProductTile, StockMeter } from './product-tile';
import { sizeChartToText, tagsToText, type ProductSection } from './product-validation';
import { AutoText } from '@/components/i18n/translate';
import { CountText, DateTimeText } from '@/components/i18n/format-text';

const NO_EDIT = 'Your account can view products but not edit them.';
const LIVE_OPERATIONS =
  'This product is on sale: changing its price, former price, order limit, featuring or tags needs the “Publish products” permission.';

/** The SEO editor's address for a product (its route is singular: /admin/seo/product/:id). */
export function productSeoPath(productId: string): Route {
  return `/admin/seo/product/${productId}` as Route;
}

/** Every field the product form may show, as the product has it now. */
export function savedProductValues(product: AdminProductDetail): FormValues {
  return {
    categoryId: product.category.id,
    slug: product.slug,
    name: product.name,
    summary: product.summary ?? '',
    description: product.description ?? '',
    price: poishaToTaka(product.priceMinor),
    compareAtPrice: poishaToTaka(product.compareAtPriceMinor),
    maxOrderQuantity: String(product.maxOrderQuantity),
    isFeatured: product.isFeatured ? 'on' : '',
    ...(product.tags === undefined ? {} : { tags: tagsToText(product.tags) }),
    ...(product.sizeChart === undefined ? {} : { sizeChart: sizeChartToText(product.sizeChart) }),
  };
}

/** The sections this account may change on this product right now. */
export function editableSections(
  product: AdminProductDetail,
  abilities: ProductAbilities,
  categoriesLoaded: boolean,
): ProductSection[] {
  const sections: ProductSection[] = [];
  if (abilities.edit && contentLock(product) === null && categoriesLoaded) sections.push('content');
  if (canEditOperations(product, abilities)) sections.push('pricing', 'ordering');
  return sections;
}

/**
 * Why a section is read-only, and what would unlock it. The advice is only useful if the
 * account can carry it out, so an account that cannot unpublish is told exactly that
 * instead of being sent to a button it does not have.
 */
function LockNotice({
  product,
  what,
  abilities,
}: {
  product: AdminProductDetail;
  what: 'Content' | 'Images' | 'The size chart';
  abilities: ProductAbilities;
}) {
  const lock = contentLock(product);
  const lower = what === 'Content' ? 'content' : what === 'Images' ? 'images' : 'size chart';
  if (lock === 'live') {
    return (
      <Alert
        tone="info"
        title={`${what} ${what === 'Images' ? 'are' : 'is'} locked while the product is on sale`}
      >
        {abilities.publish ? (
          <>
            To change {what === 'Images' ? 'them' : 'it'}, unpublish the product, edit the {lower}{' '}
            and submit it for review again.
          </>
        ) : (
          <>
            It has to come off sale first, and your account cannot unpublish products: that needs
            the “Publish products” permission. Ask an administrator or the store owner to take it
            off sale, then edit the {lower}.
          </>
        )}
      </Alert>
    );
  }
  if (lock === 'review') {
    return (
      <Alert
        tone="info"
        title={
          what === 'Content'
            ? 'Content is locked while it is under review'
            : `${what} ${what === 'Images' ? 'are' : 'is'} locked while the content is under review`
        }
      >
        Withdraw the review to change the {lower}, then submit it again.
      </Alert>
    );
  }
  return null;
}

function BasicInfoSection({
  product,
  categories,
  abilities,
  editable,
}: {
  product: AdminProductDetail;
  categories: readonly AdminCategory[] | null;
  abilities: ProductAbilities;
  editable: boolean;
}) {
  const lock = contentLock(product);
  return (
    <SectionCard
      title="Basic info"
      icon={FileText}
      description="What shoppers read. A moderator reviews it before the product can go on sale."
    >
      <div className="grid gap-5">
        <LockNotice product={product} what="Content" abilities={abilities} />
        {editable && categories ? (
          <>
            <BasicInfoFields
              categories={categories}
              productId={product.id}
              savedSlug={product.slug}
            />
            {product.moderationStatus === 'not_submitted' ? null : (
              <ViewOnly>
                <AutoText>
                  Changing the content clears its review: it must be submitted and approved again.
                </AutoText>
              </ViewOnly>
            )}
          </>
        ) : (
          <>
            <DetailList
              items={[
                { label: 'Name', value: product.name },
                {
                  label: 'Category',
                  value: product.category.isActive
                    ? product.category.name
                    : `${product.category.name} (hidden)`,
                },
                {
                  label: 'Storefront address',
                  value: <span className="font-mono text-xs">/products/{product.slug}</span>,
                },
                { label: 'Summary', value: product.summary, wide: true },
                {
                  label: 'Description',
                  value: product.description ? (
                    <span className="whitespace-pre-line">
                      <AutoText value={product.description} />
                    </span>
                  ) : null,
                  wide: true,
                },
              ]}
            />
            {!abilities.edit ? (
              <ViewOnly>
                <AutoText value={NO_EDIT} />
              </ViewOnly>
            ) : lock === null && categories === null ? (
              <ViewOnly>
                The categories could not be loaded, so the content cannot be edited right now.
                Reload the page to try again.
              </ViewOnly>
            ) : null}
          </>
        )}
      </div>
    </SectionCard>
  );
}

/**
 * The product's pictures. They are part of the content a moderator reviews, so they are
 * locked for the same reasons as the text (on sale, under review); the API enforces it.
 */
function MediaSection({
  product,
  abilities,
  csrf,
  videos,
}: {
  product: AdminProductDetail;
  abilities: ProductAbilities;
  csrf: CsrfInput;
  videos?: readonly ProductVideo[] | null | undefined;
}) {
  const editable = abilities.edit && contentLock(product) === null;
  return (
    <SectionCard
      title="Media"
      icon={Images}
      description="Shown to shoppers. The first picture is the cover shown in listings. Reviewed with the content."
    >
      <div className="grid gap-5">
        <LockNotice product={product} what="Images" abilities={abilities} />
        <ProductMedia
          productId={product.id}
          images={product.images}
          csrf={csrf}
          editable={editable}
        />
        {videos !== undefined ? (
          <ProductVideos productId={product.id} videos={videos} csrf={csrf} editable={editable} />
        ) : null}
        {!abilities.edit ? (
          <ViewOnly>
            <AutoText>
              Your account can view products but not change their images or videos.
            </AutoText>
          </ViewOnly>
        ) : null}
      </div>
    </SectionCard>
  );
}

function PricingSection({
  product,
  operations,
  note,
}: {
  product: AdminProductDetail;
  operations: boolean;
  note: string;
}) {
  return (
    <SectionCard
      title="Pricing"
      icon={Tag}
      description="In Bangladeshi taka (BDT). Shoppers see a new price straight away, also while the product is on sale."
    >
      {operations ? (
        <PricingFields />
      ) : (
        <div className="grid gap-4">
          <DetailList
            items={[
              { label: 'Price', value: formatMoney(product.priceMinor) },
              {
                label: 'Former price',
                value:
                  product.compareAtPriceMinor === null
                    ? null
                    : formatMoney(product.compareAtPriceMinor),
              },
            ]}
          />
          <ViewOnly>
            <AutoText value={note} />
          </ViewOnly>
        </div>
      )}
    </SectionCard>
  );
}

/**
 * The stock of each option. A product with variants keeps its stock on them (the database
 * refuses a change to the product's own total), so they are listed here with a link to
 * adjust them.
 */
function VariantStockList({
  product,
  variants,
  canAdjust,
}: {
  product: AdminProductDetail;
  variants: readonly AdminVariant[];
  canAdjust: boolean;
}) {
  return (
    <div className="grid gap-3">
      <div className="nz-scroll overflow-x-auto rounded-xl border border-hairline">
        <table className="w-full text-sm">
          <caption className="sr-only">
            <AutoText>Stock per variant</AutoText>
          </caption>
          <thead className="bg-neutral-soft text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                <AutoText>Variant</AutoText>
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                <AutoText>SKU</AutoText>
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                <AutoText>Stock</AutoText>
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                <span className="sr-only">
                  <AutoText>State</AutoText>
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {variants.map((variant) => (
              <tr key={variant.id} className="border-t border-hairline">
                <th scope="row" className="px-3 py-2 text-left font-medium text-foreground">
                  {variant.label ?? variant.sku}
                </th>
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap text-muted-foreground">
                  {variant.sku}
                </td>
                <td className="px-3 py-2 text-right text-foreground tabular-nums">
                  {formatCount(variant.stockQuantity)}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {variant.isActive ? (
                    <StockBadge quantity={variant.stockQuantity} />
                  ) : (
                    <Chip tone="neutral">
                      <AutoText>Hidden</AutoText>
                    </Chip>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        <AutoText>
          The product total counts variants on sale only. Hidden variants keep their stock.
        </AutoText>
      </p>
      <Link
        href={`/admin/products/${product.id}/variants` as Route}
        className={buttonClasses({ variant: 'outline', className: `w-fit rounded-xl ${TOUCH}` })}
      >
        {canAdjust ? 'Adjust variant stock' : 'Open variants'}
      </Link>
    </div>
  );
}

function InventorySection({
  product,
  movements,
  abilities,
  operations,
  csrf,
  variants,
}: {
  product: AdminProductDetail;
  movements: { kind: 'ok'; value: InventoryMovementListResponse } | { kind: ReadFailure };
  abilities: ProductAbilities;
  operations: boolean;
  csrf: CsrfInput;
  variants: readonly AdminVariant[] | null | undefined;
}) {
  const ledger = movementListHref({ product: product.id, page: 1 });
  const hasVariants = (variants?.length ?? 0) > 0;
  return (
    <SectionCard
      title="Inventory"
      icon={Boxes}
      description={
        hasVariants
          ? 'This product sells in variants: each one holds its own stock, changed through orders and recorded adjustments.'
          : 'Stock changes only through orders and recorded adjustments, never by editing the number.'
      }
      actions={
        <Link
          href={ledger}
          className={buttonClasses({
            variant: 'ghost',
            size: 'sm',
            className: `text-link ${TOUCH}`,
          })}
        >
          <AutoText>Full ledger</AutoText>
        </Link>
      }
    >
      <div className="grid gap-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="grid content-start gap-3">
            <DetailList
              columns={1}
              items={[
                {
                  label: 'SKU',
                  value: (
                    <span className="font-mono">
                      <AutoText value={product.sku} />
                    </span>
                  ),
                },
              ]}
            />
            <StockMeter quantity={product.stockQuantity} />
          </div>
          <div className="grid content-start gap-3">
            {operations ? (
              <OrderLimitField />
            ) : (
              <DetailList
                columns={1}
                items={[{ label: 'Most units per order', value: String(product.maxOrderQuantity) }]}
              />
            )}
          </div>
        </div>
        <div className="grid gap-3 border-t border-hairline pt-5">
          <h3 className="text-sm font-semibold text-foreground">
            {hasVariants ? 'Stock per variant' : 'Adjust stock'}
          </h3>
          {hasVariants && variants ? (
            <VariantStockList
              product={product}
              variants={variants}
              canAdjust={abilities.adjustStock}
            />
          ) : variants === null ? (
            <ViewOnly>
              The variants could not be loaded, so stock cannot be adjusted here right now. Reload
              the page, or adjust it on the variants page.
            </ViewOnly>
          ) : abilities.adjustStock ? (
            <StockAdjustForm
              csrf={csrf}
              productId={product.id}
              stockQuantity={product.stockQuantity}
            />
          ) : (
            <ViewOnly>
              <AutoText>Your account cannot adjust stock.</AutoText>
            </ViewOnly>
          )}
        </div>
        <div className="grid gap-3 border-t border-hairline pt-5">
          <h3 className="text-sm font-semibold text-foreground">
            <AutoText>Recent movements</AutoText>
          </h3>
          {movements.kind === 'ok' ? (
            movements.value.movements.length > 0 ? (
              <>
                <RecentMovementList movements={movements.value.movements} />
                {movements.value.total > movements.value.movements.length ? (
                  <Link
                    href={ledger}
                    className="nz-tap text-xs font-medium text-link underline-offset-4 hover:underline"
                  >
                    See all <CountText count={movements.value.total} one="movement" />
                  </Link>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                <AutoText>No stock movements yet.</AutoText>
              </p>
            )
          ) : (
            <ReadState failure={movements.kind} compact />
          )}
        </div>
      </div>
    </SectionCard>
  );
}

/** A size chart as shoppers read it. */
function SizeChartTable({ product }: { product: AdminProductDetail }) {
  const chart = product.sizeChart;
  if (!chart || chart.columns.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        <AutoText>This product has no size chart.</AutoText>
      </p>
    );
  }
  return (
    <div className="nz-scroll overflow-x-auto rounded-xl border border-hairline">
      <table className="w-full text-sm">
        <caption className="sr-only">
          <AutoText>Size chart</AutoText>
        </caption>
        <thead className="bg-neutral-soft">
          <tr>
            {chart.columns.map((column, index) => (
              <th
                key={`h-${String(index)}`}
                scope="col"
                className="px-3 py-2 text-left font-semibold whitespace-nowrap text-foreground"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {chart.rows.map((row, rowIndex) => (
            <tr key={`r-${String(rowIndex)}`} className="border-t border-hairline">
              {row.map((cell, cellIndex) => (
                <td
                  key={`c-${String(cellIndex)}`}
                  className="px-3 py-2 whitespace-nowrap text-body"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SizeChartSection({
  product,
  editable,
  abilities,
}: {
  product: AdminProductDetail;
  editable: boolean;
  abilities: ProductAbilities;
}) {
  return (
    <SectionCard
      title="Size chart"
      icon={Ruler}
      description="Measurements shoppers compare before choosing a size. Reviewed with the content."
    >
      <div className="grid gap-4">
        <LockNotice product={product} what="The size chart" abilities={abilities} />
        {editable ? <SizeChartField /> : <SizeChartTable product={product} />}
      </div>
    </SectionCard>
  );
}

function MerchandisingSection({
  product,
  operations,
  note,
}: {
  product: AdminProductDetail;
  operations: boolean;
  note: string;
}) {
  const tags = product.tags;
  return (
    <SectionCard
      title="Merchandising"
      icon={Sparkles}
      description="Home page featuring, and tags staff use to group products. Changed like the price."
    >
      {operations ? (
        <MerchandisingFields showTags={tags !== undefined} />
      ) : (
        <div className="grid gap-4">
          <DetailList
            items={[
              { label: 'Featured', value: product.isFeatured ? 'Yes' : 'No' },
              ...(tags === undefined
                ? []
                : [
                    {
                      label: 'Tags',
                      value:
                        tags.length > 0 ? (
                          <span className="flex flex-wrap gap-1.5">
                            {tags.map((tag) => (
                              <Chip key={tag} tone="primary">
                                {tag}
                              </Chip>
                            ))}
                          </span>
                        ) : null,
                    },
                  ]),
            ]}
          />
          <ViewOnly>
            <AutoText value={note} />
          </ViewOnly>
        </div>
      )}
    </SectionCard>
  );
}

function PublishingSection({
  product,
  abilities,
  csrf,
}: {
  product: AdminProductDetail;
  abilities: ProductAbilities;
  csrf: CsrfInput;
}) {
  const { status } = product;
  const approved = product.moderationStatus === 'approved';
  /** The owner may publish unapproved content; publishing then approves it. */
  const ownerOverride = abilities.owner && !approved && status !== 'active';
  let explanation: ReactNode;
  if (status === 'active') {
    explanation = product.publishedAt
      ? `On sale in the storefront. Published ${formatDate(product.publishedAt)}.`
      : 'On sale in the storefront.';
  } else if (approved) {
    explanation = 'The content is approved, so the product can be published.';
  } else if (ownerOverride) {
    explanation = `Publishing needs approved content. As the store owner you can publish anyway: the content is approved as it stands (review: ${MODERATION_STATUS[product.moderationStatus].label}).`;
  } else {
    explanation = `Publishing needs approved content. Review: ${MODERATION_STATUS[product.moderationStatus].label}.`;
  }
  if (status === 'archived') {
    explanation = (
      <>
        Archived and hidden from the storefront.{' '}
        {approved ? 'The content is still approved.' : 'Restore it as a draft to work on it again.'}
      </>
    );
  }

  return (
    <SectionCard title="Visibility & status" icon={Rocket}>
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <ProductStatusBadge status={status} />
          {product.category.isActive ? null : (
            <Chip tone="warning">
              <AutoText>Category hidden</AutoText>
            </Chip>
          )}
        </div>
        <p className="text-sm text-body">
          <AutoText value={explanation} />
        </p>
        {ownerOverride ? (
          <Alert tone="warning">
            Publishing now approves this content yourself: no moderator will review it. Edit it
            first if the content is not ready.
          </Alert>
        ) : null}
        {status === 'active' && !product.category.isActive ? (
          <Alert tone="warning">
            Its category is hidden, so shoppers cannot see this product until the category is shown
            again.
          </Alert>
        ) : null}
        {abilities.publish ? (
          <div className="flex flex-wrap items-start gap-2">
            {canPublish(product, abilities) ? (
              <PublishForm csrf={csrf} productId={product.id} approvesContent={ownerOverride} />
            ) : null}
            {status === 'active' ? <UnpublishForm csrf={csrf} productId={product.id} /> : null}
            {status === 'archived' ? <RestoreForm csrf={csrf} productId={product.id} /> : null}
            {status !== 'archived' ? <ArchiveForm csrf={csrf} productId={product.id} /> : null}
            {status !== 'active' ? (
              <DeleteProductForm productId={product.id} name={product.name} csrf={csrf} />
            ) : null}
          </div>
        ) : (
          <ViewOnly>
            <AutoText>Your account cannot publish, unpublish or archive products.</AutoText>
          </ViewOnly>
        )}
      </div>
    </SectionCard>
  );
}

function ReviewSection({
  product,
  reviewer,
  canOpenReview,
  abilities,
  csrf,
}: {
  product: AdminProductDetail;
  reviewer: AccountRef | null;
  /** moderation.assign: the review has its own page in the admin workspace. */
  canOpenReview: boolean;
  abilities: ProductAbilities;
  csrf: CsrfInput;
}) {
  const review = product.latestReview;
  const submittable = canSubmitForReview(product);
  const withdrawable = canWithdrawReview(product);
  const sentBack =
    review &&
    (review.status === 'changes_requested' || review.status === 'rejected') &&
    product.moderationStatus === review.status;

  let hint: string | undefined;
  if (product.moderationStatus === 'pending') {
    hint = review?.assigned
      ? 'A moderator is reviewing the content.'
      : 'Waiting for a moderator to be assigned.';
  } else if (product.moderationStatus === 'approved') {
    hint = 'Approved. Changing the content will need a new review.';
  } else if (!submittable && product.status === 'active') {
    hint = 'Only drafts can be submitted for review.';
  } else if (!submittable && product.status === 'archived') {
    hint = 'Restore the product as a draft to submit it for review.';
  } else if (submittable) {
    hint = sentBack
      ? 'Edit the content as asked, then submit it again.'
      : 'Submit the content when it is ready; a moderator then reviews it.';
  }

  return (
    <SectionCard
      title="Content review"
      icon={ClipboardCheck}
      actions={
        canOpenReview && review ? (
          <Link
            href={adminReviewHref(review.taskId)}
            className={buttonClasses({
              variant: 'ghost',
              size: 'sm',
              className: `text-link ${TOUCH}`,
            })}
          >
            <AutoText>Open review</AutoText>
          </Link>
        ) : undefined
      }
    >
      <div className="grid gap-4">
        <ModerationStatusBadge status={product.moderationStatus} className="w-fit" />
        {sentBack && review.note ? (
          <Alert
            tone={review.status === 'rejected' ? 'danger' : 'warning'}
            title={review.status === 'rejected' ? 'Rejected by the moderator' : 'Changes requested'}
          >
            <span className="whitespace-pre-line">
              <AutoText value={review.note} />
            </span>
          </Alert>
        ) : null}
        {hint ? (
          <p className="text-sm text-body">
            <AutoText value={hint} />
          </p>
        ) : null}
        {review ? (
          <DetailList
            columns={2}
            items={[
              {
                label: 'Latest review',
                value: <ModerationTaskStatusBadge status={review.status} />,
              },
              { label: 'Submitted', value: formatDateTime(review.submittedAt) },
              {
                label: 'Reviewer',
                value: review.assigned
                  ? accountName(reviewer, 'A moderator')
                  : review.status === 'pending'
                    ? 'Not yet assigned'
                    : null,
              },
              {
                label: 'Decided',
                value: review.decidedAt ? formatDateTime(review.decidedAt) : null,
              },
              ...(review.note && !sentBack
                ? [{ label: 'Moderator’s note', value: review.note, wide: true }]
                : []),
            ]}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            <AutoText>This product has never been reviewed.</AutoText>
          </p>
        )}
        {abilities.edit ? (
          submittable || withdrawable ? (
            <div className="flex flex-wrap gap-2">
              {submittable ? <SubmitForReviewForm csrf={csrf} productId={product.id} /> : null}
              {withdrawable ? <WithdrawReviewForm csrf={csrf} productId={product.id} /> : null}
            </div>
          ) : null
        ) : (
          <ViewOnly>
            <AutoText>Your account cannot submit or withdraw reviews.</AutoText>
          </ViewOnly>
        )}
      </div>
    </SectionCard>
  );
}

function VariantsSection({
  product,
  variants,
  canEdit,
}: {
  product: AdminProductDetail;
  variants: readonly AdminVariant[] | null;
  canEdit: boolean;
}) {
  const onSale = variants?.filter((variant) => variant.isActive).length ?? 0;
  const units = variants?.reduce((sum, variant) => sum + variant.stockQuantity, 0) ?? 0;
  return (
    <SectionCard
      title="Variants"
      icon={Shapes}
      description="Sizes, colours and other options, each with its own SKU, price and stock."
    >
      <div className="grid gap-4">
        {variants === null ? (
          <p className="text-sm text-muted-foreground">
            <AutoText>
              The variants could not be loaded right now. Open the variants page to see them.
            </AutoText>
          </p>
        ) : variants.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <AutoText>
              No variants: the product sells as a single item at its own price and stock.
            </AutoText>
          </p>
        ) : (
          <DetailList
            columns={2}
            items={[
              { label: 'Variants', value: formatCount(variants.length) },
              { label: 'On sale', value: formatCount(onSale) },
              { label: 'Units across variants', value: formatCount(units), wide: true },
            ]}
          />
        )}
        <Link
          href={`/admin/products/${product.id}/variants` as Route}
          className={buttonClasses({ variant: 'outline', className: `w-full rounded-xl ${TOUCH}` })}
        >
          {canEdit ? 'Manage variants' : 'View variants'}
        </Link>
      </div>
    </SectionCard>
  );
}

function SeoSection({
  product,
  canEdit,
  seo,
}: {
  product: AdminProductDetail;
  canEdit: boolean;
  /** The product's row in the SEO store; null when it has none, undefined when unread. */
  seo?: SeoOverviewRow | null | undefined;
}) {
  return (
    <SectionCard
      title="Search metadata"
      icon={Search}
      description="The title, description and share preview search engines and social networks read."
    >
      <div className="grid gap-4">
        {seo ? (
          <SeoSnippet product={product} seo={seo} />
        ) : seo === undefined ? (
          <p className="text-sm text-muted-foreground">
            <AutoText>
              The search metadata could not be read right now. Open the editor to see it.
            </AutoText>
          </p>
        ) : null}
        <Link
          href={productSeoPath(product.id)}
          className={buttonClasses({ variant: 'outline', className: `w-full rounded-xl ${TOUCH}` })}
        >
          {canEdit ? 'Edit search metadata' : 'View search metadata'}
        </Link>
      </div>
    </SectionCard>
  );
}

export interface ProductBrandData {
  brands: readonly AdminBrand[];
  brandId: string | null;
}

function BrandSection({
  productId,
  brand,
  canPublish: canChange,
  csrf,
}: {
  productId: string;
  brand: ProductBrandData;
  canPublish: boolean;
  csrf: CsrfInput;
}) {
  return (
    <SectionCard title="Brand" icon={BadgeCheck}>
      {canChange ? (
        <ProductBrandForm
          productId={productId}
          currentBrandId={brand.brandId}
          brands={brand.brands}
          csrf={csrf}
        />
      ) : (
        <p className="text-sm text-body">
          {brand.brands.find((candidate) => candidate.id === brand.brandId)?.name ?? 'No brand'}
        </p>
      )}
    </SectionCard>
  );
}

export interface ProductZoneData {
  zones: readonly AdminShoppingZone[];
  /** Zones pinned to this product. */
  mine: readonly string[];
  /** Zones of the product's category. */
  inherited: readonly string[];
}

export interface ProductDetailViewProps {
  product: AdminProductDetail;
  /** The latest review's moderator, when the account may see it. */
  reviewer?: AccountRef | null;
  canOpenReview?: boolean;
  categories: readonly AdminCategory[] | null;
  movements: { kind: 'ok'; value: InventoryMovementListResponse } | { kind: ReadFailure };
  abilities: ProductAbilities;
  csrf: CsrfInput;
  notice?: string | undefined;
  /** The product's variants; null when they could not be read, undefined to leave them out. */
  variants?: readonly AdminVariant[] | null;
  /** The brand list and the product's brand, when both could be read. */
  brand?: ProductBrandData | null;
  /** The zone panel: every zone, plus what this product pins and inherits. */
  zones?: ProductZoneData | null;
  /** The product's videos; null when they could not be read, undefined to leave them out. */
  videos?: readonly ProductVideo[] | null;
  /** The product's search metadata row; null when it has none, undefined when unread. */
  seo?: SeoOverviewRow | null;
}

/**
 * One product as one form: basic info, media, pricing, inventory, size chart and
 * merchandising on the left; visibility, review, variants, search metadata and brand on
 * the right. Sections the account may not change now are shown read-only with the reason.
 */
export function ProductDetailView({
  product,
  reviewer = null,
  canOpenReview = false,
  categories,
  movements,
  abilities,
  csrf,
  notice,
  variants,
  brand,
  videos,
  seo,
  zones = null,
}: ProductDetailViewProps) {
  const sections = editableSections(product, abilities, categories !== null);
  const operations = sections.includes('pricing');
  const operationsNote = abilities.edit ? LIVE_OPERATIONS : NO_EDIT;
  const hasSizeChart = product.sizeChart !== undefined;
  const nav: ProductAnchor[] = [
    'basic',
    'media',
    'pricing',
    'inventory',
    ...(hasSizeChart ? (['sizeChart'] as const) : []),
    'merchandising',
    'preview',
    'status',
    'review',
    'variants',
    'seo',
    ...(brand ? (['brand'] as const) : []),
    ...(zones ? (['zones'] as const) : []),
  ];
  const saved = savedProductValues(product);
  return (
    <ProductForm mode="edit" productId={product.id} sections={sections} saved={saved} csrf={csrf}>
      <PageToolbar
        back={{ href: '/admin/products', label: 'Products' }}
        title={
          <span className="flex items-center gap-3">
            <ProductTile categorySlug={product.category.slug} image={product.image} size="md" />
            <span className="min-w-0">
              <AutoText value={product.name} />
            </span>
          </span>
        }
        eyebrow={
          <>
            <ProductStatusBadge status={product.status} />
            <ModerationStatusBadge status={product.moderationStatus} />
            <StockBadge quantity={product.stockQuantity} />
          </>
        }
        meta={
          <>
            <span className="font-mono text-xs">
              <AutoText value={product.sku} />
            </span>
            <span>
              <AutoText value={product.category.name} />
            </span>
            <span>
              Updated <DateTimeText value={product.updatedAt} style="datetime" />
            </span>
          </>
        }
        actions={<ProductShare product={product} />}
      />
      <SuccessNotice>
        <AutoText value={notice} />
      </SuccessNotice>
      <ProductSectionNav sections={nav} />

      <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
        <div className="nz-stagger grid min-w-0 gap-6 lg:col-span-2">
          <Anchored id="basic">
            <BasicInfoSection
              product={product}
              categories={categories}
              abilities={abilities}
              editable={sections.includes('content')}
            />
          </Anchored>
          <Anchored id="media">
            <MediaSection product={product} abilities={abilities} csrf={csrf} videos={videos} />
          </Anchored>
          <Anchored id="pricing">
            <PricingSection product={product} operations={operations} note={operationsNote} />
          </Anchored>
          <Anchored id="inventory">
            <InventorySection
              product={product}
              movements={movements}
              abilities={abilities}
              operations={operations}
              csrf={csrf}
              variants={variants}
            />
          </Anchored>
          {hasSizeChart ? (
            <Anchored id="sizeChart">
              <SizeChartSection
                product={product}
                editable={sections.includes('content')}
                abilities={abilities}
              />
            </Anchored>
          ) : null}
          <Anchored id="merchandising">
            <MerchandisingSection product={product} operations={operations} note={operationsNote} />
          </Anchored>
          <Anchored id="preview">
            <ProductPreview
              coverUrl={product.images[0]?.thumbUrl ?? null}
              saved={{
                name: product.name,
                summary: product.summary ?? '',
                price: saved.price ?? '',
                compareAtPrice: saved.compareAtPrice ?? '',
                category: product.category.name,
                isFeatured: product.isFeatured,
              }}
              facts={{
                stockQuantity: product.stockQuantity,
                variantCount: variants?.filter((variant) => variant.isActive).length ?? 0,
                hasSizeChart: (product.sizeChart?.columns.length ?? 0) > 0,
              }}
            />
          </Anchored>
        </div>

        <div className="nz-stagger grid min-w-0 gap-6">
          <LaunchChecklist items={launchChecklist(product, variants, seo)} />
          <Anchored id="status">
            <PublishingSection product={product} abilities={abilities} csrf={csrf} />
          </Anchored>
          <Anchored id="review">
            <ReviewSection
              product={product}
              reviewer={reviewer}
              canOpenReview={canOpenReview}
              abilities={abilities}
              csrf={csrf}
            />
          </Anchored>
          <div id={PRODUCT_ANCHORS.variants} className="min-w-0 scroll-mt-24">
            {variants === undefined ? (
              <SectionCard title="Variants" icon={Shapes}>
                <Link
                  href={`/admin/products/${product.id}/variants` as Route}
                  className={buttonClasses({
                    variant: 'outline',
                    className: `w-full rounded-xl ${TOUCH}`,
                  })}
                >
                  {abilities.edit ? 'Manage variants' : 'View variants'}
                </Link>
              </SectionCard>
            ) : (
              <VariantsSection product={product} variants={variants} canEdit={abilities.edit} />
            )}
          </div>
          <Anchored id="seo">
            <SeoSection product={product} canEdit={abilities.edit} seo={seo} />
          </Anchored>
          {brand ? (
            <Anchored id="brand">
              <BrandSection
                productId={product.id}
                brand={brand}
                canPublish={abilities.publish}
                csrf={csrf}
              />
            </Anchored>
          ) : null}
          {zones ? (
            <Anchored id="zones">
              <SectionCard
                title="Shopping zones"
                icon={Layers}
                description="The collections this product is browsed under. A product with zones of its own ignores its category’s."
              >
                <ProductZoneForm
                  productId={product.id}
                  zones={zones.zones}
                  mine={zones.mine}
                  inherited={zones.inherited}
                  csrf={csrf}
                />
              </SectionCard>
            </Anchored>
          ) : null}
          <SectionCard title="Record" icon={Info}>
            <DetailList
              columns={1}
              items={[
                { label: 'Created', value: formatDateTime(product.createdAt) },
                {
                  label: 'Published',
                  value: product.publishedAt ? formatDateTime(product.publishedAt) : null,
                },
                { label: 'Last changed', value: formatDateTime(product.updatedAt) },
              ]}
            />
          </SectionCard>
        </div>
      </div>
    </ProductForm>
  );
}
