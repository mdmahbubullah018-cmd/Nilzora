'use client';

import Form from 'next/form';
import type { ComponentProps, FormEvent } from 'react';

/**
 * Leaves the form's empty fields out of the address it submits: a blank price or "All
 * brands" means "no filter", so `?min=&brand=` would only be noise. The fields are switched
 * off just while the browser reads the form, then back on, so they can still be edited.
 */
export function dropEmptyFields(event: FormEvent<HTMLFormElement>): void {
  const off: (HTMLInputElement | HTMLSelectElement)[] = [];
  for (const field of Array.from(event.currentTarget.elements)) {
    if (
      (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) &&
      field.name !== '' &&
      !field.disabled &&
      field.value.trim() === ''
    ) {
      field.disabled = true;
      off.push(field);
    }
  }
  setTimeout(() => {
    for (const field of off) field.disabled = false;
  }, 0);
}

/** A next/form GET form that submits only the fields that say something. */
export function CleanGetForm(props: ComponentProps<typeof Form>) {
  return <Form {...props} onSubmit={dropEmptyFields} />;
}
