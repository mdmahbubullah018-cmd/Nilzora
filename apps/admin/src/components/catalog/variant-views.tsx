'use client';

import type { AdminAttribute, AdminProductDetail, AdminVariant } from '@nilzora/contracts';
import { Button, cn, Field, Input, NativeSelect } from '@nilzora/ui';
import {
  Check,
  ImageOff,
  Layers,
  ListPlus,
  Pencil,
  Plus,
  Save,
  Shapes,
  Trash2,
  Wand2,
} from 'lucide-react';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import type { ActionState } from '@/components/admin-kit/act';
import { Chip } from '@/components/admin-kit/chip';
import { ConfirmForm } from '@/components/admin-kit/confirm-form';
import { SectionCard } from '@/components/admin-kit/section-card';
import { StockBadge } from '@/components/admin-kit/status-badge';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { MediaKeyField } from '@/components/media/media-key-field';
import { formatCount, formatMoney } from '@/lib/format';
import {
  adjustVariantStockAction,
  bulkVariantStockAction,
  deleteVariantAction,
  generateVariantsAction,
  saveAttributeAction,
  saveAttributeValueAction,
  saveVariantAction,
  setVariantActiveAction,
} from '@/lib/variant-actions';
import { EmptyPanel, TOUCH, ViewOnly } from './catalog-ui';
import { ColourVariants } from './colour-variants';
import { poishaToTaka } from './form-values';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/*
 * Attributes (Size, Colour…) and one product's variants. The attribute values carry a
 * name only (the contract has no colour field), so options are shown by name; the
 * database is the authority on SKUs, combinations, prices, stock and permissions.
 *
 * Every variant of one product names the same attributes (the database refuses anything
 * else, because shoppers choose one value per attribute): once a product has variants,
 * the forms here offer exactly those attributes.
 */

function SubmitButton({
  label,
  icon: Icon = Save,
  variant = 'primary',
  size,
}: {
  label: string;
  icon?: typeof Save;
  variant?: 'primary' | 'outline' | 'secondary' | 'ghost';
  size?: 'sm';
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} loading={pending} className={TOUCH}>
      {pending ? null : <Icon aria-hidden="true" strokeWidth={1.75} />}
      {label}
    </Button>
  );
}

function errorsOf(state: ActionState) {
  return state.status === 'error' ? (state.fieldErrors ?? {}) : {};
}

const ADDRESS_HINT = 'Optional: made from the name. Lower-case words, e.g. size.';

// ---------------------------------------------------------------------------
// Attributes
// ---------------------------------------------------------------------------

/** Name, address, position and availability of an attribute, new or existing. */
function AttributeFields({
  idPrefix,
  attribute,
  errors,
  defaultPosition = 0,
}: {
  idPrefix: string;
  attribute?: AdminAttribute;
  errors: Partial<Record<string, string>>;
  /** The order a new attribute starts with: after the existing ones, so labels read the same everywhere. */
  defaultPosition?: number;
}) {
  const tx = useTx();
  return (
    <>
      <Field id={`${idPrefix}-name`} label={tx('Name')} error={errors.name} required>
        {(control) => (
          <Input
            {...control}
            name="name"
            maxLength={40}
            defaultValue={attribute?.name}
            className="max-sm:h-11"
          />
        )}
      </Field>
      <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_7rem]">
        <Field
          id={`${idPrefix}-slug`}
          label={tx('Address')}
          hint={attribute ? 'Lower-case words, e.g. size' : ADDRESS_HINT}
          error={errors.slug}
          required={attribute !== undefined}
        >
          {(control) => (
            <Input
              {...control}
              name="slug"
              maxLength={40}
              autoCapitalize="none"
              spellCheck={false}
              defaultValue={attribute?.slug}
              className="font-mono max-sm:h-11"
            />
          )}
        </Field>
        <Field
          id={`${idPrefix}-position`}
          label={tx('Order')}
          hint={tx('0 comes first')}
          error={errors.position}
        >
          {(control) => (
            <Input
              {...control}
              name="position"
              inputMode="numeric"
              defaultValue={String(attribute?.position ?? defaultPosition)}
              className="tabular-nums max-sm:h-11"
            />
          )}
        </Field>
      </div>
      <Field
        id={`${idPrefix}-kind`}
        label={tx('What it is')}
        hint={tx(
          'A colour shows as a swatch on the storefront and the app; a size shows as a chip.',
        )}
        error={errors.kind}
      >
        {(control) => (
          <select
            {...control}
            name="kind"
            defaultValue={attribute?.kind ?? 'other'}
            className="h-11 rounded-xl border border-input-border bg-surface px-3 text-sm text-foreground"
          >
            <option value="color">
              <AutoText>Colour</AutoText>
            </option>
            <option value="size">
              <AutoText>Size</AutoText>
            </option>
            <option value="other">
              <AutoText>Something else</AutoText>
            </option>
          </select>
        )}
      </Field>
      <label className="flex min-h-11 items-center gap-2.5 text-sm text-foreground">
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={attribute?.isActive ?? true}
          className="size-5 accent-primary-action"
        />
        <AutoText>Available for new variants</AutoText>
      </label>
    </>
  );
}

function AttributeEditForm({ attribute, csrf }: { attribute: AdminAttribute; csrf: CsrfInput }) {
  const tx = useTx();
  const [state, action] = useActionState(saveAttributeAction, IDLE_STATE);
  return (
    <details
      className="group rounded-xl border border-hairline"
      open={state.status === 'error' || undefined}
    >
      <summary
        className={`flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden ${TOUCH}`}
      >
        <Pencil aria-hidden="true" className="size-4" strokeWidth={1.75} />
        Edit attribute{' '}
        <span className="sr-only">
          <AutoText value={attribute.name} />
        </span>
      </summary>
      <form action={action} className="grid gap-4 border-t border-hairline p-3">
        <CsrfField csrf={csrf} />
        <input type="hidden" name="attributeId" value={attribute.id} />
        <AttributeFields
          idPrefix={`attribute-${attribute.id}`}
          attribute={attribute}
          errors={errorsOf(state)}
        />
        <ActionFeedback state={state} />
        <div>
          <SubmitButton label={tx('Save attribute')} variant="outline" />
        </div>
      </form>
    </details>
  );
}

