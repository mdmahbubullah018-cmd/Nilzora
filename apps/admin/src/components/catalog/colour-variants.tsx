'use client';

import type {
  AdminAttribute,
  AdminProductDetail,
  AdminVariant,
} from '@nilzora/contracts';
import { cn, Field, Input } from '@nilzora/ui';
import { ImagePlus, Layers, Palette, Plus } from 'lucide-react';
import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { Chip } from '@/components/admin-kit/chip';
import { SectionCard } from '@/components/admin-kit/section-card';
import { StockBadge } from '@/components/admin-kit/status-badge';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { MediaKeyField } from '@/components/media/media-key-field';
import { formatCount, formatMoney } from '@/lib/format';
import { generateVariantsAction, setValuePictureAction } from '@/lib/variant-actions';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/*
 * Colours, as one card each.
 *
 * A colour on this store is not a row of its own: it is one value of the Colour attribute,
 * and every size of that colour is a variant combining the two. Choosing a colour and then
 * its sizes is the way staff actually think about it, but the flat variant list shows the
 * combinations, which makes a five-colour shirt look like twenty-five unrelated rows. These
 * cards group the same rows by colour so a picture, a size or a stock figure can be found
 * where a person would look for it. Nothing here is a second variant model: every write
 * goes through the same API calls the flat list makes.
 */

type AttributeValue = AdminAttribute['values'][number];

export interface ColourGroup {
  value: AttributeValue;
  /** The variants of this product that carry this colour, in the sizes they were created. */
  variants: AdminVariant[];
}

/** The submit button of one of the forms here; it follows the form's own pending state. */
function SubmitButton({
  label,
  icon: Icon,
  variant = 'primary',
}: {
  label: string;
  icon: typeof Plus;
  variant?: 'primary' | 'secondary' | 'outline';
}) {
  const tx = useTx();
  const { pending } = useFormStatus();
  const className =
    'inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors disabled:opacity-60 max-sm:h-11';
  const tone =
    variant === 'primary'
      ? 'bg-primary-action text-primary-action-foreground hover:bg-primary-action-hover'
      : variant === 'secondary'
        ? 'bg-surface text-foreground ring-1 ring-inset ring-border-strong hover:bg-surface-muted'
        : 'text-link hover:underline';
  return (
    <button type="submit" disabled={pending} className={cn(className, tone)}>
      {pending ? null : <Icon aria-hidden="true" className="size-4" />}
      {pending ? tx('Saving…') : <AutoText value={label} />}
    </button>
  );
}

/** A dot for a colour that has one; the colour's name is always written beside it. */
function ColourSwatch({ hex, className = 'size-4' }: { hex?: string | null; className?: string }) {
  if (!hex) return null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        className,
        'inline-block shrink-0 rounded-full border border-black/10 shadow-inner ring-1 ring-white/40',
      )}
      style={{ backgroundColor: hex }}
    />
  );
}

/** The colour attribute this product varies by, if it varies by one. */
export function colourAttributeOf(
  variants: readonly AdminVariant[],
  attributes: readonly AdminAttribute[],
): AdminAttribute | undefined {
  const owner = new Map(
    attributes.flatMap((attribute) =>
      attribute.values.map((value) => [value.id, attribute.id] as const),
    ),
  );
  const used = new Set(
    variants.flatMap((variant) =>
      variant.attributeValueIds.map((valueId) => owner.get(valueId) ?? valueId),
    ),
  );
  return attributes.find((attribute) => attribute.kind === 'color' && used.has(attribute.id));
}

/** The product's variants grouped by colour, in the attribute's own order. */
export function colourGroups(
  variants: readonly AdminVariant[],
  colour: AdminAttribute,
): ColourGroup[] {
  return colour.values
    .map((value) => ({
      value,
      // The order the admin put the sizes in, so a card reads the same every time.
      variants: variants
        .filter((variant) => variant.attributeValueIds.includes(value.id))
        .sort((a, b) => a.position - b.position || a.sku.localeCompare(b.sku)),
    }))
    .filter((group) => group.variants.length > 0);
}

/** The size (or other attribute) name a variant carries for one attribute. */
function valueNameFor(variant: AdminVariant, attribute: AdminAttribute): string | undefined {
  return attribute.values.find((value) => variant.attributeValueIds.includes(value.id))?.value;
}

