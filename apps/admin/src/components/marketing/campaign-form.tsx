'use client';

import type {
  AdminCampaignDetail,
  CampaignDiscountKind,
  CampaignScope,
  CampaignTarget,
} from '@nilzora/contracts';
import { Badge, Button, Card, Field, Input, NativeSelect, Textarea, cn } from '@nilzora/ui';
import { CalendarClock, Percent, Save, Tags } from 'lucide-react';
import { useActionState, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { MediaKeyField } from '@/components/media/media-key-field';
import { CAMPAIGN_BANNER_GUIDANCE } from '@/lib/upload-guidance';
import { saveCampaignAction } from '@/lib/campaign-actions';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/*
 * One campaign. The form is a guided page rather than a wizard: every section is visible,
 * numbered, and can be revisited in any order, which is what an administrator preparing a
 * seasonal sale actually needs. The API and its database function re-check every rule.
 */

const SCOPES: readonly { value: CampaignScope; label: string; hint: string }[] = [
  {
    value: 'categories',
    label: 'Categories',
    hint: 'One or more categories, subcategories included.',
  },
  { value: 'products', label: 'Selected products', hint: 'Hand-picked products only.' },
  { value: 'brands', label: 'Brands', hint: 'Every product of the chosen brands.' },
  {
    value: 'storewide',
    label: 'Whole catalog',
    hint: 'Every published product. Warm carefully: this reprices the whole shop.',
  },
];

/** "2026-11-01T09:00" in Bangladesh time, for a datetime-local field. */
function bdField(iso: string | null): string {
  if (iso === null) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** Taka for a money field; poisha are not shown in the form. */
function taka(minor: number | null): string {
  return minor === null ? '' : String(minor / 100);
}

function SubmitButton({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      {pending ? null : <Save aria-hidden="true" />}
      {editing ? 'Save campaign' : 'Create draft'}
    </Button>
  );
}

/** A numbered block, so the form reads as a sequence without hiding anything. */
function Step({
  step,
  title,
  description,
  children,
}: {
  step: number;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
      <header className="mb-4 flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-semibold text-primary tabular-nums"
        >
          {step}
        </span>
        <div className="grid gap-0.5">
          <h2 className="font-display text-base font-semibold text-foreground">
            <AutoText value={title} />
          </h2>
          <p className="text-sm text-muted-foreground">
            <AutoText value={description} />
          </p>
        </div>
      </header>
      <div className="grid gap-4">
        <AutoText value={children} />
      </div>
    </section>
  );
}

/** A checkbox list of targets, in two columns, with an empty hint. */
export function TargetCheckboxes({
  name,
  options,
  selected,
  emptyLabel,
}: {
  name: string;
  options: readonly CampaignTarget[];
  selected: readonly string[];
  emptyLabel: string;
}) {
  if (options.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        <AutoText value={emptyLabel} />
      </p>
    );
  }
  return (
    <ul className="grid max-h-64 gap-1 overflow-y-auto rounded-xl border border-border bg-surface-muted/40 p-2 sm:grid-cols-2">
      {options.map((option) => (
        <li key={option.id}>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface">
            <input
              type="checkbox"
              name={name}
              value={option.id}
              defaultChecked={selected.includes(option.id)}
              className="size-4 rounded border-border-strong accent-primary"
            />
            <span className="truncate text-foreground">
              <AutoText value={option.name} />
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}

/**
 * The product picker. A catalog can be large, so only a page of products is sent and the
 * administrator narrows it by typing; a selection that scrolls out of the filter stays
 * selected, and a note says so.
 */
export function ProductPicker({
  options,
  selected,
}: {
  options: readonly CampaignTarget[];
  selected: readonly string[];
}) {
  const tx = useTx();
  const [query, setQuery] = useState('');
  const [checked, setChecked] = useState<readonly string[]>(selected);
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return options;
    return options.filter(
      (option) => option.name.toLowerCase().includes(needle) || option.slug.includes(needle),
    );
  }, [options, query]);

  return (
    <div className="grid gap-2">
      <Input
        aria-label={tx('Filter products')}
        placeholder={tx('Type to filter by name or address')}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
      />
      <p className="text-xs text-muted-foreground">
        {checked.length === 0
          ? 'No products chosen yet.'
          : `${String(checked.length)} chosen${query.trim() === '' ? '' : ', including any hidden by the filter'}.`}
      </p>
      {matches.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <AutoText>No product matches that search.</AutoText>
        </p>
      ) : (
        <ul className="grid max-h-64 gap-1 overflow-y-auto rounded-xl border border-border bg-surface-muted/40 p-2">
          {matches.map((option) => (
            <li key={option.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface">
                <input
                  type="checkbox"
                  name="productIds"
                  value={option.id}
                  checked={checked.includes(option.id)}
                  onChange={(event) => {
                    setChecked((current) =>
                      event.target.checked
                        ? [...current, option.id]
                        : current.filter((id) => id !== option.id),
                    );
                  }}
                  className="size-4 rounded border-border-strong accent-primary"
                />
                <span className="truncate text-foreground">
                  <AutoText value={option.name} />
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  <AutoText value={option.slug} />
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface CampaignFormProps {
  /** Present when editing; the form then keeps the same campaign. */
  campaign?: AdminCampaignDetail | undefined;
  categories: readonly CampaignTarget[];
  brands: readonly CampaignTarget[];
  products: readonly CampaignTarget[];
  /** True when the catalogue holds more products than were sent for the picker. */
  productsTruncated: boolean;
  /** Categories to start with, e.g. from a category screen's "Create category sale". */
  defaultCategoryIds?: readonly string[];
  csrf: CsrfInput;
}

export function CampaignForm({
  campaign,
  categories,
  brands,
  products,
  productsTruncated,
  defaultCategoryIds = [],
  csrf,
}: CampaignFormProps) {
  const tx = useTx();
  const [state, action] = useActionState(saveCampaignAction, IDLE_STATE);
  const values = state.values;
  const editing = campaign !== undefined;

  const scope = (values?.scope ?? campaign?.scope ?? 'categories') as CampaignScope;
  const kind = (values?.discountKind ??
    campaign?.discountKind ??
    'percent') as CampaignDiscountKind;
  const categoryIds = values?.categoryIds
    ? values.categoryIds.split(',')
    : (campaign?.categories.map((entry) => entry.id) ?? [...defaultCategoryIds]);
  const brandIds = values?.brandIds
    ? values.brandIds.split(',')
    : (campaign?.brands.map((entry) => entry.id) ?? []);
  const productIds = values?.productIds
    ? values.productIds.split(',')
    : (campaign?.products.map((entry) => entry.id) ?? []);

  return (
    <form action={action} className="grid gap-5">
      <CsrfField csrf={csrf} />
      {editing ? <input type="hidden" name="campaignId" value={campaign.id} /> : null}
      {editing ? (
        <input type="hidden" name="expectedVersion" value={String(campaign.version)} />
      ) : null}

      <Step
        step={1}
        title={tx('Name and message')}
        description={tx('The internal name is for your team; the title is what shoppers read.')}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="campaign-name"
            label={tx('Campaign name')}
            error={state.fieldErrors?.name}
            required
          >
            {(control) => (
              <Input
                {...control}
                name="name"
                defaultValue={values?.name ?? campaign?.name ?? ''}
                maxLength={120}
                placeholder={tx('Winter Sale 2026')}
              />
            )}
          </Field>
          <Field
            id="campaign-title"
            label={tx('Customer-facing title')}
            hint={tx(
              'Optional. Shown on the banner and beside the price; leave it empty and the offer alone is shown.',
            )}
            error={state.fieldErrors?.customerTitle}
          >
            {(control) => (
              <Input
                {...control}
                name="customerTitle"
                defaultValue={values?.customerTitle ?? campaign?.customerTitle ?? ''}
                maxLength={120}
                placeholder={tx('Winter Collection Sale')}
              />
            )}
          </Field>
        </div>
        <Field
          id="campaign-notes"
          label={tx('Internal notes')}
          hint={tx('Only your team sees this. Leave it empty if there is nothing to remember.')}
          error={state.fieldErrors?.internalNotes}
        >
          {(control) => (
            <Textarea
              {...control}
              name="internalNotes"
              rows={2}
              maxLength={500}
              defaultValue={values?.internalNotes ?? campaign?.internalNotes ?? ''}
              placeholder={tx('Agreed with the supplier on 12 November.')}
            />
          )}
        </Field>
      </Step>

      <Step
        step={2}
        title={tx('What it covers')}
        description={tx('A product is priced by the most specific campaign that reaches it.')}
      >
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium text-foreground">
            <AutoText>Scope</AutoText>
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {SCOPES.map((option) => (
              <label
                key={option.value}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm transition-colors',
                  scope === option.value
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-surface hover:border-border-strong',
                )}
              >
                <input
                  type="radio"
                  name="scope"
                  value={option.value}
                  defaultChecked={scope === option.value}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span className="grid gap-0.5">
                  <span className="font-medium text-foreground">
                    <AutoText value={option.label} />
                  </span>
                  <span className="text-xs text-muted-foreground">
                    <AutoText value={option.hint} />
                  </span>
                </span>
              </label>
            ))}
          </div>
          {state.fieldErrors?.scope ? (
            <p className="text-sm text-danger">
              <AutoText value={state.fieldErrors.scope} />
            </p>
          ) : null}
        </fieldset>

        <div className="grid gap-3">
          <div className="grid gap-1">
            <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Tags aria-hidden="true" className="size-4" /> Categories
            </p>
            <p className="text-xs text-muted-foreground">
              <AutoText>A chosen category also covers its subcategories.</AutoText>
            </p>
          </div>
          <TargetCheckboxes
            name="categoryIds"
            options={categories}
            selected={categoryIds}
            emptyLabel="No categories exist yet."
          />
          {state.fieldErrors?.categoryIds ? (
            <p className="text-sm text-danger">
              <AutoText value={state.fieldErrors.categoryIds} />
            </p>
          ) : null}
        </div>

        <div className="grid gap-1">
          <p className="text-sm font-medium text-foreground">
            <AutoText>Brands</AutoText>
          </p>
          <TargetCheckboxes
            name="brandIds"
            options={brands}
            selected={brandIds}
            emptyLabel="No brands exist yet."
          />
          {state.fieldErrors?.brandIds ? (
            <p className="text-sm text-danger">
              <AutoText value={state.fieldErrors.brandIds} />
            </p>
          ) : null}
        </div>

        <div className="grid gap-1">
          <p className="text-sm font-medium text-foreground">
            <AutoText>Selected products</AutoText>
          </p>
          {productsTruncated ? (
            <p className="text-xs text-muted-foreground">
              Only the newest products are listed here. For a large selection, target a category or
              a brand instead.
            </p>
          ) : null}
          <ProductPicker options={products} selected={productIds} />
          {state.fieldErrors?.productIds ? (
            <p className="text-sm text-danger">
              <AutoText value={state.fieldErrors.productIds} />
            </p>
          ) : null}
        </div>
      </Step>

      <Step
        step={3}
        title={tx('The discount')}
        description={tx(
          "Taken off each product's list price. The product's own sale price is never changed.",
        )}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="campaign-kind" label={tx('Discount type')} required>
            {(control) => (
              <NativeSelect {...control} name="discountKind" defaultValue={kind}>
                <option value="percent">
                  <AutoText>Percentage off</AutoText>
                </option>
                <option value="fixed">
                  <AutoText>Fixed amount off</AutoText>
                </option>
              </NativeSelect>
            )}
          </Field>
          <Field
            id="campaign-value"
            label={kind === 'fixed' ? 'Amount off (৳)' : 'Percentage off (%)'}
            error={state.fieldErrors?.discountValue}
            required
          >
            {(control) => (
              <Input
                {...control}
                name="discountValue"
                type="number"
                min={1}
                max={kind === 'percent' ? 100 : undefined}
                step={kind === 'percent' ? 1 : '0.01'}
                inputMode="decimal"
                defaultValue={
                  values?.discountValue ??
                  (editing
                    ? campaign.discountKind === 'fixed'
                      ? taka(campaign.discountValue)
                      : String(campaign.discountValue)
                    : '')
                }
              />
            )}
          </Field>
          <Field
            id="campaign-cap"
            label={tx('Maximum discount (৳)')}
            hint={kind === 'fixed' ? 'A fixed discount needs no cap.' : 'Optional.'}
            error={state.fieldErrors?.maxDiscountMinor}
          >
            {(control) => (
              <Input
                {...control}
                name="maxDiscountMinor"
                type="number"
                min={1}
                step="0.01"
                inputMode="decimal"
                disabled={kind === 'fixed'}
                defaultValue={values?.maxDiscountMinor ?? taka(campaign?.maxDiscountMinor ?? null)}
              />
            )}
          </Field>
        </div>
      </Step>

      <Step
        step={4}
        title={tx('When it runs')}
        description={tx(
          'Dates are Bangladesh time. A campaign stops applying by itself at its end.',
        )}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="campaign-start" label={tx('Starts')} error={state.fieldErrors?.startsAt}>
            {(control) => (
              <Input
                {...control}
                name="startsAt"
                type="datetime-local"
                defaultValue={bdField(campaign?.startsAt ?? null)}
              />
            )}
          </Field>
          <Field id="campaign-end" label={tx('Ends')} error={state.fieldErrors?.endsAt}>
            {(control) => (
              <Input
                {...control}
                name="endsAt"
                type="datetime-local"
                defaultValue={bdField(campaign?.endsAt ?? null)}
              />
            )}
          </Field>
          <Field
            id="campaign-priority"
            label={tx('Priority')}
            hint={tx('From −100 to 100. Higher wins inside the same scope.')}
            error={state.fieldErrors?.priority}
          >
            {(control) => (
              <Input
                {...control}
                name="priority"
                type="number"
                min={-100}
                max={100}
                step={1}
                defaultValue={values?.priority ?? String(campaign?.priority ?? 0)}
              />
            )}
          </Field>
        </div>
        <Card className="border-border bg-surface-muted/50 p-3 shadow-none">
          <p className="text-sm text-foreground">
            <span className="font-medium">Precedence: </span>a product campaign beats a category
            campaign, which beats a brand campaign, which beats a whole-catalog campaign. Inside one
            level the higher priority wins, then the older campaign. Discounts never stack.
          </p>
        </Card>
      </Step>

      <Step
        step={5}
        title={tx('Eligibility and coupons')}
        description={tx('What a shopper may combine with this promotion.')}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="campaign-coupons"
            label={tx('Coupons')}
            hint={tx('Blocked means a coupon cannot be used on a cart holding these products.')}
          >
            {(control) => (
              <NativeSelect
                {...control}
                name="couponPolicy"
                defaultValue={values?.couponPolicy ?? campaign?.couponPolicy ?? 'stackable'}
              >
                <option value="stackable">
                  <AutoText>Coupons may be used with this campaign</AutoText>
                </option>
                <option value="blocked">
                  <AutoText>No coupon on these products</AutoText>
                </option>
              </NativeSelect>
            )}
          </Field>
          <MediaKeyField
            name="bannerImageKey"
            label={tx('Banner picture')}
            hint={tx(
              'Optional. Shown at the top of the customer website’s promotional band (and beside the products on sale). Choose from the media library or upload a picture: an upload is cropped to the 12:5 frame before it is saved. The discount applies with or without a picture.',
            )}
            defaultValue={values?.bannerImageKey ?? campaign?.bannerImageKey ?? null}
            previewUrl={campaign?.banner?.thumbUrl ?? null}
            csrf={csrf}
            guidance={CAMPAIGN_BANNER_GUIDANCE}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            name="isVisible"
            defaultChecked={
              values === undefined ? (campaign?.isVisible ?? true) : values.isVisible === 'on'
            }
            className="size-4 rounded border-border-strong accent-primary"
          />
          <AutoText>Show this campaign&rsquo;s banner and price label on the storefront</AutoText>
        </label>
      </Step>

      <ActionFeedback state={state} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarClock aria-hidden="true" className="size-3.5" />A new campaign is saved as a
          draft and reprices nothing until it is activated.
        </p>
        <div className="flex items-center gap-2">
          {editing && campaign.status === 'active' ? (
            <Badge tone="success" dot>
              <AutoText>Live</AutoText>
            </Badge>
          ) : null}
          <SubmitButton editing={editing} />
        </div>
      </div>

      {kind === 'fixed' ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Percent aria-hidden="true" className="size-3.5" />A fixed amount never takes a product
          below ৳0.01.
        </p>
      ) : null}
    </form>
  );
}
