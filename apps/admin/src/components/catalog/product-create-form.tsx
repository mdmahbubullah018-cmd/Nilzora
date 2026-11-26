'use client';

import { ProductPreview } from './product-preview';
import type { AdminCategory } from '@nilzora/contracts';
import { Boxes, FileText, Images, Rocket, Ruler, Shapes, Sparkles, Tag } from 'lucide-react';
import { SectionCard } from '@/components/admin-kit/section-card';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { ViewOnly } from './catalog-ui';
import type { FormValues } from './form-values';
import {
  BasicInfoFields,
  MerchandisingFields,
  OrderLimitField,
  PricingFields,
  ProductForm,
  SizeChartField,
  StockKeepingFields,
} from './product-editor';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/** What a new product starts with. */
export const NEW_PRODUCT_VALUES: FormValues = {
  categoryId: '',
  slug: '',
  name: '',
  summary: '',
  description: '',
  price: '',
  compareAtPrice: '',
  maxOrderQuantity: '10',
  isFeatured: '',
  sku: '',
  initialStock: '0',
  tags: '',
  sizeChart: '',
};

/**
 * Creates a draft product, in the same sections as the product page. Pictures, variants
 * and search metadata belong to a saved product, so their sections say where they come
 * once the draft exists.
 */
export function ProductCreateForm({
  csrf,
  categories,
}: {
  csrf: CsrfInput;
  categories: readonly AdminCategory[];
}) {
  const tx = useTx();
  return (
    <ProductForm
      mode="create"
      saved={NEW_PRODUCT_VALUES}
      csrf={csrf}
      note="The product is saved as a draft and stays hidden from shoppers."
    >
      <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
        <div className="nz-stagger grid min-w-0 gap-6 lg:col-span-2">
          <SectionCard
            title={tx("Basic info")}
            icon={FileText}
            description={tx("What shoppers read. A moderator reviews it before the product can go on sale.")}
          >
            <BasicInfoFields categories={categories} />
          </SectionCard>
          <SectionCard
            title={tx("Media")}
            icon={Images}
            description={tx("Pictures are added to a saved product.")}
          >
            <ViewOnly>
              Create the draft first; its page then takes up to 8 pictures, with cropping and a
              cover of your choice.
            </ViewOnly>
          </SectionCard>
          <SectionCard
            title={tx("Pricing")}
            icon={Tag}
            description={tx("In Bangladeshi taka (BDT). It can be changed later, also while the product is on sale.")}
          >
            <PricingFields />
          </SectionCard>
          <SectionCard
            title={tx("Inventory")}
            icon={Boxes}
            description={tx("The SKU cannot be changed later. Stock changes afterwards are recorded with a reason.")}
          >
            <div className="grid gap-5">
              <StockKeepingFields />
              <div className="sm:max-w-[calc(50%-0.625rem)]">
                <OrderLimitField />
              </div>
            </div>
          </SectionCard>
          <SectionCard
            title={tx("Size chart")}
            icon={Ruler}
            description={tx("Measurements shoppers compare before choosing a size. Reviewed with the content.")}
          >
            <SizeChartField />
          </SectionCard>
        </div>
        <div className="nz-stagger grid min-w-0 gap-6">
          <ProductPreview coverUrl={null} />
          <SectionCard title={tx("Visibility & status")} icon={Rocket}>
            <ViewOnly>
              New products are drafts, hidden from shoppers. Submit the content for review from the
              product page; it can be published once a moderator approves it.
            </ViewOnly>
          </SectionCard>
          <SectionCard
            title={tx("Merchandising")}
            icon={Sparkles}
            description={tx("Home page featuring, and tags staff use to group products.")}
          >
            <MerchandisingFields showTags />
          </SectionCard>
          <SectionCard
            title={tx("Variants")}
            icon={Shapes}
            description={tx("Sizes, colours and other options, each with its own SKU, price and stock.")}
          >
            <div className="grid gap-3">
              <ViewOnly><AutoText>Variants belong to a saved product: create the draft, then open its variants page.</AutoText></ViewOnly>
              <ol className="grid list-decimal gap-1.5 pl-5 text-sm text-body marker:text-muted-foreground">
                <li><AutoText>Create the draft with its price and stock.</AutoText></li>
                <li><AutoText>Add pictures (the first is the cover) and a video if you have one.</AutoText></li>
                <li><AutoText>Add variants, such as sizes or colours, each with its own SKU and stock.</AutoText></li>
                <li><AutoText>Write the search title and description.</AutoText></li>
                <li><AutoText>Submit the content for review; publish once it is approved.</AutoText></li>
              </ol>
            </div>
          </SectionCard>
        </div>
      </div>
    </ProductForm>
  );
}