/** A colour dot for a value that has one; nothing for a size or an unset swatch. */
export function SwatchDot({
  hex,
  className = 'size-3.5',
}: {
  hex: string | null | undefined;
  className?: string;
}) {
  if (!hex) return null;
  return (
    <span
      aria-hidden="true"
      className={`${className} inline-block shrink-0 rounded-full border border-black/10 shadow-inner ring-1 ring-white/40`}
      style={{ backgroundColor: hex }}
    />
  );
}

/** One value as a chip; with edit rights, the chip opens a small form to rename or reorder it. */
function ValueChip({
  attribute,
  value,
  csrf,
  canEdit,
}: {
  attribute: AdminAttribute;
  value: AdminAttribute['values'][number];
  csrf: CsrfInput;
  canEdit: boolean;
}) {
  const tx = useTx();
  const [state, action] = useActionState(saveAttributeValueAction, IDLE_STATE);
  const errors = errorsOf(state);
  if (!canEdit)
    return (
      <Chip tone="neutral">
        <span className="inline-flex items-center gap-1.5">
          <SwatchDot hex={value.swatchHex} />
          {value.value}
        </span>
      </Chip>
    );
  const prefix = `value-${value.id}`;
  return (
    <details className="group relative" open={state.status === 'error' || undefined}>
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-full border border-hairline bg-surface px-3 text-sm text-foreground transition-colors group-open:border-primary hover:border-primary max-sm:min-h-11 [&::-webkit-details-marker]:hidden">
        <SwatchDot hex={value.swatchHex} />
        {value.value}
        <Pencil aria-hidden="true" className="size-3 text-muted-foreground" strokeWidth={1.75} />
        <span className="sr-only">: edit this {attribute.name.toLowerCase()} value</span>
      </summary>
      <form
        action={action}
        className="nz-glass absolute top-full left-0 z-20 mt-2 grid w-72 max-w-[calc(100vw-3rem)] gap-3 rounded-xl border p-3 shadow-glass-lg"
      >
        <CsrfField csrf={csrf} />
        <input type="hidden" name="attributeId" value={attribute.id} />
        <input type="hidden" name="valueId" value={value.id} />
        <Field id={`${prefix}-value`} label={tx('Value')} error={errors.value} required>
          {(control) => (
            <Input {...control} name="value" maxLength={40} defaultValue={value.value} />
          )}
        </Field>
        <div className="grid grid-cols-[minmax(0,1fr)_5rem] items-start gap-3">
          <Field id={`${prefix}-slug`} label={tx('Address')} error={errors.valueSlug} required>
            {(control) => (
              <Input
                {...control}
                name="valueSlug"
                maxLength={40}
                autoCapitalize="none"
                spellCheck={false}
                defaultValue={value.slug}
                className="font-mono"
              />
            )}
          </Field>
          <Field id={`${prefix}-position`} label={tx('Order')} error={errors.position}>
            {(control) => (
              <Input
                {...control}
                name="position"
                inputMode="numeric"
                defaultValue={String(value.position)}
                className="tabular-nums"
              />
            )}
          </Field>
        </div>
        {attribute.kind === 'color' ? (
          <Field
            id={`${prefix}-swatch`}
            label={tx('Swatch')}
            hint={tx('Shown to customers beside the name')}
            error={errors.swatchHex}
          >
            {(control) => (
              <div className="flex items-center gap-2">
                <input
                  id={control.id}
                  aria-describedby={control['aria-describedby']}
                  type="color"
                  name="swatchHex"
                  defaultValue={value.swatchHex ?? '#0284C7'}
                  className="h-10 w-14 cursor-pointer rounded-lg border border-input-border bg-surface p-1"
                />
                <span className="font-mono text-xs text-muted-foreground">
                  {value.swatchHex ?? 'no swatch yet'}
                </span>
              </div>
            )}
          </Field>
        ) : null}
        <ActionFeedback state={state} inline />
        <div>
          <SubmitButton label={tx('Save value')} variant="outline" size="sm" />
        </div>
      </form>
    </details>
  );
}

function AddValueForm({ attribute, csrf }: { attribute: AdminAttribute; csrf: CsrfInput }) {
  const tx = useTx();
  const [state, action] = useActionState(saveAttributeValueAction, IDLE_STATE);
  const errors = errorsOf(state);
  const prefix = `new-value-${attribute.id}`;
  const next = attribute.values.reduce((max, value) => Math.max(max, value.position + 1), 0);
  return (
    <form action={action} className="grid gap-2">
      <CsrfField csrf={csrf} />
      <input type="hidden" name="attributeId" value={attribute.id} />
      <input type="hidden" name="position" value={String(next)} />
      <div className="flex flex-wrap items-start gap-2">
        <Field
          id={`${prefix}-value`}
          label={`New ${attribute.name.toLowerCase()} value`}
          error={errors.value ?? errors.valueSlug}
          className="min-w-40 flex-1"
        >
          {(control) => (
            <Input
              {...control}
              name="value"
              maxLength={40}
              placeholder={tx('e.g. XL')}
              className="max-sm:h-11"
            />
          )}
        </Field>
        {attribute.kind === 'color' ? (
          <Field
            id={`${prefix}-swatch`}
            label={tx('Swatch')}
            hint={tx('Shown beside the name')}
            error={errors.swatchHex}
          >
            {(control) => (
              <input
                id={control.id}
                type="color"
                name="swatchHex"
                defaultValue="#0284C7"
                className="h-11 w-14 cursor-pointer rounded-lg border border-input-border bg-surface p-1"
              />
            )}
          </Field>
        ) : null}
        <div className="pt-6.5">
          <SubmitButton label={tx('Add value')} icon={Plus} variant="secondary" />
        </div>
      </div>
      <ActionFeedback state={state} inline />
    </form>
  );
}

