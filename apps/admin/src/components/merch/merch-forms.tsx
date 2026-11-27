'use client';

import type { AdminBrand } from '@nilzora/contracts';
import { Alert, Button, Field, Input, NativeSelect, Textarea } from '@nilzora/ui';
import { Trash2 } from 'lucide-react';
import { useActionState, useState } from 'react';
import { ConfirmForm } from '@/components/admin-kit/confirm-form';
import { SlugField } from '@/components/catalog/slug-field';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import type { ActionState } from '@/components/admin-kit/act';
import { PictureUploadForm as PictureForm } from '@/components/admin-kit/picture-upload-form';
import {
  deleteBrandAction,
  removeBrandBannerAction,
  removeBrandLogoAction,
  saveBrandAction,
  setProductBrandAction,
  uploadBrandBannerAction,
  uploadBrandLogoAction,
} from '@/lib/merch-actions';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

const IDLE: ActionState = { status: 'idle' };

function Outcome({ state }: { state: ActionState }) {
  if (state.status === 'idle' || !state.message) return null;
  return (
    <Alert tone={state.status === 'success' ? 'success' : 'danger'}>
      <span aria-live="polite">
        <AutoText value={state.message} />
      </span>
    </Alert>
  );
}

function Check({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-medium text-foreground">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="size-5 accent-primary-action"
      />
      {label}
    </label>
  );
}

/** Creates a brand, or edits one when `brand` is given. */
export function BrandForm({
  brand,
  csrf,
  stacked = false,
}: {
  brand?: AdminBrand;
  csrf: CsrfInput;
  /** One field per row, for a narrow side panel. */
  stacked?: boolean;
}) {
  const tx = useTx();
  const [state, action, pending] = useActionState(saveBrandAction, IDLE);
  const errors = state.fieldErrors ?? {};
  const values = state.status === 'error' ? state.values : undefined;
  const id = brand?.id ?? 'new';
  const [name, setName] = useState(values?.name ?? brand?.name ?? '');
  // A brand was just added: the form starts over for the next one.
  const [seen, setSeen] = useState(state);
  const [round, setRound] = useState(0);
  if (seen !== state) {
    setSeen(state);
    if (state.status === 'success' && brand === undefined) {
      setName('');
      setRound((value) => value + 1);
    }
  }
  return (
    <form action={action} className="grid gap-4">
      <CsrfField csrf={csrf} />
      {brand ? <input type="hidden" name="brandId" value={brand.id} /> : null}
      <Outcome state={state} />
      <div className={stacked ? 'grid gap-4' : 'grid items-start gap-4 sm:grid-cols-2'}>
        <Field id={`brand-name-${id}`} label={tx('Name')} error={errors.name} required>
          {(control) => (
            <Input
              {...control}
              name="name"
              maxLength={80}
              defaultValue={values?.name ?? brand?.name}
              onChange={(event) => setName(event.currentTarget.value)}
              className="max-sm:h-11"
            />
          )}
        </Field>
        <SlugField
          key={round}
          id={`brand-slug-${id}`}
          label={tx('Address (slug)')}
          kind="brand"
          initial={values?.slug ?? brand?.slug ?? ''}
          source={name}
          auto={brand === undefined}
          savedSlug={brand?.slug}
          excludeId={brand?.id}
          csrf={csrf}
          error={errors.slug}
          maxLength={60}
          hint={tx('Shown as nilzora.com/your-slug. Made from the name until you type one.')}
        />
      </div>
      <Field
        id={`brand-description-${id}`}
        label={tx('Description')}
        hint={tx(
          "Optional. A sentence under the name on the brand's page. Leave it empty if there is nothing to say.",
        )}
        error={errors.description}
      >
        {(control) => (
          <Textarea
            {...control}
            name="description"
            rows={3}
            maxLength={500}
            defaultValue={values?.description ?? brand?.description ?? ''}
          />
        )}
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Check
          name="isActive"
          label={tx('Visible in the store')}
          defaultChecked={brand?.isActive ?? true}
        />
        <Button type="submit" loading={pending} className="max-sm:min-h-11">
          {brand ? 'Save brand' : 'Add brand'}
        </Button>
      </div>
    </form>
  );
}

