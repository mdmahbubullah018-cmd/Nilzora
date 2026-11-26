import {
  ONBOARDING_AUDIENCES,
  ONBOARDING_FREQUENCIES,
  ONBOARDING_ICONS,
  ONBOARDING_LIMITS,
  ONBOARDING_SLIDE_SECONDS,
  type AdminOnboardingSlide,
  type OnboardingCampaign,
  type PublicOnboarding,
} from '@nilzora/contracts';
import { buttonClasses } from '@nilzora/ui';
import { ArrowDown, ArrowUp, ImageOff, Plus } from 'lucide-react';
import Link from 'next/link';
import type { Route } from 'next';
import type { ReactNode } from 'react';
import { SubmitButton } from '@/components/admin-kit/submit-button';
import { ConfirmForm } from '@/components/admin-kit/confirm-form';
import { SectionCard } from '@/components/admin-kit/section-card';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { MediaKeyField } from '@/components/media/media-key-field';
import { SortableSlides } from './sortable-slides';
/* @/lib/format */
import {
  deleteOnboardingSlideAction,
  moveOnboardingSlideAction,
  saveOnboardingCampaignAction,
  saveOnboardingSlideAction,
} from '@/lib/onboarding-actions';
import { AutoText } from '@/components/i18n/translate';
import { formatDateTime } from '@/lib/format';

/*
 * The Onboarding editor.
 *
 * Two things are managed here: the campaign (when it may appear, to whom and how often) and
 * the slides inside it. Every control maps to one field the database also validates, and the
 * copy explains each choice in the customer's terms rather than in database terms.
 */

const AUDIENCE_LABELS: Record<(typeof ONBOARDING_AUDIENCES)[number], string> = {
  all: 'Everyone',
  authenticated: 'Signed-in customers only',
  guest: 'Signed-out visitors only',
};

const FREQUENCY_LABELS: Record<(typeof ONBOARDING_FREQUENCIES)[number], string> = {
  first_launch: 'Only before the customer has seen any onboarding',
  every_launch: 'Every time the app opens',
  once_per_campaign: 'Once per campaign',
  interval: 'Again after a number of days',
};

const ICON_LABELS: Record<(typeof ONBOARDING_ICONS)[number], string> = {
  shop: 'Shop',
  search: 'Search',
  wishlist: 'Wishlist',
  cart: 'Cart',
  cash: 'Cash on delivery',
  delivery: 'Delivery',
  success: 'Success',
  verified: 'Verified',
  location: 'Location',
  orders: 'Orders',
  returns: 'Returns',
  help: 'Help',
};

