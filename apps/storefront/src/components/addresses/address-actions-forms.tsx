'use client';

import { Button, buttonClasses } from '@nilzora/ui';
import { Star, Trash2 } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useActionState } from 'react';
import {
  CsrfInput,
  FormMessage,
  IDLE_STATE,
  type CsrfField,
  type FormAction,
  type FormStatusProps,
} from '../auth/form-kit';

/*
 * One-button address forms. Both post the address id with the CSRF token; success
 * redirects (the list shows a notice), so only failures come back as messages.
 */

interface AddressButtonFields {
  csrf: CsrfField;
  addressId: string;
  /** Names the address for assistive technology, e.g. "Home · Dhanmondi, Dhaka". */
  addressName: string;
}

export type AddressButtonViewProps = AddressButtonFields & FormStatusProps;

export function MakeDefaultFormView({
  csrf,
  addressId,
  addressName,
  state,
  formAction,
  pending,
}: AddressButtonViewProps) {
  return (
    <form action={formAction} className="grid justify-items-start gap-3">
      <FormMessage state={state} />
      <CsrfInput csrf={csrf} />
      <input type="hidden" name="addressId" value={addressId} />
      <Button type="submit" variant="ghost" size="sm" loading={pending}>
        {pending ? null : <Star aria-hidden="true" />}
        Make default<span className="sr-only">: {addressName}</span>
      </Button>
    </form>
  );
}

export function MakeDefaultForm({
  action,
  ...fields
}: AddressButtonFields & { action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, IDLE_STATE);
  return (
    <MakeDefaultFormView {...fields} state={state} formAction={formAction} pending={pending} />
  );
}

interface DeleteAddressFields extends AddressButtonFields {
  /** Where "Keep address" leads: nothing is deleted. */
  cancelHref: Route;
}

export type DeleteAddressFormViewProps = DeleteAddressFields & FormStatusProps;

/** The confirmation step's form: deleting needs this second, explicit choice. */
export function DeleteAddressFormView({
  csrf,
  addressId,
  addressName,
  cancelHref,
  state,
  formAction,
  pending,
}: DeleteAddressFormViewProps) {
  return (
    <form action={formAction} className="grid gap-4">
      <FormMessage state={state} />
      <CsrfInput csrf={csrf} />
      <input type="hidden" name="addressId" value={addressId} />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="danger" loading={pending}>
          {pending ? null : <Trash2 aria-hidden="true" />}
          Delete address<span className="sr-only">: {addressName}</span>
        </Button>
        <Link href={cancelHref} className={buttonClasses({ variant: 'outline' })}>
          Keep address
        </Link>
      </div>
    </form>
  );
}

export function DeleteAddressForm({
  action,
  ...fields
}: DeleteAddressFields & { action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, IDLE_STATE);
  return (
    <DeleteAddressFormView {...fields} state={state} formAction={formAction} pending={pending} />
  );
}
