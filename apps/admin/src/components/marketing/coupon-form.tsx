'use client';

import type { AdminCoupon } from '@nilzora/contracts';
import { Button, Field, Input, NativeSelect, Textarea } from '@nilzora/ui';
import { Lock, Save } from 'lucide-react';
import Link from 'next/link';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { saveCouponAction } from '@/lib/coupon-actions';
import { CouponTargetingFields } from './coupon-targeting';
import type { CampaignTargets } from './load-campaigns';
import { formatMoney } from '@/lib/format';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/** Taka for a money field; poisha are not shown in the form. */
function taka(minor: number | null): string {
  if (minor === null) return '';
  return String(minor / 100);
}

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

function SubmitButton({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} className="max-sm:min-h-11">
      {pending ? null : <Save aria-hidden="true" />}
      {editing ? 'Save coupon' : 'Create coupon'}
    </Button>
  );
}

export interface CouponFormProps {
  /** Present when editing; the form then keeps the same coupon. */
  coupon?: AdminCoupon;
  csrf: CsrfInput;
  /** Categories and products for targeting; null when the catalogue could not be read. */
  targets?: CampaignTargets | null;
  /** customers.read: the customer picker can search. */
  canPickCustomers?: boolean;
}

/**
 * One coupon. Values are checked in the browser for a quick answer and again by the
 * API's database function, which is the authority on every rule.
 */