/** `datetime-local` wants a local wall-clock value, not an ISO instant. */
function toLocalInput(iso: string | null): string {
  if (iso === null) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const inputClass =
  'rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring';

function Field({
  name,
  label,
  hint,
  children,
}: {
  name: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <label htmlFor={name} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {hint === undefined ? null : (
        <p className="text-xs text-muted-foreground">
          <AutoText value={hint} />
        </p>
      )}
      {children}
    </div>
  );
}

/** Campaign settings: what it is, who sees it, how often and how fast it plays. */
export function CampaignForm({
  campaign,
  csrf,
}: {
  campaign?: OnboardingCampaign | undefined;
  csrf: CsrfInput;
}) {
  return (
    <form action={saveOnboardingCampaignAction} className="grid gap-6">
      <CsrfField csrf={csrf} />
      {campaign === undefined ? null : (
        <input type="hidden" name="campaignId" value={campaign.id} />
      )}

      <SectionCard
        title="Campaign"
        description="The sequence a customer sees when the app opens. Only one campaign of each kind can be active at a time."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="internalName" label="Internal name" hint="Only staff see this.">
            <input
              id="internalName"
              name="internalName"
              defaultValue={campaign?.internalName ?? ''}
              maxLength={ONBOARDING_LIMITS.internalName}
              required
              className={inputClass}
            />
          </Field>
          <Field
            name="kind"
            label="Kind"
            hint="A welcome sequence introduces the store; a promotion announces something now."
          >
            <select
              id="kind"
              name="kind"
              defaultValue={campaign?.kind ?? 'welcome'}
              className={inputClass}
            >
              <option value="welcome">
                <AutoText>Welcome sequence</AutoText>
              </option>
              <option value="promotion">
                <AutoText>Promotion</AutoText>
              </option>
            </select>
          </Field>
          <Field name="audience" label="Who sees it">
            <select
              id="audience"
              name="audience"
              defaultValue={campaign?.audience ?? 'all'}
              className={inputClass}
            >
              {ONBOARDING_AUDIENCES.map((value) => (
                <option key={value} value={value}>
                  {AUDIENCE_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>
          <Field name="frequency" label="How often">
            <select
              id="frequency"
              name="frequency"
              defaultValue={campaign?.frequency ?? 'first_launch'}
              className={inputClass}
            >
              {ONBOARDING_FREQUENCIES.map((value) => (
                <option key={value} value={value}>
                  {FREQUENCY_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>
          <Field
            name="repeatDays"
            label="Repeat after (days)"
            hint="Only used by “again after a number of days”. Leave empty otherwise."
          >
            <input
              id="repeatDays"
              name="repeatDays"
              type="number"
              min={1}
              max={365}
              defaultValue={campaign?.frequency === 'interval' ? (campaign.repeatDays ?? '') : ''}
              className={inputClass}
            />
          </Field>
          <Field name="slideSeconds" label="Seconds per slide" hint="Skip appears after 3 seconds.">
            <select
              id="slideSeconds"
              name="slideSeconds"
              defaultValue={String(campaign?.slideSeconds ?? 5)}
              className={inputClass}
            >
              {ONBOARDING_SLIDE_SECONDS.map((value) => (
                <option key={value} value={value}>
                  {value} seconds
                </option>
              ))}
            </select>
          </Field>
          <Field
            name="startsAt"
            label="Starts"
            hint="Leave empty for a welcome sequence that is always available."
          >
            <input
              id="startsAt"
              name="startsAt"
              type="datetime-local"
              defaultValue={toLocalInput(campaign?.startsAt ?? null)}
              className={inputClass}
            />
          </Field>
          <Field name="endsAt" label="Ends" hint="A promotion needs both a start and an end.">
            <input
              id="endsAt"
              name="endsAt"
              type="datetime-local"
              defaultValue={toLocalInput(campaign?.endsAt ?? null)}
              className={inputClass}
            />
          </Field>
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={campaign?.isActive ?? false}
            className="size-4 rounded border-border"
          />
          <AutoText>Active — customers may see this campaign</AutoText>
        </label>
      </SectionCard>

      <div>
        <SubmitButton pendingLabel={campaign === undefined ? 'Creating…' : 'Saving…'}>
          {campaign === undefined ? 'Create campaign' : 'Save campaign'}
        </SubmitButton>
      </div>
    </form>
  );
}

/** One slide row: what it says, whether it plays, and the controls that move it. */
function SlideRow({
  slide,
  campaignId,
  order,
  index,
  csrf,
}: {
  slide: AdminOnboardingSlide;
  campaignId: string;
  order: readonly string[];
  index: number;
  csrf: CsrfInput;
}) {
  return (
    <div className="flex flex-wrap items-start gap-3 border-b border-border py-4">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-muted text-sm font-semibold text-muted-foreground">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">
          {slide.heading === '' ? (
            <span className="text-muted-foreground">
              <AutoText>No title</AutoText> · {slide.internalName}
            </span>
          ) : (
            slide.heading
          )}
          {slide.isActive ? null : (
            <span className="ml-2 rounded-full bg-surface-muted px-2 py-0.5 text-xs text-muted-foreground">
              <AutoText>Not shown</AutoText>
            </span>
          )}
        </p>
        <p className="text-sm text-muted-foreground">
          <AutoText value={slide.description} />
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {slide.imageKey === null ? 'No image' : `Image: ${slide.imageKey}`}
          {slide.ctaLabel === null ? '' : ` · Action: ${slide.ctaLabel} → ${slide.ctaPath ?? ''}`}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <form action={moveOnboardingSlideAction}>
          <CsrfField csrf={csrf} />
          <input type="hidden" name="campaignId" value={campaignId} />
          <input type="hidden" name="slideId" value={slide.id} />
          <input type="hidden" name="order" value={order.join(',')} />
          <input type="hidden" name="direction" value="up" />
          <button
            type="submit"
            disabled={index === 0}
            aria-label={`Move ${slide.heading} up`}
            className={buttonClasses({ variant: 'outline', size: 'sm', className: 'px-2' })}
          >
            <ArrowUp aria-hidden="true" className="size-4" />
          </button>
        </form>
        <form action={moveOnboardingSlideAction}>
          <CsrfField csrf={csrf} />
          <input type="hidden" name="campaignId" value={campaignId} />
          <input type="hidden" name="slideId" value={slide.id} />
          <input type="hidden" name="order" value={order.join(',')} />
          <input type="hidden" name="direction" value="down" />
          <button
            type="submit"
            disabled={index === order.length - 1}
            aria-label={`Move ${slide.heading} down`}
            className={buttonClasses({ variant: 'outline', size: 'sm', className: 'px-2' })}
          >
            <ArrowDown aria-hidden="true" className="size-4" />
          </button>
        </form>
        <Link
          href={`/admin/marketing/onboarding/${campaignId}?slide=${slide.id}` as Route}
          className={buttonClasses({ variant: 'outline', size: 'sm' })}
        >
          <AutoText>Edit</AutoText>
        </Link>
        <ConfirmForm
          action={deleteOnboardingSlideAction}
          csrf={csrf}
          trigger="Delete"
          triggerVariant="outline"
          triggerSize="sm"
          tone="danger"
          title={`Delete the slide “${slide.heading}”?`}
          description="The slide is removed from this campaign. Customers see the rest in order."
          confirmLabel="Delete slide"
          hiddenFields={{ campaignId, slideId: slide.id }}
          align="end"
        />
      </div>
    </div>
  );
}

/** All slides, in the order the app plays them. */
export function SlideList({ campaign, csrf }: { campaign: OnboardingCampaign; csrf: CsrfInput }) {
  const order = campaign.slides.map((slide) => slide.id);
  return (
    <SectionCard
      title={`Slides (${String(campaign.slides.length)})`}
      description="The app plays enabled slides in this order. At least one must be enabled before the campaign can be active."
      actions={
        <Link
          href={`/admin/marketing/onboarding/${campaign.id}?slide=new` as Route}
          className={buttonClasses({ variant: 'outline', size: 'sm' })}
        >
          <Plus aria-hidden="true" className="size-4" />
          <AutoText>Add slide</AutoText>
        </Link>
      }
    >
      {campaign.slides.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No slides yet. Add the first one — nothing is shown to customers until a slide is enabled
          and the campaign is active.
        </p>
      ) : (
        <SortableSlides campaignId={campaign.id} csrf={csrf} ids={order}>
          {campaign.slides.map((slide, index) => (
            <SlideRow
              key={slide.id}
              slide={slide}
              campaignId={campaign.id}
              order={order}
              index={index}
              csrf={csrf}
            />
          ))}
        </SortableSlides>
      )}
    </SectionCard>
  );
}

/** The slide editor, for a new slide or the one named by `?slide=`. */
export function SlideForm({
  campaignId,
  slide,
  csrf,
}: {
  campaignId: string;
  slide?: AdminOnboardingSlide | undefined;
  csrf: CsrfInput;
}) {
  return (
    <SectionCard
      title={slide === undefined ? 'New slide' : `Edit “${slide.heading}”`}
      description="Short, concrete copy works best. One idea per slide."
    >
      <form action={saveOnboardingSlideAction} className="grid gap-4">
        <CsrfField csrf={csrf} />
        <input type="hidden" name="campaignId" value={campaignId} />
        {slide === undefined ? null : <input type="hidden" name="slideId" value={slide.id} />}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="slideInternalName" label="Internal name" hint="Only staff see this.">
            <input
              id="slideInternalName"
              name="internalName"
              defaultValue={slide?.internalName ?? ''}
              maxLength={ONBOARDING_LIMITS.internalName}
              required
              className={inputClass}
            />
          </Field>
          <Field
            name="heading"
            label="Heading (optional)"
            hint="Up to 80 characters. A slide needs a heading, a description or a picture."
          >
            <input
              id="heading"
              name="heading"
              defaultValue={slide?.heading ?? ''}
              maxLength={ONBOARDING_LIMITS.heading}
              className={inputClass}
            />
          </Field>
          <Field name="description" label="Description (optional)" hint="Up to 240 characters.">
            <textarea
              id="description"
              name="description"
              defaultValue={slide?.description ?? ''}
              maxLength={ONBOARDING_LIMITS.description}
              rows={3}
              className={inputClass}
            />
          </Field>
          <MediaKeyField
            name="imageKey"
            label="Image"
            hint="The picture shown behind the slide text. Leave it empty for a text-only slide."
            defaultValue={slide?.imageKey ?? null}
            csrf={csrf}
          />
          <Field
            name="altText"
            label="Image description"
            hint="Required when the slide has an image."
          >
            <input
              id="altText"
              name="altText"
              defaultValue={slide?.altText ?? ''}
              maxLength={ONBOARDING_LIMITS.altText}
              className={inputClass}
            />
          </Field>
          <Field name="icon" label="Icon" hint="Optional, drawn by the app beside the text.">
            <select id="icon" name="icon" defaultValue={slide?.icon ?? ''} className={inputClass}>
              <option value="">
                <AutoText>No icon</AutoText>
              </option>
              {ONBOARDING_ICONS.map((value) => (
                <option key={value} value={value}>
                  {ICON_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>
          <Field
            name="ctaLabel"
            label="Action label"
            hint="Optional, for example “Browse products”."
          >
            <input
              id="ctaLabel"
              name="ctaLabel"
              defaultValue={slide?.ctaLabel ?? ''}
              maxLength={ONBOARDING_LIMITS.ctaLabel}
              className={inputClass}
            />
          </Field>
          <Field
            name="ctaPath"
            label="Action destination"
            hint="A path inside the store, for example /products."
          >
            <input
              id="ctaPath"
              name="ctaPath"
              defaultValue={slide?.ctaPath ?? ''}
              maxLength={200}
              className={inputClass}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={slide?.isActive ?? true}
            className="size-4 rounded border-border"
          />
          <AutoText>Shown to customers</AutoText>
        </label>
        <div className="flex items-center gap-3">
          <SubmitButton pendingLabel={slide === undefined ? 'Adding…' : 'Saving…'}>
            {slide === undefined ? 'Add slide' : 'Save slide'}
          </SubmitButton>
          <Link
            href={`/admin/marketing/onboarding/${campaignId}` as Route}
            className={buttonClasses({ variant: 'ghost', size: 'sm' })}
          >
            <AutoText>Close</AutoText>
          </Link>
        </div>
      </form>
    </SectionCard>
  );
}

/**
 * What a customer sees, in the customer's words.
 *
 * The preview reads the same payload the app receives, so what is shown here is what would
 * be shown on a phone — including the resolved image and the absence of internal fields.
 */
export function CampaignPreview({ campaign }: { campaign: PublicOnboarding }) {
  return (
    <div className="mx-auto grid w-full max-w-sm gap-4 rounded-3xl border border-border bg-background p-6 shadow-sm">
      {campaign.slides.map((slide) => (
        <div key={slide.id} className="grid gap-3 rounded-2xl bg-surface-muted p-4">
          {slide.imageUrl === null ? (
            <div className="grid h-32 place-items-center rounded-xl bg-surface text-muted-foreground">
              <ImageOff aria-hidden="true" className="size-6" />
              <span className="sr-only">
                <AutoText>No image on this slide</AutoText>
              </span>
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- an uploaded media asset served by the media host
            <img
              src={slide.imageUrl}
              alt={slide.altText ?? ''}
              className="h-32 w-full rounded-xl object-contain"
            />
          )}
          <p className="font-display text-lg font-semibold text-foreground">
            <AutoText value={slide.heading} />
          </p>
          <p className="text-sm text-muted-foreground">
            <AutoText value={slide.description} />
          </p>
          {slide.ctaLabel === null ? null : (
            <p className="text-sm font-semibold text-link">
              <AutoText value={slide.ctaLabel} />
            </p>
          )}
        </div>
      ))}
      <div className="flex items-center justify-center gap-1.5">
        {campaign.slides.map((slide, index) => (
          <span
            key={slide.id}
            className={
              index === 0 ? 'h-2 w-6 rounded-full bg-primary' : 'size-2 rounded-full bg-border'
            }
          />
        ))}
      </div>
      <p className="text-center text-xs text-muted-foreground">
        {campaign.slides.length} slide{campaign.slides.length === 1 ? '' : 's'} ·{' '}
        {campaign.slideSeconds} seconds each · Skip after 3 seconds
        {campaign.endsAt === null ? '' : ` · ends ${formatDateTime(campaign.endsAt)}`}
      </p>
    </div>
  );
}
