'use client';

import Form from 'next/form';
import type { ComponentProps, SubmitEvent } from 'react';

/**
 * next/form with one change: fields left empty are not sent, so a filtered address reads
 * `?status=delivered` instead of `?q=&status=delivered&courier=&kind=`. The empty controls
 * are disabled for the instant next/form reads the form (disabled controls are not part of
 * the form data) and enabled again straight after; focus is put back where it was. Without
 * JavaScript the browser submits the plain form, empty fields included, which pages already
 * treat as "no filter".
 */
export function FilterForm({ onSubmit, ...props }: ComponentProps<typeof Form>) {
  function omitEmptyFields(event: SubmitEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    const empty = Array.from(form.elements).filter(
      (element): element is HTMLInputElement | HTMLSelectElement =>
        (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) &&
        element.name !== '' &&
        !element.disabled &&
        element.value === '' &&
        !['checkbox', 'radio', 'submit', 'button', 'file'].includes(element.type),
    );
    if (empty.length > 0) {
      const focused = document.activeElement;
      for (const element of empty) element.disabled = true;
      setTimeout(() => {
        for (const element of empty) element.disabled = false;
        if (focused instanceof HTMLElement && focused.isConnected) focused.focus();
      }, 0);
    }
    onSubmit?.(event);
  }
  return <Form {...props} onSubmit={omitEmptyFields} />;
}