function AttributeCard({
  attribute,
  csrf,
  canEdit,
}: {
  attribute: AdminAttribute;
  csrf: CsrfInput;
  canEdit: boolean;
}) {
  return (
    <li className="nz-panel-strong grid gap-3 rounded-2xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-0.5">
          <p className="font-medium text-foreground">
            <AutoText value={attribute.name} />
          </p>
          <p className="font-mono text-xs text-muted-foreground">
            {attribute.slug} · order {attribute.position}
          </p>
        </div>
        <Chip tone={attribute.isActive ? 'success' : 'neutral'} dot>
          {attribute.isActive ? 'Available' : 'Hidden'}
        </Chip>
      </div>
      {attribute.values.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <AutoText>No values yet.</AutoText>
        </p>
      ) : (
        <ul aria-label={`${attribute.name} values`} className="flex flex-wrap gap-2">
          {attribute.values.map((value) => (
            <li key={value.id}>
              <ValueChip attribute={attribute} value={value} csrf={csrf} canEdit={canEdit} />
            </li>
          ))}
        </ul>
      )}
      {canEdit ? (
        <div className="grid gap-3 border-t border-hairline pt-3">
          <AddValueForm attribute={attribute} csrf={csrf} />
          <AttributeEditForm attribute={attribute} csrf={csrf} />
        </div>
      ) : null}
    </li>
  );
}

function NewAttributeForm({ csrf, next }: { csrf: CsrfInput; next: number }) {
  const tx = useTx();
  const [state, action] = useActionState(saveAttributeAction, IDLE_STATE);
  return (
    <SectionCard
      title={tx('New attribute')}
      icon={ListPlus}
      description={tx("Then add its values, such as S, M and L, on the attribute's card.")}
      className="nz-panel-strong"
    >
      <form action={action} className="grid gap-4">
        <CsrfField csrf={csrf} />
        <AttributeFields
          idPrefix="attribute"
          attribute={undefined}
          errors={errorsOf(state)}
          defaultPosition={next}
          // A fresh form after each saved attribute, starting at the next free order.
          key={state.status === 'success' ? `${state.message ?? ''}-${String(next)}` : 'new'}
        />
        <ActionFeedback state={state} />
        <SubmitButton label={tx('Add attribute')} icon={Plus} />
      </form>
    </SectionCard>
  );
}

/**
 * Attributes and their values. Values are added and edited on their attribute's card.
 * Attributes cannot be deleted (variants and past orders refer to them); a hidden one is no
 * longer offered for new variants and is listed apart. Accounts without products.update see
 * the list only.
 */
