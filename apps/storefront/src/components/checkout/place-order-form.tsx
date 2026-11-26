'use client';

import { Button, Field, Textarea } from '@nilzora/ui';
import Link from 'next/link';
import { useActionState } from 'react';
import { ORDER_NOT_CONFIRMED } from '@/lib/checkout-messages';
import { formatMoney } from '@/lib/format';
import {
  CsrfInput,
  FormMessage,
  IDLE_STATE,
  type CsrfField,
  type FormAction,
  type FormStatusProps,
} from '../auth/form-kit';

const MAX_NOTE_LENGTH = 500;

interface PlaceOrderFields {
  csrf: CsrfField;
  addressId: string;
  /** The quoted total the customer is confirming; the API refuses a different one. */
  expectedTotalMinor: number;
  /** The coupon the quote applied; the order transaction prices it again. */
  couponCode?: string | undefined;
  /**
   * A fresh key from this page render. After an error the action echoes the key it
   * used and the form keeps sending that one, so a retry can never place a second order.
   */
  idempotencyKey: string;
}

export type PlaceOrderFormViewProps = PlaceOrderFields & FormStatusProps;

export function PlaceOrderFormView({
  csrf,
  addressId,
  expectedTotalMinor,
  couponCode,
  idempotencyKey,
  state,
  formAction,
  pending,
}: PlaceOrderFormViewProps) {
  // A message about another address (the customer chose "Deliver here" since) is stale.
  const current = state.values?.addressId === undefined || state.values.addressId === addressId;
  const errors = current ? (state.fieldErrors ?? {}) : {};
  return (
    <form action={formAction} className="grid gap-5">
      {current ? <FormMessage state={state} /> : null}
      {current && state.message === ORDER_NOT_CONFIRMED ? (
        <Link
          href="/account/orders"
          className="-mt-2 justify-self-start text-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Open Your orders
        </Link>
      ) : null}
      <CsrfInput csrf={csrf} />
      <input type="hidden" name="addressId" value={addressId} />
      <input type="hidden" name="expectedTotalMinor" value={String(expectedTotalMinor)} />
      {couponCode === undefined ? null : (
        <input type="hidden" name="couponCode" value={couponCode} />
      )}
      <input
        type="hidden"
        name="idempotencyKey"
        value={state.values?.idempotencyKey ?? idempotencyKey}
      />

      <Field
        id="checkout-note"
        label="Note for delivery (optional)"
        hint={`For example, a good time to call. Up to ${MAX_NOTE_LENGTH} characters.`}
        error={errors.note}
      >
        {(control) => (
          <Textarea
            {...control}
            name="note"
            rows={3}
            maxLength={MAX_NOTE_LENGTH}
            defaultValue={state.values?.note ?? ''}
          />
        )}
      </Field>

      <Button type="submit" size="lg" loading={pending} className="w-full">
        Place order
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        You pay {formatMoney(expectedTotalMinor)} in cash when your order is delivered.
      </p>
      <p className="text-center text-xs text-muted-foreground">
        By placing this order you agree to the{' '}
        <Link href="/terms" className="font-medium text-link underline-offset-4 hover:underline">
          Terms of service
        </Link>
        , including paying in cash on delivery, and the{' '}
        <Link
          href="/help/returns"
          className="font-medium text-link underline-offset-4 hover:underline"
        >
          Returns and refunds policy
        </Link>
        .
      </p>
    </form>
  );
}

export function PlaceOrderForm({ action, ...fields }: PlaceOrderFields & { action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, IDLE_STATE);
  return <PlaceOrderFormView {...fields} state={state} formAction={formAction} pending={pending} />;
}
