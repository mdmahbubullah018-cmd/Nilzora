'use client';

import type { AdminBanner, AdminCategory } from '@nilzora/contracts';
import { Alert, Button, Field, Input, NativeSelect } from '@nilzora/ui';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { useActionState, useRef, useState } from 'react';
import { ConfirmForm } from '@/components/admin-kit/confirm-form';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import type { ActionState } from '@/components/admin-kit/act';
import { PictureUploadForm as PictureForm } from '@/components/admin-kit/picture-upload-form';
import {
  BannerPreview,
  BANNER_GUIDANCE,
  type BannerPreviewValues,
} from '@/components/merch/banner-preview';
import {
  deleteBannerAction,
  removeBannerMobileImageAction,
  reorderBannersAction,
  saveBannerAction,
  uploadBannerImageAction,
  uploadBannerMobileImageAction,
} from '@/lib/merch-actions';
import { bannerName } from '@/lib/banner-name';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/* Banner forms: content, pictures, order and removal of storefront banners. */
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

const PLACEMENT_LABELS = {
  home_hero: 'Homepage hero (large)',
  home_secondary: 'Homepage campaign (compact)',
  category: 'Category page strip',
} as const;

/** "2026-11-01T09:00" in Bangladesh time, for a datetime-local field. */
function bdLocal(iso: string | null): string {
  if (!iso) return '';
  const shifted = new Date(new Date(iso).getTime() + 6 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 16);
}