export function AttributeManager({
  attributes,
  csrf,
  canEdit,
}: {
  attributes: AdminAttribute[];
  csrf: CsrfInput;
  canEdit: boolean;
}) {
  const tx = useTx();
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const matches = (attribute: AdminAttribute) =>
    needle === '' ||
    attribute.name.toLowerCase().includes(needle) ||
    attribute.slug.toLowerCase().includes(needle) ||
    attribute.values.some((value) => value.value.toLowerCase().includes(needle));
  const shown = attributes.filter((attribute) => attribute.isActive && matches(attribute));
  const hidden = attributes.filter((attribute) => !attribute.isActive && matches(attribute));
  const availableCount = attributes.filter((attribute) => attribute.isActive).length;
  const hiddenCount = attributes.length - availableCount;
  const next = attributes.reduce((max, attribute) => Math.max(max, attribute.position + 1), 0);
  const found = shown.length + hidden.length;

  const list = (
    <SectionCard
      title={tx('Attributes')}
      icon={Shapes}
      description={tx(
        "Reusable options such as Size or Colour. A product's variants are built from their values.",
      )}
      actions={
        attributes.length > 0 ? (
          <Chip tone="neutral">
            {formatCount(availableCount)} available
            {hiddenCount > 0 ? ` · ${formatCount(hiddenCount)} hidden` : ''}
          </Chip>
        ) : undefined
      }
    >
      {attributes.length > 1 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label htmlFor="attribute-search" className="sr-only">
            <AutoText>Search attributes</AutoText>
          </label>
          <Input
            id="attribute-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tx('Search attributes or values')}
            className="max-w-xs"
          />
          {needle === '' ? null : (
            <span className="text-xs text-muted-foreground">
              {found === 0 ? (
                <AutoText>No attribute matches</AutoText>
              ) : (
                <>
                  {formatCount(found)} <AutoText>matching</AutoText>
                </>
              )}
            </span>
          )}
        </div>
      ) : null}
      {attributes.length === 0 ? (
        <EmptyPanel
          icon={Shapes}
          title={tx('No attributes yet')}
          description={
            canEdit
              ? 'Add Size, Colour, Material or anything else your products are sold in.'
              : 'Attributes appear here once staff add them.'
          }
        />
      ) : (
        <div className="grid gap-4">
          {shown.length > 0 ? (
            <ul className="grid gap-3">
              {shown.map((attribute) => (
                <AttributeCard
                  key={attribute.id}
                  attribute={attribute}
                  csrf={csrf}
                  canEdit={canEdit}
                />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {needle === '' ? (
                <AutoText>Every attribute is hidden.</AutoText>
              ) : (
                <AutoText>No attribute matches</AutoText>
              )}
            </p>
          )}
          {hidden.length > 0 ? (
            <details className="rounded-xl border border-hairline">
              <summary
                className={`cursor-pointer px-3 py-2 text-sm font-medium text-foreground ${TOUCH}`}
              >
                Hidden attributes ({formatCount(hidden.length)})
              </summary>
              <ul className="grid gap-3 border-t border-hairline p-3">
                {hidden.map((attribute) => (
                  <AttributeCard
                    key={attribute.id}
                    attribute={attribute}
                    csrf={csrf}
                    canEdit={canEdit}
                  />
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      )}
    </SectionCard>
  );

  if (!canEdit) {
    return (
      <div className="grid gap-4">
        {list}
        <ViewOnly>
          <AutoText>
            Your account can view attributes. Adding them needs the “Edit products” permission.
          </AutoText>
        </ViewOnly>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
      {list}
      <div className="grid gap-6 max-lg:order-first lg:sticky lg:top-24">
        <NewAttributeForm csrf={csrf} next={next} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

/** The attributes the product's variants name today (all of them name the same ones). */
export function productAttributeIds(
  variants: readonly AdminVariant[],
  attributes: readonly AdminAttribute[],
): Set<string> {
  const owner = new Map(
    attributes.flatMap((attribute) =>
      attribute.values.map((value) => [value.id, attribute.id] as const),
    ),
  );
  return new Set(
    variants.flatMap((variant) =>
      variant.attributeValueIds.map((valueId) => owner.get(valueId) ?? valueId),
    ),
  );
}

/**
 * A variant's picture. A product with pictures offers them to pick from (the storefront
 * shows the chosen one when a shopper picks this combination); otherwise, or to keep a
 * picture from elsewhere, the media library field is used.
 */
function VariantPicture({
  product,
  variant,
  csrf,
  idPrefix,
}: {
  product: AdminProductDetail;
  variant?: AdminVariant;
  csrf: CsrfInput;
  idPrefix: string;
}) {
  const tx = useTx();
  const current = variant?.imageUrl ?? null;
  const own = product.images;
  const fromGallery = current === null || own.some((image) => image.url === current);
  if (own.length === 0 || !fromGallery) {
    return (
      <MediaKeyField
        // The database stores the picture's address in this column, not a library key.
        valueKind="url"
        name="imageUrl"
        label={tx('Variant picture')}
        hint={tx(
          "Optional. Shown on the product page when a customer chooses this combination; the product's own pictures are used when it is empty.",
        )}
        defaultValue={current}
        previewUrl={current}
        csrf={csrf}
        maxLength={500}
      />
    );
  }
  const option =
    'relative grid size-16 cursor-pointer place-items-center overflow-hidden rounded-xl border-2 border-hairline bg-surface-muted transition-colors has-checked:border-primary has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring max-sm:size-18';
  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium text-foreground">
        <AutoText>Variant picture</AutoText>
      </legend>
      <p id={`${idPrefix}-picture-hint`} className="text-xs text-muted-foreground">
        Optional. Shown when a customer chooses this combination; without one, the product&apos;s
        cover is shown.
      </p>
      <div
        className="flex flex-wrap gap-2"
        role="radiogroup"
        aria-describedby={`${idPrefix}-picture-hint`}
      >
        <label className={option}>
          <input
            type="radio"
            name="imageUrl"
            value=""
            defaultChecked={current === null}
            className="sr-only"
          />
          <ImageOff aria-hidden="true" className="size-5 text-muted-foreground" />
          <span className="sr-only">
            <AutoText>No picture of its own</AutoText>
          </span>
        </label>
        {own.map((image, index) => (
          <label key={image.id} className={option}>
            <input
              type="radio"
              name="imageUrl"
              value={image.url}
              defaultChecked={current === image.url}
              className="sr-only"
            />
            {/* eslint-disable-next-line @next/next/no-img-element -- a product picture thumbnail */}
            <img src={image.thumbUrl} alt="" className="size-full object-cover" />
            <span className="sr-only">
              Picture {index + 1}
              {image.alt ? `: ${image.alt}` : ''}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function VariantFields({
  idPrefix,
  product,
  variant,
  state,
}: {
  idPrefix: string;
  product: AdminProductDetail;
  variant?: AdminVariant;
  state: ActionState;
}) {
  const tx = useTx();
  const errors = errorsOf(state);
  return (
    <div className="grid items-start gap-4 sm:grid-cols-2">
      <Field
        id={`${idPrefix}-sku`}
        label={tx('SKU')}
        hint={tx('Capital letters, digits and hyphens, e.g. NZ-PANJABI-M')}
        error={errors.sku}
        required
      >
        {(control) => (
          <Input
            {...control}
            name="sku"
            maxLength={40}
            autoCapitalize="characters"
            spellCheck={false}
            defaultValue={state.status === 'error' ? state.values?.sku : variant?.sku}
            className="font-mono uppercase max-sm:h-11"
          />
        )}
      </Field>
      <Field
        id={`${idPrefix}-price`}
        label={tx('Price (BDT)')}
        hint={`Leave empty to use the product price, ${formatMoney(product.priceMinor)}`}
        error={errors.price}
      >
        {(control) => (
          <Input
            {...control}
            name="price"
            inputMode="decimal"
            defaultValue={poishaToTaka(variant?.priceMinor)}
            className="tabular-nums max-sm:h-11"
          />
        )}
      </Field>
      <Field
        id={`${idPrefix}-compare`}
        label={tx('Former price (BDT)')}
        hint={tx("Optional; needs the variant's own price, and must be higher")}
        error={errors.compareAtPrice}
      >
        {(control) => (
          <Input
            {...control}
            name="compareAtPrice"
            inputMode="decimal"
            defaultValue={poishaToTaka(variant?.compareAtPriceMinor)}
            className="tabular-nums max-sm:h-11"
          />
        )}
      </Field>
      <Field
        id={`${idPrefix}-position`}
        label={tx('Position')}
        hint={tx('Lower numbers come first')}
        error={errors.position}
      >
        {(control) => (
          <Input
            {...control}
            name="position"
            inputMode="numeric"
            defaultValue={String(variant?.position ?? 0)}
            className="tabular-nums max-sm:h-11"
          />
        )}
      </Field>
    </div>
  );
}

function VariantEditForm({
  product,
  variant,
  csrf,
}: {
  product: AdminProductDetail;
  variant: AdminVariant;
  csrf: CsrfInput;
}) {
  const tx = useTx();
  const [state, action] = useActionState(saveVariantAction, IDLE_STATE);
  return (
    <details
      className="group rounded-xl border border-hairline"
      open={state.status === 'error' || undefined}
    >
      <summary
        className={`flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden ${TOUCH}`}
      >
        <Pencil aria-hidden="true" className="size-4" strokeWidth={1.75} />
        Edit details <span className="sr-only">of {variant.label ?? variant.sku}</span>
      </summary>
      <form action={action} className="grid gap-4 border-t border-hairline p-3">
        <CsrfField csrf={csrf} />
        <input type="hidden" name="productId" value={product.id} />
        <input type="hidden" name="variantId" value={variant.id} />
        {variant.attributeValueIds.map((valueId) => (
          <input key={valueId} type="hidden" name="attributeValueIds" value={valueId} />
        ))}
        {variant.isActive ? <input type="hidden" name="isActive" value="on" /> : null}
        <VariantFields
          idPrefix={`edit-${variant.id}`}
          product={product}
          variant={variant}
          state={state}
        />
        <VariantPicture
          product={product}
          variant={variant}
          csrf={csrf}
          idPrefix={`edit-${variant.id}`}
        />
        <ActionFeedback state={state} />
        <div>
          <SubmitButton label={tx('Save variant')} variant="outline" />
        </div>
      </form>
    </details>
  );
}

function VariantThumb({ variant }: { variant: AdminVariant }) {
  return (
    <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl border border-hairline bg-surface-muted">
      {variant.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- the variant's own picture
        <img src={variant.imageUrl} alt="" className="size-full object-cover" />
      ) : (
        <Layers aria-hidden="true" className="size-4 text-muted-foreground" strokeWidth={1.75} />
      )}
    </span>
  );
}

function VariantRow({
  product,
  variant,
  attributes,
  csrf,
  canEdit,
  canAdjust,
  canDelete,
}: {
  product: AdminProductDetail;
  variant: AdminVariant;
  attributes: AdminAttribute[];
  csrf: CsrfInput;
  canEdit: boolean;
  canAdjust: boolean;
  canDelete: boolean;
}) {
  const tx = useTx();
  const [activeState, activeAction] = useActionState(setVariantActiveAction, IDLE_STATE);
  const [stockState, stockAction] = useActionState(adjustVariantStockAction, IDLE_STATE);
  const [deleteState, deleteAction] = useActionState(deleteVariantAction, IDLE_STATE);
  const stockErrors = errorsOf(stockState);
  const name = variant.label ?? variant.sku;
  // The swatches this combination stands for: one dot per colour attribute value.
  const swatches = variant.attributeValueIds.flatMap((valueId) => {
    for (const attribute of attributes) {
      const value = attribute.values.find((candidate) => candidate.id === valueId);
      if (value) return [{ attribute, value }];
    }
    return [];
  });
  return (
    <li
      className={cn(
        'nz-panel-strong grid gap-4 rounded-2xl border p-4',
        !variant.isActive && 'opacity-80',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <VariantThumb variant={variant} />
          <div className="grid min-w-0 gap-1">
            <p className="flex items-center gap-2 font-medium wrap-break-word text-foreground">
              {swatches
                .filter(({ attribute }) => attribute.kind === 'color')
                .map(({ value }) => (
                  <SwatchDot key={value.id} hex={value.swatchHex} className="size-4" />
                ))}
              {name}
            </p>
            <p className="font-mono text-xs text-muted-foreground">
              <AutoText value={variant.sku} />
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-foreground tabular-nums">
            {formatMoney(variant.priceMinor ?? product.priceMinor)}
          </span>
          {variant.priceMinor === null ? (
            <Chip tone="neutral">
              <AutoText>Product price</AutoText>
            </Chip>
          ) : null}
          {variant.compareAtPriceMinor !== null ? (
            <s className="text-xs text-muted-foreground tabular-nums">
              <span className="sr-only">Former price </span>
              {formatMoney(variant.compareAtPriceMinor)}
            </s>
          ) : null}
          <span className="text-muted-foreground tabular-nums">
            {formatCount(variant.stockQuantity)} in stock
          </span>
          <StockBadge quantity={variant.stockQuantity} />
          <Chip tone={variant.isActive ? 'success' : 'neutral'} dot>
            {variant.isActive ? 'On sale' : 'Hidden'}
          </Chip>
        </div>
      </div>

      {canEdit || canAdjust || canDelete ? (
        <div className="grid gap-4 border-t border-hairline pt-4">
          {canEdit ? <VariantEditForm product={product} variant={variant} csrf={csrf} /> : null}
          <div className="flex flex-wrap items-end gap-3">
            {canEdit ? (
              <form action={activeAction} className="grid gap-1">
                <CsrfField csrf={csrf} />
                <input type="hidden" name="productId" value={product.id} />
                <input type="hidden" name="variantId" value={variant.id} />
                <input type="hidden" name="isActive" value={variant.isActive ? 'off' : 'on'} />
                <SubmitButton
                  label={variant.isActive ? 'Hide from the storefront' : 'Put on sale'}
                  icon={Layers}
                  variant="outline"
                />
                <ActionFeedback state={activeState} inline />
              </form>
            ) : null}
            {canDelete ? (
              <ConfirmForm
                action={deleteAction}
                csrf={csrf}
                align="end"
                className="sm:ml-auto"
                trigger={
                  <>
                    <Trash2 aria-hidden="true" strokeWidth={1.75} />
                    Delete{' '}
                    <span className="sr-only">
                      <AutoText value={name} />
                    </span>
                  </>
                }
                title={`Delete the variant “${name}”?`}
                description={tx(
                  'It disappears from the storefront. Orders already placed keep their own copy of it. This cannot be undone.',
                )}
                confirmLabel={tx('Delete variant')}
                hiddenFields={{ productId: product.id, variantId: variant.id }}
                error={deleteState.status === 'error' ? deleteState.message : undefined}
              />
            ) : null}
          </div>
          {canAdjust ? (
            <form action={stockAction} className="grid gap-2" noValidate>
              <CsrfField csrf={csrf} />
              <input type="hidden" name="productId" value={product.id} />
              <input type="hidden" name="variantId" value={variant.id} />
              <div className="flex flex-wrap items-start gap-3">
                <Field
                  id={`mode-${variant.id}`}
                  label={tx('Action')}
                  hint={tx('Add, remove, set an exact count, or correct')}
                  className="w-44"
                >
                  {(control) => (
                    <select
                      id={control.id}
                      name="mode"
                      defaultValue={stockState.status === 'error' ? stockState.values?.mode : 'add'}
                      className="h-11 w-full rounded-xl border border-input-border bg-surface px-3 text-sm text-foreground max-sm:h-11"
                    >
                      <option value="add">
                        <AutoText>Add stock</AutoText>
                      </option>
                      <option value="remove">
                        <AutoText>Remove stock</AutoText>
                      </option>
                      <option value="set">
                        <AutoText>Set stock</AutoText>
                      </option>
                      <option value="correction">Correction (+/−)</option>
                    </select>
                  )}
                </Field>
                <Field
                  id={`change-${variant.id}`}
                  label={tx('Units')}
                  hint={tx('e.g. 5')}
                  error={stockErrors.change}
                  className="w-28"
                >
                  {(control) => (
                    <Input
                      {...control}
                      name="change"
                      inputMode="numeric"
                      defaultValue={
                        stockState.status === 'error' ? stockState.values?.change : undefined
                      }
                      className="tabular-nums max-sm:h-11"
                    />
                  )}
                </Field>
                <Field
                  id={`note-${variant.id}`}
                  label={tx('Reason')}
                  hint={tx('Recorded in the ledger')}
                  error={stockErrors.note}
                  className="min-w-48 flex-1"
                >
                  {(control) => (
                    <Input
                      {...control}
                      name="note"
                      maxLength={300}
                      placeholder={tx('Stock received')}
                      defaultValue={
                        stockState.status === 'error' ? stockState.values?.note : undefined
                      }
                      className="max-sm:h-11"
                    />
                  )}
                </Field>
                <div className="pt-6.5">
                  <SubmitButton label={tx('Update stock')} variant="secondary" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Current stock:{' '}
                <span className="font-semibold text-foreground tabular-nums">
                  {formatCount(variant.stockQuantity)}
                </span>
                <AutoText>. Every action is recorded in the ledger with its reason.</AutoText>
              </p>
              <ActionFeedback state={stockState} inline />
            </form>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Creates every combination of the chosen values at once (e.g. sizes S–XL in three colours).
 * Combinations the product already sells are skipped, so running it again only fills gaps.
 */
/**
 * Generate the product's options from colours and sizes together.
 *
 * The administrator ticks a colour and a size and immediately sees every combination those two
 * produce - before anything is written. Each combination can be unticked, so a shop that stocks
 * navy only in M and L says so here instead of creating rows it must delete afterwards, and the
 * combinations that already exist are marked and never offered again. One submit creates exactly
 * the ticked rows through the same API call a hand-added variant uses, so no existing stock,
 * price or picture is touched.
 */
function VariantGenerator({
  product,
  attributes,
  locked,
  csrf,
  existing = [],
}: {
  product: AdminProductDetail;
  attributes: AdminAttribute[];
  /** The product already has variants: these attributes are the ones it must use. */
  locked: boolean;
  csrf: CsrfInput;
  /** The combinations that already exist, as sorted value ids, so they are never re-offered. */
  existing?: readonly string[];
}) {
  const tx = useTx();
  const [state, action] = useActionState(generateVariantsAction, IDLE_STATE);
  const errors = errorsOf(state);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [dropped, setDropped] = useState<ReadonlySet<string>>(() => new Set<string>());

  // Every crossing of the ticked values, in the attributes' own order.
  const groups = attributes
    .map((attribute) => attribute.values.filter((value) => chosen.has(value.id)))
    .filter((values) => values.length > 0);
  const combos: { ids: string[]; key: string; label: string; exists: boolean }[] = [];
  if (groups.length > 0) {
    let rows: { ids: string[]; names: string[] }[] = [{ ids: [], names: [] }];
    for (const attribute of attributes) {
      const values = attribute.values.filter((value) => chosen.has(value.id));
      if (values.length === 0) continue;
      rows = rows.flatMap((row) =>
        values.map((value) => ({
          ids: [...row.ids, value.id],
          names: [...row.names, value.value],
        })),
      );
    }
    const taken = new Set(existing);
    for (const row of rows) {
      const key = [...row.ids].sort().join(',');
      combos.push({ ids: row.ids, key, label: row.names.join(' / '), exists: taken.has(key) });
    }
  }
  const fresh = combos.filter((combo) => !combo.exists);
  const selected = fresh.filter((combo) => !dropped.has(combo.key));
  const toggleValue = (id: string) => {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setDropped(new Set<string>());
  };
  const toggleCombo = (key: string) => {
    setDropped((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const allSelected = fresh.length > 0 && selected.length === fresh.length;
  const toggleAll = () =>
    setDropped(allSelected ? new Set(fresh.map((combo) => combo.key)) : new Set<string>());

  return (
    <SectionCard
      title={tx('Generate variants')}
      icon={Wand2}
      description={
        locked
          ? `Tick a value of each attribute this product uses (${attributes.map((attribute) => attribute.name).join(', ')}), then choose the combinations to create.`
          : 'Tick the colours and sizes, then choose which combinations to create. Each becomes a variant with the product price and no stock; set price, stock and pictures afterwards.'
      }
      className="nz-panel-strong"
    >
      <form action={action} className="grid gap-4">
        <CsrfField csrf={csrf} />
        <input type="hidden" name="productId" value={product.id} />
        <div className="grid gap-3 sm:grid-cols-2">
          {attributes.map((attribute) => (
            <fieldset
              key={attribute.id}
              className="grid gap-2 rounded-xl border border-hairline p-3"
            >
              <legend className="px-1 text-sm font-medium text-foreground">{attribute.name}</legend>
              <div className="flex flex-wrap gap-2">
                {attribute.values.map((value) => (
                  <label
                    key={value.id}
                    className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-hairline px-3 text-sm has-checked:border-primary has-checked:bg-info-soft max-sm:min-h-11"
                  >
                    <input
                      type="checkbox"
                      checked={chosen.has(value.id)}
                      onChange={() => toggleValue(value.id)}
                      className="size-4 accent-primary-action"
                    />
                    {value.value}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>

        {combos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <AutoText>Choose at least one colour and one size to see the combinations.</AutoText>
          </p>
        ) : (
          <div className="grid gap-2 rounded-xl border border-hairline bg-surface px-3 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-foreground">
                Combinations to create
                <span className="ml-2 font-normal text-muted-foreground tabular-nums">
                  {selected.length} / {fresh.length}
                </span>
              </p>
              {fresh.length === 0 ? null : (
                <button
                  type="button"
                  onClick={toggleAll}
                  className="rounded-lg px-2 py-1 text-sm font-medium text-link hover:underline"
                >
                  {allSelected ? 'Select none' : 'Select all'}
                </button>
              )}
            </div>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {combos.map((combo) => (
                <li key={combo.key}>
                  {combo.exists ? (
                    <span className="flex min-h-9 items-center gap-2 rounded-lg bg-neutral-soft px-2.5 text-sm text-muted-foreground">
                      <Check aria-hidden="true" className="size-4" />
                      <span className="flex-1">
                        <AutoText value={combo.label} />
                      </span>
                      <span className="text-xs">
                        <AutoText>Already exists</AutoText>
                      </span>
                    </span>
                  ) : (
                    <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2.5 text-sm text-foreground hover:bg-surface-muted has-checked:bg-info-soft">
                      <input
                        type="checkbox"
                        name="generateCombination"
                        value={combo.ids.join(',')}
                        checked={!dropped.has(combo.key)}
                        onChange={() => toggleCombo(combo.key)}
                        className="size-4 accent-primary-action"
                      />
                      <span className="flex-1">
                        <AutoText value={combo.label} />
                      </span>
                    </label>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* The chosen values travel as one field per value: the API checks that every attribute
            this product varies by is represented. The exact rows come from generateCombination. */}
        {attributes.flatMap((attribute) =>
          attribute.values
            .filter((value) => chosen.has(value.id))
            .map((value) => (
              <input key={value.id} type="hidden" name="generateValueIds" value={value.id} />
            )),
        )}
        {errors.generateValueIds ? (
          <p className="text-sm text-danger-ink">
            <AutoText value={errors.generateValueIds} />
          </p>
        ) : null}
        <Field
          id="generate-sku"
          label={tx('SKU start')}
          error={errors.skuPrefix}
          hint={tx("Each variant's SKU is this plus its values, e.g. TSHIRT-M-NAVY.")}
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
          <SubmitButton label={tx('Generate variants')} />
        </div>
      </form>
    </SectionCard>
  );
}

function AddVariantForm({
  product,
  attributes,
  locked,
  csrf,
}: {
  product: AdminProductDetail;
  attributes: AdminAttribute[];
  locked: boolean;
  csrf: CsrfInput;
}) {
  const tx = useTx();
  const [state, action] = useActionState(saveVariantAction, IDLE_STATE);
  const errors = errorsOf(state);
  return (
    <SectionCard
      title={tx('Add a variant')}
      icon={Plus}
      description={
        locked
          ? 'Choose one value of each attribute this product uses.'
          : 'Choose the attributes this product varies by. Every later variant then uses the same ones.'
      }
      className="nz-panel-strong"
    >
      <form action={action} className="grid gap-4">
        <CsrfField csrf={csrf} />
        <input type="hidden" name="productId" value={product.id} />
        <div className="grid items-start gap-4 sm:grid-cols-2">
          {attributes.map((attribute) => (
            <Field
              key={attribute.id}
              id={`value-${attribute.id}`}
              label={attribute.name}
              error={errors.attributeValueIds}
              required={locked}
            >
              {(control) => (
                <NativeSelect
                  {...control}
                  name="attributeValueIds"
                  defaultValue=""
                  className="max-sm:h-11"
                >
                  <option value="">
                    {locked ? `Choose ${attribute.name.toLowerCase()}` : 'Not used'}
                  </option>
                  {attribute.values.map((value) => (
                    <option key={value.id} value={value.id}>
                      {value.value}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          ))}
        </div>
        <VariantFields idPrefix="variant" product={product} state={state} />
        <VariantPicture product={product} csrf={csrf} idPrefix="variant" />
        <label className="flex min-h-11 items-center gap-2.5 text-sm text-foreground">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked
            className="size-5 accent-primary-action"
          />
          <AutoText>Sell this option on the storefront</AutoText>
        </label>
        <ActionFeedback state={state} />
        <div>
          <SubmitButton label={tx('Save variant')} />
        </div>
      </form>
    </SectionCard>
  );
}

/**
 * One product's variants. Each needs one value from each of the product's attributes; the
 * database refuses a duplicate SKU, a duplicate combination or a variant on other
 * attributes, and past orders keep their own snapshot. Controls follow the permissions the
 * API checks: products.update to add, edit and show or hide, inventory.adjust for stock,
 * products.publish to delete.
 */
export /**
 * The same number of units added to (or removed from) every variant of one value — every
 * size of one colour, say. Each variant still gets its own ledger entry through the normal
 * stock function, so permissions and the no-negative-stock rule are checked per variant.
 */
function BulkStockForm({
  product,
  attributes,
  variants,
  csrf,
}: {
  product: AdminProductDetail;
  attributes: AdminAttribute[];
  variants: AdminVariant[];
  csrf: CsrfInput;
}) {
  const tx = useTx();
  const [state, action] = useActionState(bulkVariantStockAction, IDLE_STATE);
  const errors = errorsOf(state);
  // Only values that at least one variant actually uses.
  const used = new Set(variants.flatMap((variant) => variant.attributeValueIds));
  const choices = attributes
    .map((attribute) => ({
      attribute,
      values: attribute.values.filter((value) => used.has(value.id)),
    }))
    .filter((group) => group.values.length > 0);
  if (choices.length === 0) return null;

  return (
    <SectionCard
      title={tx('Bulk stock by option')}
      icon={Layers}
      description={tx(
        'Add or remove the same number of units for every variant of one value, such as all sizes of one colour. Each change is recorded in the ledger.',
      )}
      className="nz-panel-strong"
    >
      <form action={action} className="grid gap-4" noValidate>
        <CsrfField csrf={csrf} />
        <input type="hidden" name="productId" value={product.id} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="bulk-value"
            label={tx('Which value')}
            hint={tx('Every variant that uses it')}
            error={errors.valueId}
            required
          >
            {(control) => (
              <select
                id={control.id}
                name="valueId"
                defaultValue=""
                className="h-11 rounded-xl border border-input-border bg-surface px-3 text-sm text-foreground"
              >
                <option value="" disabled>
                  <AutoText>Choose a value</AutoText>
                </option>
                {choices.map(({ attribute, values }) => (
                  <optgroup key={attribute.id} label={attribute.name}>
                    {values.map((value) => (
                      <option key={value.id} value={value.id}>
                        {value.value}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}
          </Field>
          <Field id="bulk-mode" label={tx('Action')} hint={tx('Add to, or remove from, every one')}>
            {(control) => (
              <select
                id={control.id}
                name="mode"
                defaultValue="add"
                className="h-11 rounded-xl border border-input-border bg-surface px-3 text-sm text-foreground"
              >
                <option value="add">
                  <AutoText>Add stock</AutoText>
                </option>
                <option value="remove">
                  <AutoText>Remove stock</AutoText>
                </option>
              </select>
            )}
          </Field>
          <Field id="bulk-change" label={tx('Units')} hint={tx('e.g. 10')} error={errors.change}>
            {(control) => (
              <Input
                {...control}
                name="change"
                inputMode="numeric"
                className="tabular-nums max-sm:h-11"
              />
            )}
          </Field>
          <Field
            id="bulk-note"
            label={tx('Reason')}
            error={errors.note}
            hint={tx('Recorded in the ledger')}
          >
            {(control) => (
              <Input
                {...control}
                name="note"
                maxLength={300}
                placeholder={tx('Supplier delivery')}
                className="max-sm:h-11"
              />
            )}
          </Field>
        </div>
        <ActionFeedback state={state} inline />
        <div>
          <SubmitButton label={tx('Apply to every variant of that value')} variant="secondary" />
        </div>
      </form>
    </SectionCard>
  );
}

export function VariantEditor({
  product,
  variants,
  attributes,
  csrf,
  canEdit,
  canAdjust,
  canDelete,
}: {
  product: AdminProductDetail;
  variants: AdminVariant[];
  attributes: AdminAttribute[];
  csrf: CsrfInput;
  canEdit: boolean;
  canAdjust: boolean;
  canDelete: boolean;
}) {
  const tx = useTx();
  const used = productAttributeIds(variants, attributes);
  const locked = used.size > 0;
  // A product with variants keeps to its attributes (even one hidden since); otherwise any
  // available attribute with values may be chosen.
  const usable = locked
    ? attributes.filter((attribute) => used.has(attribute.id))
    : attributes.filter((attribute) => attribute.isActive && attribute.values.length > 0);
  const onSale = variants.filter((variant) => variant.isActive);
  const units = onSale.reduce((sum, variant) => sum + variant.stockQuantity, 0);
  const soldOut = onSale.filter((variant) => variant.stockQuantity === 0).length;

  return (
    <div className="grid gap-6">
      {variants.length > 0 ? (
        <ColourVariants
          product={product}
          variants={variants}
          attributes={attributes}
          csrf={csrf}
          canEdit={canEdit}
        />
      ) : null}

      <SectionCard
        title={variants.length > 0 ? 'Every variant' : 'Variants'}
        icon={Layers}
        description={
          variants.length === 0
            ? 'This product sells as a single item. Add a variant to sell it in options.'
            : `Sold by ${usable.map((attribute) => attribute.name).join(' and ')}. The price and stock here are what the storefront uses; each row is one combination, edited on its own.`
        }
      >
        {variants.length === 0 ? (
          <EmptyPanel
            icon={Layers}
            title={tx('No variants yet')}
            description={tx('Products without variants keep selling at their own price and stock.')}
          />
        ) : (
          <div className="grid gap-4">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['Variants', formatCount(variants.length)],
                ['On sale', formatCount(onSale.length)],
                ['Units on sale', formatCount(units)],
                ['Sold out', formatCount(soldOut)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-hairline bg-surface px-3 py-2">
                  <dt className="text-xs text-muted-foreground">
                    <AutoText value={label} />
                  </dt>
                  <dd className="text-lg font-semibold text-foreground tabular-nums">
                    <AutoText value={value} />
                  </dd>
                </div>
              ))}
            </dl>
            <ul aria-label={tx('Variants')} className="grid gap-4">
              {variants.map((variant) => (
                <VariantRow
                  key={variant.id}
                  product={product}
                  variant={variant}
                  attributes={attributes}
                  csrf={csrf}
                  canEdit={canEdit}
                  canAdjust={canAdjust}
                  canDelete={canDelete}
                />
              ))}
            </ul>
          </div>
        )}
      </SectionCard>

      {canEdit && usable.length > 0 ? (
        <VariantGenerator
          product={product}
          attributes={usable}
          locked={locked}
          csrf={csrf}
          existing={variants.map((variant) => [...variant.attributeValueIds].sort().join(','))}
        />
      ) : null}

      {canAdjust && variants.length > 1 && usable.length > 0 ? (
        <BulkStockForm product={product} attributes={usable} variants={variants} csrf={csrf} />
      ) : null}

      {canEdit ? (
        usable.length === 0 ? (
          <SectionCard title={tx('Add a variant')} icon={Plus} className="nz-panel-strong">
            <EmptyPanel
              icon={Shapes}
              title={tx('Add an attribute first')}
              description={tx(
                'A variant is one value from each attribute. Add an attribute with at least one value on the Attributes page.',
              )}
            />
          </SectionCard>
        ) : (
          <AddVariantForm product={product} attributes={usable} locked={locked} csrf={csrf} />
        )
      ) : null}
    </div>
  );
}
