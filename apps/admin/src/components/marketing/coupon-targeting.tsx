'use client';

import type { CouponTargeting } from '@nilzora/contracts';
import { Field, Input, NativeSelect } from '@nilzora/ui';
import { Ticket } from 'lucide-react';
import { useState } from 'react';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { ProductPicker, TargetCheckboxes } from './campaign-form';
import { CustomerPicker } from './customer-picker';
import type { CampaignTargets } from './load-campaigns';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/*
 * Who and what a coupon applies to, and whether customers collect it as a voucher. The
 * database enforces every rule again (permission, existing targets, collection cap); this
 * section only gathers the choice. Without the catalogue (it could not be read) the section
 * says so and the form leaves the current targeting untouched.
 */

type Scope = CouponTargeting['scope'];
type Audience = CouponTargeting['audience'];

export function CouponTargetingFields({
  targeting,
  targets,
  errors,
  csrf,
  canPickCustomers = false,
}: {
  targeting: CouponTargeting | undefined;
  targets: CampaignTargets | null;
  errors: Partial<Record<string, string>> | undefined;
  csrf: CsrfInput;
  /** customers.read: the picker can search customers. */
  canPickCustomers?: boolean;
}) {
  const tx = useTx();
  const [isVoucher, setIsVoucher] = useState(targeting?.isVoucher ?? false);
  const [scope, setScope] = useState<Scope>(targeting?.scope ?? 'storewide');
  const [audience, setAudience] = useState<Audience>(targeting?.audience ?? 'all');

  if (targets === null) {
    return (
      <p className="rounded-xl border border-hairline bg-warning-soft px-4 py-3 text-sm text-warning-ink">
        The catalogue could not be loaded, so voucher and targeting settings are not shown. Saving
        keeps the coupon&apos;s current settings. Reload the page to change them.
      </p>
    );
  }

  return (
    <fieldset className="grid gap-5 rounded-2xl border border-hairline p-4 sm:p-5">
      <legend className="px-1 text-sm font-semibold text-foreground">
        <AutoText>Voucher and eligibility</AutoText>
      </legend>
      <input type="hidden" name="targetingLoaded" value="1" />

      <label className="flex items-start gap-3 rounded-xl border border-hairline bg-info-soft/40 p-3">
        <input
          type="checkbox"
          name="isVoucher"
          checked={isVoucher}
          onChange={(event) => {
            setIsVoucher(event.target.checked);
          }}
          className="mt-0.5 size-5 shrink-0 accent-primary-action"
        />
        <span className="grid gap-0.5">
          <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <Ticket aria-hidden="true" className="size-4" /> Show as a collectible voucher
          </span>
          <span className="text-xs text-muted-foreground">
            Customers collect it in the Voucher Center and choose it at checkout. Only customers who
            collected it can use it. An order takes one voucher or one code, never both.
          </span>
        </span>
      </label>

      {isVoucher ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="voucher-title"
            label={tx('Voucher title')}
            hint={tx('What the Voucher Center shows, e.g. “Eid special: 10% off shoes”.')}
            error={errors?.title}
          >
            {(control) => (
              <Input
                {...control}
                name="title"
                maxLength={80}
                defaultValue={targeting?.title ?? ''}
              />
            )}
          </Field>
          <Field
            id="voucher-collect-limit"
            label={tx('Collection limit')}
            hint={tx('How many customers may collect it. Empty means no limit.')}
            error={errors?.collectLimit}
          >
            {(control) => (
              <Input
                {...control}
                name="collectLimit"
                inputMode="numeric"
                defaultValue={
                  targeting?.collectLimit === null || targeting === undefined
                    ? ''
                    : String(targeting.collectLimit)
                }
              />
            )}
          </Field>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="coupon-scope" label={tx('Applies to')} error={errors?.scope}>
          {(control) => (
            <NativeSelect
              {...control}
              name="scope"
              value={scope}
              onChange={(event) => {
                setScope(event.target.value as Scope);
              }}
            >
              <option value="storewide">
                <AutoText>Everything in the store</AutoText>
              </option>
              <option value="categories">
                <AutoText>Selected categories</AutoText>
              </option>
              <option value="products">
                <AutoText>Selected products</AutoText>
              </option>
            </NativeSelect>
          )}
        </Field>
        <Field
          id="coupon-audience"
          label={tx('Customers')}
          hint={tx('New customers have no orders yet (cancelled orders do not count).')}
          error={errors?.audience}
        >
          {(control) => (
            <NativeSelect
              {...control}
              name="audience"
              value={audience}
              onChange={(event) => {
                setAudience(event.target.value as Audience);
              }}
            >
              <option value="all">
                <AutoText>Everyone</AutoText>
              </option>
              <option value="new_customers">
                <AutoText>New customers only</AutoText>
              </option>
              <option value="returning_customers">
                <AutoText>Returning customers only</AutoText>
              </option>
              <option value="selected_customers">
                <AutoText>Chosen customers only</AutoText>
              </option>
            </NativeSelect>
          )}
        </Field>
      </div>

      {audience === 'selected_customers' ? (
        <div className="grid gap-2">
          <p className="text-sm font-medium text-foreground">
            <AutoText>Customers who can use it</AutoText>
          </p>
          <CustomerPicker
            selected={targeting?.customers ?? []}
            csrf={csrf}
            canSearch={canPickCustomers}
            error={errors?.customerIds}
          />
        </div>
      ) : null}

      {scope === 'categories' ? (
        <div className="grid gap-2">
          <p className="text-sm font-medium text-foreground">
            <AutoText>Categories</AutoText>
          </p>
          <p className="text-xs text-muted-foreground">
            A chosen category also covers its subcategories. The minimum spend and the discount
            count only these items.
          </p>
          <TargetCheckboxes
            name="categoryIds"
            options={targets.categories}
            selected={targeting?.categoryIds ?? []}
            emptyLabel="No categories exist yet."
          />
          {errors?.categoryIds ? (
            <p className="text-sm text-danger-ink">
              <AutoText value={errors.categoryIds} />
            </p>
          ) : null}
        </div>
      ) : null}

      {scope === 'products' ? (
        <div className="grid gap-2">
          <p className="text-sm font-medium text-foreground">
            <AutoText>Products</AutoText>
          </p>
          <p className="text-xs text-muted-foreground">
            The minimum spend and the discount count only these products.
            {targets.productsTruncated
              ? ' Only the first page of products is listed; filter by name.'
              : ''}
          </p>
          <ProductPicker options={targets.products} selected={targeting?.productIds ?? []} />
          {errors?.productIds ? (
            <p className="text-sm text-danger-ink">
              <AutoText value={errors.productIds} />
            </p>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
}
