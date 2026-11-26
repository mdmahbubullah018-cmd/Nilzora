'use client';

import { ZONE_AUDIENCE_SUGGESTIONS, type AdminShoppingZoneDetail } from '@nilzora/contracts';
import { Alert, Button, Field, Input, Textarea } from '@nilzora/ui';
import { ImagePlus, Trash2 } from 'lucide-react';
import { useActionState, useId, useRef, useState } from 'react';
import type { ActionState } from '@/components/admin-kit/act';
import { ConfirmForm } from '@/components/admin-kit/confirm-form';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { checkReportedFile } from '@/components/catalog/image-upload';
import {
  guidanceLine,
  ZONE_BANNER_GUIDANCE,
  ZONE_MOBILE_BANNER_GUIDANCE,
} from '@/lib/upload-guidance';
import {
  deleteZoneAction,
  removeZoneBannerAction,
  removeZoneMobileBannerAction,
  saveZoneAction,
  setZoneActiveAction,
  uploadZoneBannerAction,
  uploadZoneMobileBannerAction,
} from '@/lib/zone-actions';
import { ZoneAppCardPreview, ZoneTilePreview } from './zone-tile';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/* Zone forms: the zone itself, its picture, whether it shows, and its removal. */

const IDLE: ActionState = { status: 'idle' };

function Outcome({ state }: { state: ActionState }) {
  if (state.status === 'idle' || !state.message) return null;
  return (
    <Alert tone={state.status === 'success' ? 'success' : 'danger'}>
      <span aria-live="polite"><AutoText value={state.message} /></span>
    </Alert>
  );
}

function Check({
  name,
  label,
  hint,
  defaultChecked,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-2.5 text-sm font-medium text-foreground">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-0.5 size-5 accent-primary-action"
      />
      <span className="grid gap-0.5">
        {label}
        {hint ? <span className="text-xs font-normal text-muted-foreground"><AutoText value={hint} /></span> : null}
      </span>
    </label>
  );
}