export function BrandLogoForm({ brand, csrf }: { brand: AdminBrand; csrf: CsrfInput }) {
  const [state, remove, removing] = useActionState(removeBrandLogoAction, IDLE);
  return (
    <div className="grid gap-3">
      <PictureForm
        kind="brand-logo"
        idName="brandId"
        idValue={brand.id}
        csrf={csrf}
        label={brand.logo ? 'Replace logo' : 'Upload logo'}
        action={uploadBrandLogoAction}
      />
      {brand.logo ? (
        <form action={remove} className="grid gap-2">
          <CsrfField csrf={csrf} />
          <input type="hidden" name="brandId" value={brand.id} />
          <Outcome state={state} />
          <Button type="submit" variant="ghost" loading={removing} className="justify-self-start">
            <AutoText>Remove logo</AutoText>
          </Button>
        </form>
      ) : null}
    </div>
  );
}

/** The wide picture on a brand's own page; without one the page is just its mark and name. */
export function BrandBannerForm({ brand, csrf }: { brand: AdminBrand; csrf: CsrfInput }) {
  const tx = useTx();
  const [state, remove, removing] = useActionState(removeBrandBannerAction, IDLE);
  return (
    <div className="grid gap-3">
      <PictureForm
        kind="brand-banner"
        idName="brandId"
        idValue={brand.id}
        csrf={csrf}
        label={brand.banner ? 'Replace banner' : 'Upload banner'}
        hint={tx(
          "Shown as the wide band on the brand's own page, under its logo. Without a banner the page is simply the logo and the name.",
        )}
        action={uploadBrandBannerAction}
      />
      {brand.banner ? (
        <form action={remove} className="grid gap-2">
          <CsrfField csrf={csrf} />
          <input type="hidden" name="brandId" value={brand.id} />
          <Outcome state={state} />
          <Button type="submit" variant="ghost" loading={removing} className="justify-self-start">
            <AutoText>Remove banner</AutoText>
          </Button>
        </form>
      ) : null}
    </div>
  );
}

/** Deletes a brand after confirmation; the API refuses while products still use it. */
export function DeleteBrandForm({ brand, csrf }: { brand: AdminBrand; csrf: CsrfInput }) {
  const tx = useTx();
  const [state, action] = useActionState(deleteBrandAction, IDLE);
  return (
    <div className="grid gap-2">
      <ConfirmForm
        action={action}
        csrf={csrf}
        align="start"
        triggerVariant="ghost"
        trigger={
          <>
            <Trash2 aria-hidden="true" strokeWidth={1.75} />
            Delete brand{' '}
            <span className="sr-only">
              <AutoText value={brand.name} />
            </span>
          </>
        }
        title={`Delete the brand “${brand.name}”?`}
        description={tx(
          'Its page disappears from the store. Brands that products still use cannot be deleted. This cannot be undone.',
        )}
        confirmLabel={tx('Delete brand')}
        hiddenFields={{ brandId: brand.id }}
        error={state.status === 'error' ? state.message : undefined}
      />
    </div>
  );
}

/** The brand of one product; only active and inactive brands the API returned are offered. */
export function ProductBrandForm({
  productId,
  currentBrandId,
  brands,
  csrf,
}: {
  productId: string;
  currentBrandId: string | null;
  brands: readonly AdminBrand[];
  csrf: CsrfInput;
}) {
  const tx = useTx();
  const [state, action, pending] = useActionState(setProductBrandAction, IDLE);
  return (
    <form action={action} className="grid gap-3">
      <CsrfField csrf={csrf} />
      <input type="hidden" name="productId" value={productId} />
      <Outcome state={state} />
      <div className="flex flex-wrap items-end gap-3">
        <Field id={`product-brand-${productId}`} label={tx('Brand')} className="flex-1">
          {(control) => (
            <NativeSelect {...control} name="brandId" defaultValue={currentBrandId ?? ''}>
              <option value="">
                <AutoText>No brand</AutoText>
              </option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                  {brand.isActive ? '' : ' (hidden)'}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Button type="submit" variant="outline" loading={pending}>
          <AutoText>Save brand</AutoText>
        </Button>
      </div>
    </form>
  );
}