export function CouponForm({
  coupon,
  csrf,
  targets = null,
  canPickCustomers = false,
}: CouponFormProps) {
  const tx = useTx();
  const [state, action] = useActionState(saveCouponAction, IDLE_STATE);
  const values = state.values;
  const editing = coupon !== undefined;
  const [kind, setKind] = useState<'percent' | 'fixed' | 'free_delivery'>(
    values?.kind === 'fixed' || values?.kind === 'free_delivery' || values?.kind === 'percent'
      ? values.kind
      : (coupon?.kind ?? 'percent'),
  );
  const code = values?.code ?? coupon?.code ?? '';
  // Once an order redeemed the coupon, its code and discount are what those orders were
  // priced with: the database refuses to change them, so the form shows them as fixed.
  const locked = coupon !== undefined && coupon.redemptionCount > 0;

  return (
    <form action={action} className="grid gap-6">
      <CsrfField csrf={csrf} />
      {editing ? <input type="hidden" name="couponId" value={coupon.id} /> : null}
      {locked ? (
        <div
          role="note"
          className="flex items-start gap-3 rounded-xl border border-hairline bg-info-soft/60 p-3 text-sm text-body"
        >
          <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-link" />
          <p>
            <span className="font-medium text-foreground">
              Used in {String(coupon.redemptionCount)}{' '}
              {coupon.redemptionCount === 1 ? 'order' : 'orders'}.
            </span>{' '}
            The code, discount type, amount and cap are locked, because those orders were priced
            with them. You can still change the dates, limits, minimum subtotal, who can use it and
            whether it is active. To offer different terms, create a new coupon. Past orders and
            their redemption records never change.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="coupon-code"
          label={tx('Code')}
          hint={
            locked
              ? 'Locked: orders already used this code.'
              : 'Shoppers type this at checkout. Letters, digits, dashes and underscores.'
          }
          error={state.fieldErrors?.code}
          required
        >
          {(control) => (
            <Input
              {...control}
              name="code"
              defaultValue={code}
              readOnly={locked}
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={32}
              className="font-mono uppercase max-sm:h-11"
              placeholder={tx('EID25')}
            />
          )}
        </Field>

        <Field
          id="coupon-kind"
          label={tx('Discount type')}
          error={state.fieldErrors?.kind}
          required
        >
          {(control) => (
            <>
              <NativeSelect
                {...control}
                name={locked ? undefined : 'kind'}
                value={kind}
                onChange={(event) => {
                  const next = event.currentTarget.value;
                  if (next === 'fixed' || next === 'free_delivery' || next === 'percent')
                    setKind(next);
                }}
                disabled={locked}
              >
                <option value="percent">
                  <AutoText>Percentage off</AutoText>
                </option>
                <option value="fixed">
                  <AutoText>Fixed amount off</AutoText>
                </option>
                <option value="free_delivery">
                  <AutoText>Free delivery</AutoText>
                </option>
              </NativeSelect>
              {/* A disabled select is not submitted: the locked type travels in this field. */}
              {locked ? <input type="hidden" name="kind" value={kind} /> : null}
            </>
          )}
        </Field>

        {kind === 'free_delivery' ? (
          <p
            role="note"
            className="rounded-xl border border-hairline bg-info-soft/60 p-3 text-sm text-body sm:col-span-2"
          >
            <AutoText>
              Free delivery waives the delivery charge on the order. The goods are still paid for,
              the minimum subtotal and the limits below still apply, and it never takes anything off
              the goods themselves.
            </AutoText>
          </p>
        ) : null}

        {kind === 'free_delivery' ? (
          <input type="hidden" name="value" value="1" />
        ) : (
          <>
            <Field
              id="coupon-value"
              label={kind === 'fixed' ? 'Amount off (৳)' : 'Percentage off (%)'}
              hint={
                kind === 'fixed'
                  ? 'Taken off the subtotal, never more than it.'
                  : 'A whole number from 1 to 100.'
              }
              error={state.fieldErrors?.value}
              required
            >
              {(control) => (
                <Input
                  {...control}
                  className="max-sm:h-11"
                  name="value"
                  type="number"
                  readOnly={locked}
                  min={1}
                  max={kind === 'percent' ? 100 : undefined}
                  step={kind === 'percent' ? 1 : '0.01'}
                  inputMode="decimal"
                  defaultValue={
                    values?.value ??
                    (coupon === undefined
                      ? ''
                      : coupon.kind === 'percent'
                        ? String(coupon.value)
                        : taka(coupon.value))
                  }
                />
              )}
            </Field>

            <Field
              id="coupon-cap"
              label={tx('Most it can take off (৳)')}
              hint={
                kind === 'fixed' ? 'Not used for a fixed amount.' : 'Optional, for large orders.'
              }
              error={state.fieldErrors?.maxDiscountMinor}
            >
              {(control) => (
                <Input
                  {...control}
                  className="max-sm:h-11"
                  name="maxDiscountMinor"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  disabled={kind === 'fixed'}
                  readOnly={locked}
                  defaultValue={values?.maxDiscountMinor ?? taka(coupon?.maxDiscountMinor ?? null)}
                />
              )}
            </Field>
          </>
        )}

        <Field
          id="coupon-min-order"
          label={tx('Minimum subtotal (৳)')}
          hint={tx('Optional: the cart must reach this before the code applies.')}
          error={state.fieldErrors?.minOrderMinor}
        >
          {(control) => (
            <Input
              {...control}
              className="max-sm:h-11"
              name="minOrderMinor"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              defaultValue={values?.minOrderMinor ?? taka(coupon?.minOrderMinor ?? 0)}
            />
          )}
        </Field>

        <Field
          id="coupon-per-customer"
          label={tx('Uses per customer')}
          hint={tx('Usually 1.')}
          error={state.fieldErrors?.perCustomerLimit}
          required
        >
          {(control) => (
            <Input
              {...control}
              className="max-sm:h-11"
              name="perCustomerLimit"
              type="number"
              min={1}
              max={1000}
              step={1}
              inputMode="numeric"
              defaultValue={values?.perCustomerLimit ?? String(coupon?.perCustomerLimit ?? 1)}
            />
          )}
        </Field>

        <Field
          id="coupon-total-limit"
          label={tx('Total uses')}
          hint={tx('Leave empty for unlimited.')}
          error={state.fieldErrors?.totalLimit}
        >
          {(control) => (
            <Input
              {...control}
              className="max-sm:h-11"
              name="totalLimit"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              defaultValue={
                values?.totalLimit ??
                (coupon?.totalLimit === null || coupon === undefined
                  ? ''
                  : String(coupon.totalLimit))
              }
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="coupon-starts" label={tx('Starts')} error={state.fieldErrors?.startsAt}>
            {(control) => (
              <Input
                {...control}
                className="max-sm:h-11"
                name="startsAt"
                type="datetime-local"
                defaultValue={values?.startsAt ?? bdField(coupon?.startsAt ?? null)}
              />
            )}
          </Field>
          <Field id="coupon-ends" label={tx('Ends')} error={state.fieldErrors?.endsAt}>
            {(control) => (
              <Input
                {...control}
                className="max-sm:h-11"
                name="endsAt"
                type="datetime-local"
                defaultValue={values?.endsAt ?? bdField(coupon?.endsAt ?? null)}
              />
            )}
          </Field>
        </div>

        <Field
          id="coupon-description"
          label={tx('Note for the team')}
          hint={tx('Optional. Shown in the admin list, never to shoppers.')}
          error={state.fieldErrors?.description}
          className="sm:col-span-2"
        >
          {(control) => (
            <Textarea
              {...control}
              name="description"
              rows={2}
              maxLength={200}
              defaultValue={values?.description ?? coupon?.description ?? ''}
            />
          )}
        </Field>
      </div>

      <CouponTargetingFields
        targeting={coupon?.targeting}
        targets={targets}
        errors={state.fieldErrors}
        csrf={csrf}
        canPickCustomers={canPickCustomers}
      />

      <label className="flex items-start gap-3 rounded-xl border border-hairline bg-neutral-soft/50 p-3">
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={coupon?.isActive ?? true}
          className="mt-0.5 size-5 shrink-0 accent-primary-action"
        />
        <span className="grid gap-0.5">
          <span className="text-sm font-medium text-foreground">
            <AutoText>Active</AutoText>
          </span>
          <span className="text-xs text-muted-foreground">
            <AutoText>
              Only an active coupon inside its dates and under its limits applies at checkout.
            </AutoText>
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton editing={editing} />
        {editing ? (
          <p className="text-xs text-muted-foreground">
            Discounts already given stay on their orders: {formatMoney(coupon.totalDiscountMinor)}{' '}
            across {String(coupon.redemptionCount)}{' '}
            {coupon.redemptionCount === 1 ? 'order' : 'orders'}.
          </p>
        ) : null}
      </div>

      <ActionFeedback state={state} />
      {state.status === 'success' ? (
        <Link
          href="/admin/coupons"
          className="w-fit text-sm font-medium text-link underline-offset-4 hover:underline"
        >
          <AutoText>Back to all coupons</AutoText>
        </Link>
      ) : null}
    </form>
  );
}