/** The zone's own words: how it is named, addressed and described. */
export function ZoneForm({ zone, csrf }: { zone?: AdminShoppingZoneDetail; csrf: CsrfInput }) {
  const tx = useTx();
  const [state, action, pending] = useActionState(saveZoneAction, IDLE);
  const errors = state.fieldErrors ?? {};
  const values = state.status === 'error' ? state.values : undefined;
  const id = useId();
  const audienceListId = `${id}-audiences`;

  const shown = (name: string, fallback: string): string => values?.[name] ?? fallback;

  return (
    <form action={action} className="grid gap-4">
      <CsrfField csrf={csrf} />
      {zone ? <input type="hidden" name="zoneId" value={zone.id} /> : null}
      <Outcome state={state} />
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field
          id={`${id}-name`}
          label={tx("Name")}
          error={errors.name}
          required
          hint={tx("What shoppers read on the tile: Men's, Women's, Kids, or any collection you invent.")}
        >
          {(control) => (
            <Input
              {...control}
              name="name"
              maxLength={60}
              defaultValue={shown('name', zone?.name ?? '')}
            />
          )}
        </Field>
        <Field
          id={`${id}-slug`}
          label={tx("Address")}
          error={errors.slug}
          hint={
            zone
              ? `Shown as /products?zone=${zone.slug}. Changing it breaks old links.`
              : 'Leave empty to make it from the name.'
          }
        >
          {(control) => (
            <Input
              {...control}
              name="slug"
              maxLength={60}
              spellCheck={false}
              placeholder={zone ? undefined : 'mens'}
              defaultValue={shown('slug', zone?.slug ?? '')}
            />
          )}
        </Field>
      </div>
      <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,12rem)_minmax(0,8rem)]">
        <Field
          id={`${id}-audience`}
          label={tx("Audience")}
          error={errors.audience}
          hint={tx("Optional. A label for staff, not shown in the store.")}
        >
          {(control) => (
            <>
              <Input
                {...control}
                name="audience"
                maxLength={20}
                list={audienceListId}
                spellCheck={false}
                placeholder="men"
                defaultValue={shown('audience', zone?.audience ?? '')}
              />
              <datalist id={audienceListId}>
                {ZONE_AUDIENCE_SUGGESTIONS.map((suggestion) => (
                  <option key={suggestion} value={suggestion} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <Field
          id={`${id}-order`}
          label={tx("Display order")}
          error={errors.displayOrder}
          hint={tx("Lower first.")}
        >
          {(control) => (
            <Input
              {...control}
              name="displayOrder"
              type="number"
              inputMode="numeric"
              min={0}
              max={1000}
              step={1}
              className="tabular-nums"
              defaultValue={shown('displayOrder', String(zone?.displayOrder ?? 0))}
            />
          )}
        </Field>
      </div>
      <Field
        id={`${id}-description`}
        label={tx("Description")}
        error={errors.description}
        hint={tx("Optional. One line under the name, in the store and the app. Up to 300 characters.")}
      >
        {(control) => (
          <Textarea
            {...control}
            name="description"
            rows={2}
            maxLength={300}
            defaultValue={shown('description', zone?.description ?? '')}
          />
        )}
      </Field>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field
          id={`${id}-seo-title`}
          label={tx("Search title")}
          error={errors.seoTitle}
          hint={tx("Optional. Up to 70 characters.")}
        >
          {(control) => (
            <Input
              {...control}
              name="seoTitle"
              maxLength={70}
              defaultValue={shown('seoTitle', zone?.seoTitle ?? '')}
            />
          )}
        </Field>
        <Field
          id={`${id}-seo-description`}
          label={tx("Search description")}
          error={errors.seoDescription}
          hint={tx("Optional. Up to 160 characters.")}
        >
          {(control) => (
            <Input
              {...control}
              name="seoDescription"
              maxLength={160}
              defaultValue={shown('seoDescription', zone?.seoDescription ?? '')}
            />
          )}
        </Field>
      </div>
      <Check
        name="isActive"
        label={tx("Show in the store and the app")}
        hint={tx("A hidden zone takes no products out of general browsing; it only stops being offered.")}
        defaultChecked={zone?.isActive ?? true}
      />
      <div className="flex justify-end">
        <Button type="submit" loading={pending} className="max-sm:min-h-11 max-sm:w-full">
          {zone ? 'Save zone' : 'Create zone'}
        </Button>
      </div>
    </form>
  );
}

/** Replaces or removes the zone's picture. */
export function ZoneBannerForm({ zone, csrf }: { zone: AdminShoppingZoneDetail; csrf: CsrfInput }) {
  const tx = useTx();
  const [state, action, pending] = useActionState(uploadZoneBannerAction, IDLE);
  const [removeState, removeAction, removePending] = useActionState(removeZoneBannerAction, IDLE);
  const [picked, setPicked] = useState<File | null>(null);
  const [pickedError, setPickedError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();

  return (
    <div className="grid gap-5">
      <div className="grid content-start gap-2">
        <ZoneTilePreview zone={zone} />
        <p className="text-xs text-muted-foreground">
          {zone.banner
            ? `Picture on file. ${zone.bannerAlt ? `Described as “${zone.bannerAlt}”.` : 'No description yet: add one so screen readers can name it.'}`
            : 'No picture: the store draws the branded tile above until you add one.'}
        </p>
      </div>
      <div className="grid content-start gap-5">
        <form action={action} className="grid gap-4">
          <CsrfField csrf={csrf} />
          <input type="hidden" name="zoneId" value={zone.id} />
          <Outcome state={state} />
          <Field
            id={`${id}-image`}
            label={zone.banner ? 'Replace the picture' : 'Picture'}
            error={pickedError ?? state.fieldErrors?.image}
            hint={`${guidanceLine(ZONE_BANNER_GUIDANCE)}. ${ZONE_BANNER_GUIDANCE.note}`}
          >
            {(control) => (
              <Input
                {...control}
                ref={inputRef}
                type="file"
                name="image"
                accept="image/jpeg,image/png,image/webp"
                disabled={pending}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0] ?? null;
                  setPicked(file);
                  setPickedError(file ? checkReportedFile(file) : null);
                }}
              />
            )}
          </Field>
          <Field
            id={`${id}-alt`}
            label={tx("Picture description (for screen readers)")}
            error={state.fieldErrors?.bannerAlt}
            hint={tx("Not shown on the page. Needed when the picture carries the message, for example “Two cotton sarees in blue and gold”.")}
          >
            {(control) => (
              <Input
                {...control}
                name="bannerAlt"
                maxLength={160}
                defaultValue={zone.bannerAlt ?? ''}
              />
            )}
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              loading={pending}
              disabled={pickedError !== null}
              className="max-sm:min-h-11"
            >
              <ImagePlus aria-hidden="true" className="size-4" strokeWidth={1.75} />
              {zone.banner ? 'Replace picture' : 'Upload picture'}
            </Button>
            <span className="text-xs text-muted-foreground">
              {picked ? picked.name : 'Choose a picture first.'}
            </span>
          </div>
        </form>
        {zone.banner ? (
          <form action={removeAction} className="border-t border-hairline pt-4">
            <CsrfField csrf={csrf} />
            <input type="hidden" name="zoneId" value={zone.id} />
            <Outcome state={removeState} />
            <Button
              type="submit"
              variant="ghost"
              loading={removePending}
              className="max-sm:min-h-11"
            >
              <Trash2 aria-hidden="true" className="size-4" strokeWidth={1.75} /><AutoText>Remove the picture</AutoText></Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Replaces or removes the artwork the app draws for this zone.
 *
 * Kept apart from the picture above on purpose: the website has its own picture, the app has
 * its own, and changing one never touches the other. A zone with no app artwork falls back to
 * the website's picture on a phone, which is why the preview shows what the app will really
 * draw rather than only the file that is on record.
 */
export function ZoneMobileBannerForm({
  zone,
  csrf,
}: {
  zone: AdminShoppingZoneDetail;
  csrf: CsrfInput;
}) {
  const [state, action, pending] = useActionState(uploadZoneMobileBannerAction, IDLE);
  const [removeState, removeAction, removePending] = useActionState(
    removeZoneMobileBannerAction,
    IDLE,
  );
  const [picked, setPicked] = useState<File | null>(null);
  const [pickedError, setPickedError] = useState<string | null>(null);
  const id = useId();

  const status = zone.mobileBanner
    ? 'App artwork on file. This is what the phone shows.'
    : zone.banner
      ? 'No app artwork yet: the app shows the website picture below. Upload one to give the phone its own picture.'
      : 'No app artwork and no website picture: the app draws its branded tile below.';

  return (
    <div className="grid gap-5">
      <div className="grid content-start gap-2">
        <ZoneAppCardPreview zone={zone} />
        <p className="text-xs text-muted-foreground"><AutoText value={status} /></p>
      </div>
      <form action={action} className="grid gap-4">
        <CsrfField csrf={csrf} />
        <input type="hidden" name="zoneId" value={zone.id} />
        <Outcome state={state} />
        <Field
          id={`${id}-mobile-image`}
          label={zone.mobileBanner ? 'Replace the app artwork' : 'App artwork'}
          error={pickedError ?? state.fieldErrors?.image}
          hint={`${guidanceLine(ZONE_MOBILE_BANNER_GUIDANCE)}. ${ZONE_MOBILE_BANNER_GUIDANCE.note}`}
        >
          {(control) => (
            <Input
              {...control}
              type="file"
              name="image"
              accept="image/jpeg,image/png,image/webp"
              disabled={pending}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0] ?? null;
                setPicked(file);
                setPickedError(file ? checkReportedFile(file) : null);
              }}
            />
          )}
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            loading={pending}
            disabled={pickedError !== null}
            className="max-sm:min-h-11"
          >
            <ImagePlus aria-hidden="true" className="size-4" strokeWidth={1.75} />
            {zone.mobileBanner ? 'Replace app artwork' : 'Upload app artwork'}
          </Button>
          <span className="text-xs text-muted-foreground">
            {picked ? picked.name : 'Choose a picture first.'}
          </span>
        </div>
      </form>
      {zone.mobileBanner ? (
        <form action={removeAction} className="border-t border-hairline pt-4">
          <CsrfField csrf={csrf} />
          <input type="hidden" name="zoneId" value={zone.id} />
          <Outcome state={removeState} />
          <Button type="submit" variant="ghost" loading={removePending} className="max-sm:min-h-11">
            <Trash2 aria-hidden="true" className="size-4" strokeWidth={1.75} /><AutoText>Remove the app artwork</AutoText></Button>
        </form>
      ) : null}
    </div>
  );
}

/** Shows or hides a zone. Hiding never moves a product out of browsing. */ export function ZoneVisibilityForm({
  zone,
  csrf,
}: {
  zone: AdminShoppingZoneDetail;
  csrf: CsrfInput;
}) {
  const [state, action, pending] = useActionState(setZoneActiveAction, IDLE);
  return (
    <form action={action} className="grid gap-2">
      <CsrfField csrf={csrf} />
      <input type="hidden" name="zoneId" value={zone.id} />
      <input type="hidden" name="isActive" value={zone.isActive ? 'false' : 'true'} />
      <Outcome state={state} />
      <Button type="submit" variant="ghost" loading={pending} className="max-sm:min-h-11">
        {zone.isActive ? 'Hide from the store' : 'Show in the store'}
      </Button>
    </form>
  );
}

/** Deletes a zone, after confirming: only an empty zone can go. */
export function DeleteZoneForm({ zone, csrf }: { zone: AdminShoppingZoneDetail; csrf: CsrfInput }) {
  const tx = useTx();
  const [state, action] = useActionState(deleteZoneAction, IDLE);
  const attached = zone.explicitProductCount + zone.categoryCount;
  if (attached > 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This zone holds {String(zone.explicitProductCount)}{' '}
        {zone.explicitProductCount === 1 ? 'pinned product' : 'pinned products'} and{' '}
        {String(zone.categoryCount)} {zone.categoryCount === 1 ? 'category' : 'categories'}. Empty
        both lists below and the delete button appears.
      </p>
    );
  }
  return (
    <div className="grid gap-2">
      {state.status === 'error' && state.message ? (
        <Alert tone="danger">
          <span aria-live="polite"><AutoText value={state.message} /></span>
        </Alert>
      ) : null}
      <ConfirmForm
        action={action}
        csrf={csrf}
        trigger={
          <>
            <Trash2 aria-hidden="true" className="size-4" strokeWidth={1.75} />
            Delete zone
          </>
        }
        triggerVariant="ghost"
        title={`Delete the ${zone.name} zone?`}
        description={tx("Shoppers stop seeing it in the collection rail. Its products stay in the catalogue and in general browsing. This cannot be undone.")}
        confirmLabel={tx("Yes, delete it")}
        tone="danger"
        hiddenFields={{ zoneId: zone.id }}
        className="max-sm:[&>summary]:min-h-11"
      />
    </div>
  );
}