export function BannerForm({
  banner,
  categories,
  csrf,
}: {
  banner?: AdminBanner;
  categories: readonly AdminCategory[];
  csrf: CsrfInput;
}) {
  const tx = useTx();
  const [state, action, pending] = useActionState(saveBannerAction, IDLE);
  const errors = state.fieldErrors ?? {};
  const values = state.status === 'error' ? state.values : undefined;
  const id = banner?.id ?? 'new';
  // A draft preview that follows the fields as they are typed, so an admin sees the customer's
  // result — including an image-only banner — before saving it.
  const formRef = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState<BannerPreviewValues>(() => ({
    placement: banner?.placement ?? 'home_secondary',
    title: banner?.title ?? '',
    subtitle: banner?.subtitle ?? null,
    ctaLabel: banner?.ctaLabel ?? null,
    imageUrl: banner?.image?.url ?? null,
  }));
  const syncDraft = () => {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    const text = (name: string): string => {
      const value = data.get(name);
      return typeof value === 'string' ? value.trim() : '';
    };
    const placement = text('placement');
    setDraft({
      placement:
        placement === 'home_hero' || placement === 'category' ? placement : 'home_secondary',
      title: text('title'),
      subtitle: text('subtitle') === '' ? null : text('subtitle'),
      ctaLabel: text('ctaLabel') === '' ? null : text('ctaLabel'),
      imageUrl: banner?.image?.url ?? null,
    });
  };
  return (
    <form
      ref={formRef}
      action={action}
      onChange={syncDraft}
      onInput={syncDraft}
      className="grid gap-4"
    >
      <CsrfField csrf={csrf} />
      {banner ? <input type="hidden" name="bannerId" value={banner.id} /> : null}
      <Outcome state={state} />
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field
          id={`banner-placement-${id}`}
          label={tx('Placement')}
          error={errors.placement}
          required
        >
          {(control) => (
            <NativeSelect
              {...control}
              name="placement"
              defaultValue={values?.placement ?? banner?.placement ?? 'home_secondary'}
            >
              {Object.entries(PLACEMENT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field
          id={`banner-category-${id}`}
          label={tx('Category (category strips only)')}
          error={errors.categoryId}
        >
          {(control) => (
            <NativeSelect
              {...control}
              name="categoryId"
              defaultValue={values?.categoryId ?? banner?.categoryId ?? ''}
            >
              <option value="">—</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      </div>
      <p className="text-sm text-muted-foreground">
        Every word is optional. Leave them empty for a picture-only banner whose artwork already
        carries the message; anything you add is shown beside or under the picture, never painted
        over it.
      </p>
      <Field
        id={`banner-title-${id}`}
        label={tx('Heading (optional)')}
        error={errors.title}
        hint={tx('Leave empty when the picture says it all.')}
      >
        {(control) => (
          <Input
            {...control}
            name="title"
            maxLength={80}
            defaultValue={values?.title ?? banner?.title ?? ''}
          />
        )}
      </Field>
      <Field
        id={`banner-alt-${id}`}
        label={tx('Picture description (for screen readers)')}
        error={errors.imageAlt}
        hint={tx(
          'Not shown on the page. Needed when there is no heading, for example “Two cotton sarees in blue and gold”.',
        )}
      >
        {(control) => (
          <Input
            {...control}
            name="imageAlt"
            maxLength={160}
            defaultValue={values?.imageAlt ?? banner?.imageAlt ?? ''}
          />
        )}
      </Field>
      <Field
        id={`banner-subtitle-${id}`}
        label={tx('Supporting text (optional)')}
        error={errors.subtitle}
      >
        {(control) => (
          <Input
            {...control}
            name="subtitle"
            maxLength={200}
            defaultValue={values?.subtitle ?? banner?.subtitle ?? ''}
          />
        )}
      </Field>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field
          id={`banner-cta-label-${id}`}
          label={tx('Button label (optional)')}
          error={errors.ctaLabel}
        >
          {(control) => (
            <Input
              {...control}
              name="ctaLabel"
              maxLength={30}
              placeholder={tx('Shop now')}
              defaultValue={values?.ctaLabel ?? banner?.ctaLabel ?? ''}
            />
          )}
        </Field>
        <Field
          id={`banner-cta-href-${id}`}
          label={tx('Button link (optional store path)')}
          error={errors.ctaHref}
        >
          {(control) => (
            <Input
              {...control}
              name="ctaHref"
              maxLength={300}
              spellCheck={false}
              placeholder="/categories/fashion"
              defaultValue={values?.ctaHref ?? banner?.ctaHref ?? ''}
            />
          )}
        </Field>
      </div>
      <div className="grid items-start gap-4 sm:grid-cols-3">
        <Field id={`banner-order-${id}`} label={tx('Display order')} error={errors.sortOrder}>
          {(control) => (
            <Input
              {...control}
              name="sortOrder"
              type="number"
              min={0}
              max={1000}
              defaultValue={values?.sortOrder ?? String(banner?.sortOrder ?? 0)}
            />
          )}
        </Field>
        <Field id={`banner-starts-${id}`} label={tx('Starts (BD time)')} error={errors.startsAt}>
          {(control) => (
            <Input
              {...control}
              name="startsAt"
              type="datetime-local"
              defaultValue={values?.startsAt ?? bdLocal(banner?.startsAt ?? null)}
            />
          )}
        </Field>
        <Field id={`banner-ends-${id}`} label={tx('Ends (BD time)')} error={errors.endsAt}>
          {(control) => (
            <Input
              {...control}
              name="endsAt"
              type="datetime-local"
              defaultValue={values?.endsAt ?? bdLocal(banner?.endsAt ?? null)}
            />
          )}
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Check name="isActive" label={tx('Active')} defaultChecked={banner?.isActive ?? false} />
        <Button type="submit" loading={pending}>
          {banner ? 'Save banner' : 'Create banner'}
        </Button>
      </div>
      <div className="grid gap-2 rounded-xl border border-hairline bg-surface-muted/40 p-3">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          <AutoText>Live preview</AutoText>
        </p>
        <BannerPreview
          values={draft}
          label={`Preview of the banner being edited: ${bannerName({ ...draft, title: draft.title })}`}
        />
        <p className="text-xs text-muted-foreground">
          {BANNER_GUIDANCE[draft.placement]} The words you add sit on the artwork; leave them all
          empty and the picture stands on its own.
        </p>
      </div>
    </form>
  );
}

export function BannerImageForm({ banner, csrf }: { banner: AdminBanner; csrf: CsrfInput }) {
  return (
    <PictureForm
      kind="banner-image"
      placement={banner.placement}
      idName="bannerId"
      idValue={banner.id}
      csrf={csrf}
      label={banner.image ? 'Replace picture' : 'Upload picture'}
      action={uploadBannerImageAction}
    />
  );
}

/** The picture small screens show instead of the main one (optional). */
export function BannerMobileImageForm({ banner, csrf }: { banner: AdminBanner; csrf: CsrfInput }) {
  const [state, remove, removing] = useActionState(removeBannerMobileImageAction, IDLE);
  const current = banner.mobileImage ?? null;
  return (
    <div className="grid gap-3">
      {current ? (
        // eslint-disable-next-line @next/next/no-img-element -- already-optimised WebP from the media service
        <img
          src={current.thumbUrl}
          alt={`The small-screen picture of ${bannerName(banner)}`}
          className="max-h-40 w-auto max-w-full justify-self-start rounded-xl border border-hairline object-contain"
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          <AutoText>
            No small-screen picture: phones and narrow windows show the main picture.
          </AutoText>
        </p>
      )}
      <PictureForm
        kind="banner-mobile-image"
        idName="bannerId"
        idValue={banner.id}
        csrf={csrf}
        label={current ? 'Replace small-screen picture' : 'Upload small-screen picture'}
        action={uploadBannerMobileImageAction}
      />
      {current ? (
        <form action={remove} className="grid gap-2">
          <CsrfField csrf={csrf} />
          <input type="hidden" name="bannerId" value={banner.id} />
          <Outcome state={state} />
          <Button
            type="submit"
            variant="ghost"
            loading={removing}
            className="justify-self-start max-sm:min-h-11"
          >
            <AutoText>Remove small-screen picture</AutoText>
          </Button>
        </form>
      ) : null}
    </div>
  );
}

/** Earlier and later buttons for one banner among those of its placement (and category). */
export function MoveBannerForm({
  banner,
  order,
  index,
  count,
  csrf,
}: {
  banner: AdminBanner;
  /** Every banner id of the placement (and category), in the order shown. */
  order: string;
  index: number;
  count: number;
  csrf: CsrfInput;
}) {
  const [state, action, pending] = useActionState(reorderBannersAction, IDLE);
  return (
    <form action={action} className="grid justify-items-start gap-1">
      <CsrfField csrf={csrf} />
      <input type="hidden" name="bannerId" value={banner.id} />
      <input type="hidden" name="placement" value={banner.placement} />
      <input type="hidden" name="categoryId" value={banner.categoryId ?? ''} />
      <input type="hidden" name="order" value={order} />
      <div className="flex gap-1.5">
        <Button
          type="submit"
          name="direction"
          value="earlier"
          variant="outline"
          size="sm"
          disabled={index === 0 || pending}
          aria-label={`Move ${bannerName(banner)} earlier`}
          className="rounded-xl max-sm:size-11"
        >
          <ChevronUp aria-hidden="true" strokeWidth={1.75} />
        </Button>
        <Button
          type="submit"
          name="direction"
          value="later"
          variant="outline"
          size="sm"
          disabled={index === count - 1 || pending}
          aria-label={`Move ${bannerName(banner)} later`}
          className="rounded-xl max-sm:size-11"
        >
          <ChevronDown aria-hidden="true" strokeWidth={1.75} />
        </Button>
      </div>
      {state.status === 'error' ? <Outcome state={state} /> : null}
    </form>
  );
}

/** Deletes a banner after confirmation. */
export function DeleteBannerForm({ banner, csrf }: { banner: AdminBanner; csrf: CsrfInput }) {
  const tx = useTx();
  const [state, action] = useActionState(deleteBannerAction, IDLE);
  return (
    <ConfirmForm
      action={action}
      csrf={csrf}
      align="start"
      triggerVariant="ghost"
      trigger={
        <>
          <Trash2 aria-hidden="true" strokeWidth={1.75} />
          Delete banner{' '}
          <span className="sr-only">
            <AutoText value={bannerName(banner)} />
          </span>
        </>
      }
      title={`Delete the banner “${bannerName(banner)}”?`}
      description={tx(
        'It disappears from the storefront and its pictures are removed. This cannot be undone.',
      )}
      confirmLabel={tx('Delete banner')}
      hiddenFields={{ bannerId: banner.id }}
      error={state.status === 'error' ? state.message : undefined}
    />
  );
}