function ColourCard({
  product,
  group,
  others,
  csrf,
  canEdit,
}: {
  product: AdminProductDetail;
  group: ColourGroup;
  /** The attributes a variant also names (the sizes, normally). */
  others: readonly AdminAttribute[];
  csrf: CsrfInput;
  canEdit: boolean;
}) {
  const tx = useTx();
  const [pictureState, pictureAction] = useActionState(setValuePictureAction, IDLE_STATE);
  const [addState, addAction] = useActionState(generateVariantsAction, IDLE_STATE);
  const picture = group.variants.find((variant) => variant.imageUrl !== null)?.imageUrl ?? null;
  const units = group.variants
    .filter((variant) => variant.isActive)
    .reduce((sum, variant) => sum + variant.stockQuantity, 0);
  const soldOut = group.variants.filter((variant) => variant.stockQuantity === 0).length;
  const hidden = group.variants.filter((variant) => !variant.isActive).length;
  const sizes = others.flatMap((attribute) => attribute.values);
  const usedValueIds = new Set(group.variants.flatMap((variant) => variant.attributeValueIds));
  const missing = sizes.filter((value) => !usedValueIds.has(value.id));
  const name = group.value.value;

  return (
    <li className="nz-panel-strong grid gap-4 rounded-2xl border border-hairline p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl border border-hairline bg-surface-muted">
            {picture === null ? (
              <ColourSwatch hex={group.value.swatchHex} className="size-6" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- a variant picture thumbnail
              <img src={picture} alt="" className="size-full object-cover" />
            )}
          </span>
          <div className="grid min-w-0 gap-1">
            <p className="flex items-center gap-2 font-medium wrap-break-word text-foreground">
              <ColourSwatch hex={group.value.swatchHex} />
              {name}
            </p>
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>
                {formatCount(group.variants.length)} size
                {group.variants.length === 1 ? '' : 's'}
              </span>
              <span aria-hidden="true">·</span>
              <span>{formatCount(units)} on sale in total</span>
              {soldOut > 0 ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{formatCount(soldOut)} sold out</span>
                </>
              ) : null}
              {hidden > 0 ? <Chip tone="neutral">{formatCount(hidden)} hidden</Chip> : null}
              {picture === null ? <Chip tone="warning"><AutoText>No picture</AutoText></Chip> : null}
            </p>
          </div>
        </div>
      </div>

      <ul aria-label={`Sizes in ${name}`} className="grid gap-2">
        {group.variants.map((variant) => {
          const size = others
            .map((attribute) => valueNameFor(variant, attribute))
            .filter((value): value is string => value !== undefined)
            .join(' / ');
          return (
            <li
              key={variant.id}
              className={cn(
                'flex flex-wrap items-center justify-between gap-2 rounded-xl border border-hairline bg-surface px-3 py-2 text-sm',
                !variant.isActive && 'opacity-70',
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="font-medium text-foreground">{size === '' ? 'One size' : size}</span>
                <span className="font-mono text-xs text-muted-foreground"><AutoText value={variant.sku} /></span>
              </span>
              <span className="flex flex-wrap items-center gap-2 tabular-nums">
                <span className="text-muted-foreground">
                  {formatMoney(variant.priceMinor ?? product.priceMinor)}
                </span>
                <span className="text-muted-foreground">
                  {formatCount(variant.stockQuantity)} in stock
                </span>
                <StockBadge quantity={variant.stockQuantity} />
                {variant.isActive ? null : <Chip tone="neutral"><AutoText>Hidden</AutoText></Chip>}
              </span>
            </li>
          );
        })}
      </ul>

      {canEdit ? (
        <div className="grid gap-4 border-t border-hairline pt-4 sm:grid-cols-2">
          <form action={pictureAction} className="grid gap-2">
            <CsrfField csrf={csrf} />
            <input type="hidden" name="productId" value={product.id} />
            <input type="hidden" name="attributeValueId" value={group.value.id} />
            <MediaKeyField
              valueKind="url"
              name="imageUrl"
              label={`Picture for ${name}`}
              hint={tx("Shown on every size of this colour, and on the product page when a shopper picks it.")}
              defaultValue={picture}
              previewUrl={picture}
              csrf={csrf}
              maxLength={500}
            />
            <ActionFeedback state={pictureState} inline />
            <div>
              <SubmitButton label={tx("Use on every size")} icon={ImagePlus} variant="outline" />
            </div>
          </form>

          {missing.length === 0 ? (
            <p className="flex items-center gap-2 self-start text-sm text-muted-foreground">
              <Layers aria-hidden="true" className="size-4" />
              Every size is already sold in {name}.
            </p>
          ) : (
            <form action={addAction} className="grid gap-2">
              <CsrfField csrf={csrf} />
              <input type="hidden" name="productId" value={product.id} />
              <input type="hidden" name="generateValueIds" value={group.value.id} />
              <input
                type="hidden"
                name="skuPrefix"
                value={`${product.sku}-${group.value.slug}`.toUpperCase()}
              />
              <fieldset className="grid gap-2">
                <legend className="text-sm font-medium text-foreground">
                  Sizes still missing in {name}
                </legend>
                <div className="flex flex-wrap gap-2">
                  {missing.map((value) => (
                    <label
                      key={value.id}
                      className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-hairline px-3 text-sm has-checked:border-primary has-checked:bg-info-soft max-sm:min-h-11"
                    >
                      <input
                        type="checkbox"
                        name="generateValueIds"
                        value={value.id}
                        className="size-4 accent-primary-action"
                      />
                      {value.value}
                    </label>
                  ))}
                </div>
              </fieldset>
              <ActionFeedback state={addState} inline />
              <div>
                <SubmitButton label={tx("Add these sizes")} icon={Plus} variant="secondary" />
              </div>
            </form>
          )}
        </div>
      ) : null}
    </li>
  );
}

/** Which new colour and which of its sizes to create in one go. */
function AddColourForm({
  product,
  colour,
  attributes,
  csrf,
}: {
  product: AdminProductDetail;
  colour: AdminAttribute;
  /** The attributes a variant must also name — the sizes, normally. */
  attributes: readonly AdminAttribute[];
  csrf: CsrfInput;
}) {
  const tx = useTx();
  const [state, action] = useActionState(generateVariantsAction, IDLE_STATE);

  return (
    <SectionCard
      title={tx("Add a colour")}
      icon={Palette}
      description={tx("Pick a colour and tick the sizes it is sold in. Each combination becomes a variant with the product price and no stock; set the price, stock and picture from the colour's card below.")}
      className="nz-panel-strong"
    >
      <form action={action} className="grid gap-4">
        <CsrfField csrf={csrf} />
        <input type="hidden" name="productId" value={product.id} />
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium text-foreground"><AutoText>Colour</AutoText></legend>
          <div className="flex flex-wrap gap-2">
            {colour.values.map((value) => (
              <label
                key={value.id}
                className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-hairline px-3 text-sm has-checked:border-primary has-checked:bg-info-soft max-sm:min-h-11"
              >
                <input
                  type="radio"
                  name="generateValueIds"
                  value={value.id}
                  className="size-4 accent-primary-action"
                />
                <ColourSwatch hex={value.swatchHex} />
                {value.value}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            A colour that is not listed yet is added on{' '}
            <Link
              href="/admin/attributes"
              className="rounded-sm font-semibold text-link underline-offset-4 hover:underline"
            ><AutoText>Attributes &amp; variants</AutoText></Link><AutoText>, together with its swatch.</AutoText></p>
        </fieldset>

        {attributes.map((attribute) => (
          <fieldset key={attribute.id} className="grid gap-2">
            <legend className="text-sm font-medium text-foreground">
              {attribute.name}s to sell in this colour
            </legend>
            <div className="flex flex-wrap gap-2">
              {attribute.values.map((value) => (
                <label
                  key={value.id}
                  className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-hairline px-3 text-sm has-checked:border-primary has-checked:bg-info-soft max-sm:min-h-11"
                >
                  <input
                    type="checkbox"
                    name="generateValueIds"
                    value={value.id}
                    className="size-4 accent-primary-action"
                  />
                  {value.value}
                </label>
              ))}
            </div>
          </fieldset>
        ))}

        <Field
          id="colour-sku"
          label={tx("SKU start")}
          hint={tx("Each variant's SKU is this plus its colour and size, e.g. TSHIRT-NAVY-M.")}
        >
          {(control) => (
            <Input
              {...control}
              name="skuPrefix"
              defaultValue={product.sku}
              className="max-w-xs uppercase max-sm:h-11"
            />
          )}
        </Field>
        <ActionFeedback state={state} />
        <div>
          <SubmitButton label={tx("Add the colour")} icon={Plus} />
        </div>
      </form>
    </SectionCard>
  );
}

export function ColourVariants({
  product,
  variants,
  attributes,
  csrf,
  canEdit,
}: {
  product: AdminProductDetail;
  variants: AdminVariant[];
  attributes: AdminAttribute[];
  csrf: CsrfInput;
  canEdit: boolean;
}) {
  const tx = useTx();
  const colour = colourAttributeOf(variants, attributes);
  if (!colour) return null;
  const groups = colourGroups(variants, colour);
  const others = attributes.filter(
    (attribute) =>
      attribute.id !== colour.id &&
      attribute.values.some((value) =>
        variants.some((variant) => variant.attributeValueIds.includes(value.id)),
      ),
  );

  return (
    <div className="grid gap-6">
      <SectionCard
        title={tx("Colours")}
        icon={Palette}
        description={`Each card is one ${colour.name.toLowerCase()}: its picture, its sizes and its stock. The detailed list further down edits one size at a time.`}
      >
        <ul aria-label={tx("Colours")} className="grid gap-4">
          {groups.map((group) => (
            <ColourCard
              key={group.value.id}
              product={product}
              group={group}
              others={others}
              csrf={csrf}
              canEdit={canEdit}
            />
          ))}
        </ul>
      </SectionCard>

      {canEdit ? (
        <AddColourForm product={product} colour={colour} attributes={others} csrf={csrf} />
      ) : null}
    </div>
  );
}
