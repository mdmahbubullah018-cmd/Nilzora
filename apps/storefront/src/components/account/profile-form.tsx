'use client';

import { Button, Field, Input } from '@nilzora/ui';
import { useActionState } from 'react';
import { formatBdPhone } from '@/lib/format';
import {
  CsrfInput,
  FormMessage,
  IDLE_STATE,
  type CsrfField,
  type FormAction,
  type FormStatusProps,
} from '../auth/form-kit';

interface ProfileFormFields {
  csrf: CsrfField;
  /** Current saved values; empty string when not set. */
  initial: { fullName: string; phone: string };
}

export type ProfileFormViewProps = ProfileFormFields & FormStatusProps;

/** Edits the only profile fields customers may change. An emptied field is cleared. */
export function ProfileFormView({
  csrf,
  initial,
  state,
  formAction,
  pending,
}: ProfileFormViewProps) {
  const errors = state.fieldErrors ?? {};
  // After an error the form keeps what was typed; after saving it shows the stored values.
  const fullName = state.values?.fullName ?? initial.fullName;
  const phone = state.values?.phone ?? initial.phone;
  return (
    <form action={formAction} className="grid gap-5">
      <FormMessage state={state} />
      <CsrfInput csrf={csrf} />

      {/* Side by side where there is room; stacked on a phone, where the keyboard is up. */}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="profile-full-name" label="Full name" error={errors.fullName}>
          {(control) => (
            <Input
              {...control}
              name="fullName"
              autoComplete="name"
              maxLength={120}
              defaultValue={fullName}
              className="h-11 text-base sm:h-10 sm:text-sm"
            />
          )}
        </Field>
        <Field
          id="profile-phone"
          label="Mobile phone"
          hint="e.g. 01712-345678. Leave empty to remove it."
          error={errors.phone}
        >
          {(control) => (
            <Input
              {...control}
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              maxLength={20}
              defaultValue={state.status === 'success' ? formatBdPhone(phone) : phone}
              className="h-11 text-base tabular-nums sm:h-10 sm:text-sm"
            />
          )}
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" loading={pending}>
          Save changes
        </Button>
        {/* Native reset: the fields go back to the saved values without a round trip. */}
        <Button type="reset" variant="ghost" disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function ProfileForm({ action, ...fields }: ProfileFormFields & { action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, IDLE_STATE);
  return <ProfileFormView {...fields} state={state} formAction={formAction} pending={pending} />;
}
