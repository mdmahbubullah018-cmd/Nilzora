'use client';

import type { ProductDetail, SizeChart } from '@nilzora/contracts';
import { Dialog } from '@nilzora/ui';
import { Ruler } from 'lucide-react';
import { useMemo, useState } from 'react';
import { SizeChartTable } from '@/components/product/size-chart';
import { AddToCartForm } from '@/components/catalog/add-to-cart-form';
import { AvailabilityBadge } from '@/components/catalog/availability';
import { Price } from '@/components/catalog/price';
import { CampaignLabel } from '@/components/marketing/campaign-highlights';
import type { FormAction } from '../auth/form-kit';
import { useVariantImageHandle } from './variant-image-context';
import { VariantOptions } from './variant-options';
import {
  attributeGroups,
  choosePrompt,
  initialSelection,
  valueOf,
  variantFor,
} from './variant-selection';

/*
 * Choosing a product's options and adding it to the cart.
 *
 * The variants come from the API with their price, stock band and order limit already
 * resolved, so nothing here calculates money or stock: it only works out which variant a
 * set of choices names (see variant-selection.ts, shared with the quick-add sheet). A product
 * without variants renders exactly as it always has.
 */

export interface ProductPurchaseProps {
  product: ProductDetail;
  action: FormAction;
  /** Where the product's size guide is on the page, when it has one. */
  /** The product's size chart, opened in a bottom sheet from the "Size guide" button. */
  sizeChart?: SizeChart | undefined;
}

/**
 * The "Size guide" button. It opens the chart in a bottom sheet over the page (the shared native
 * <dialog>: focus stays inside, Escape closes it, focus returns here) instead of jumping to
 * another part of the page.
 */
function SizeGuideLink({ chart, productName }: { chart: SizeChart; productName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
        }}
        className="inline-flex min-h-11 w-fit cursor-pointer items-center gap-1.5 rounded-sm text-sm font-semibold text-link underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Ruler aria-hidden="true" className="size-4" />
        Size guide
      </button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Size guide"
        description={`Compare these measurements for ${productName} before you choose a size.`}
        side="bottom"
      >
        <SizeChartTable chart={chart} productName={productName} idPrefix="size-guide-sheet" />
      </Dialog>
    </>
  );
}

export function ProductPurchase({ product, action, sizeChart }: ProductPurchaseProps) {
  const variants = product.variants;
  const groups = useMemo(() => attributeGroups(variants), [variants]);
  const gallery = useVariantImageHandle();
  // A product with a single option is already chosen for the customer.
  const [selected, setSelected] = useState<Record<string, string>>(() =>
    initialSelection(variants),
  );

  const chosen = variants.length > 0 ? variantFor(variants, groups, selected) : undefined;
  const priced = chosen;
  const availability = priced?.availability ?? product.availability;
  const sku = priced?.sku ?? product.sku;
  const limit = variants.length
    ? availability === 'out_of_stock'
      ? 0
      : (priced?.maxOrderQuantity ?? 0)
    : product.availability === 'out_of_stock'
      ? 0
      : product.maxOrderQuantity;
  const needsChoice = variants.length > 0 && chosen === undefined;
  const complete = groups.length > 0 && groups.every((group) => selected[group.slug] !== undefined);

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <Price
          priceMinor={priced?.priceMinor ?? product.priceMinor}
          compareAtPriceMinor={priced ? priced.compareAtPriceMinor : product.compareAtPriceMinor}
          size="lg"
          showSaving
        />
        <div className="flex flex-wrap items-center gap-3">
          <AvailabilityBadge availability={availability} />
          <p className="text-xs text-muted-foreground">
            <span className="sr-only">Product code: </span>
            <span aria-hidden="true">SKU </span>
            {sku}
          </p>
        </div>
        {product.campaign ? <CampaignLabel campaign={product.campaign} /> : null}
      </div>

      {groups.length > 0 ? (
        <VariantOptions
          variants={variants}
          groups={groups}
          selected={selected}
          onSelect={(next, group, valueSlug) => {
            setSelected(next);
            // The picture the customer expects to see: the exact combination when it
            // is complete, otherwise the first picture of the chosen colour.
            const match =
              variantFor(variants, groups, next) ??
              variants.find(
                (variant) =>
                  valueOf(variant, group.slug) === valueSlug && variant.imageUrl !== null,
              );
            gallery?.setImage(
              match?.imageUrl
                ? {
                    url: match.imageUrl,
                    label: match.options.map((option) => option.value).join(' / '),
                  }
                : null,
            );
          }}
        >
          {sizeChart ? <SizeGuideLink chart={sizeChart} productName={product.name} /> : null}
        </VariantOptions>
      ) : sizeChart ? (
        <SizeGuideLink chart={sizeChart} productName={product.name} />
      ) : null}

      <AddToCartForm
        // A new selection starts the quantity again and drops a stale result message.
        key={chosen?.id ?? 'simple'}
        action={action}
        productId={product.id}
        productSlug={product.slug}
        variantId={chosen?.id}
        maxOrderQuantity={needsChoice ? 0 : limit}
        blockedMessage={
          needsChoice
            ? complete
              ? 'This combination is not sold. Choose another option.'
              : choosePrompt(groups, selected)
            : undefined
        }
      />
    </div>
  );
}
