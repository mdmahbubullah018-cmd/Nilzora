'use client';

import type { OrderItem } from '@nilzora/contracts';
import { Button, Field, NativeSelect, Textarea } from '@nilzora/ui';
import { useActionState } from 'react';
import {
  CsrfInput,
  FormMessage,
  IDLE_STATE,
  type CsrfField,
  type FormAction,
  type FormStatusProps,
} from '../auth/form-kit';

const MAX_DESCRIPTION_LENGTH = 1000;

/** Reasons the form offers; the API accepts any text of 3–120 characters. */
const REASONS = [
  'The item arrived damaged',
  'The item is not what I ordered',
  'The size or fit is wrong',
  'The item stopped working',
  'I changed my mind',
];

export type ReturnRequestFormViewProps = {
  csrf: CsrfField;
  orderNumber: string;
  items: readonly OrderItem[];
} & FormStatusProps;

/**
 * One field per order line, each asking how many units are coming back. A line left at
 * "None" is not returned, so the form never sends a quantity the customer did not choose.
 */
export function ReturnRequestFormView({
  csrf,
  orderNumber,
  items,
  state,
  formAction,
  pending,
}: ReturnRequestFormViewProps) {
  const errors = state.fieldErrors ?? {};
  return (
    <form action={formAction} className="grid gap-5">
      <FormMessage state={state} />
      <CsrfInput csrf={csrf} />
      <input type="hidden" name="orderNumber" value={orderNumber} />
      {items.map((item) => (
        <fieldset key={item.orderItemId} className="grid gap-2 rounded-lg border p-4">
          <legend className="px-1 text-sm font-medium text-slate-900">
            {item.productName}
            {item.variantLabel === null ? null : ` · ${item.variantLabel}`}
          </legend>
          <p className="text-sm text-slate-600">
            You bought {item.quantity} · SKU {item.sku}
          </p>
          <Field
            id={`quantity-${String(item.orderItemId)}`}
            label="How many are coming back?"
            className="w-40"
            error={errors[`items.${String(item.orderItemId)}`]}
          >
            {(control) => (
              <NativeSelect
                {...control}
                name={`quantity-${String(item.orderItemId)}`}
                defaultValue="0"
              >
                {Array.from({ length: item.quantity + 1 }, (_, count) => (
                  <option key={count} value={String(count)}>
                    {count === 0 ? 'None' : String(count)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        </fieldset>
      ))}

      <Field id="return-reason" label="Why are you sending it back?" error={errors.reason}>
        {(control) => (
          <NativeSelect {...control} name="reason" defaultValue={REASONS[0]}>
            {REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {reason}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>

      <Field
        id="return-description"
        label="Anything else we should know? (optional)"
        hint={`Up to ${MAX_DESCRIPTION_LENGTH} characters.`}
        error={errors.description}
      >
        {(control) => (
          <Textarea
            {...control}
            name="description"
            rows={4}
            maxLength={MAX_DESCRIPTION_LENGTH}
            defaultValue={state.values?.description ?? ''}
          />
        )}
      </Field>

      <Button type="submit" loading={pending}>
        Send the request
      </Button>
    </form>
  );
}

export function ReturnRequestForm({
  action,
  ...fields
}: Omit<ReturnRequestFormViewProps, keyof FormStatusProps> & { action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, IDLE_STATE);
  return (
    <ReturnRequestFormView {...fields} state={state} formAction={formAction} pending={pending} />
  );
}
