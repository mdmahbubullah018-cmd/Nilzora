import { render, screen } from '@testing-library/react';
import type { FormState } from '@nilzora/web-session';
import { describe, expect, it } from 'vitest';
import type { CsrfField } from '../auth/form-kit';
import { ProfileFormView } from './profile-form';
import { SignOutFormView } from './sign-out-form';

const csrf: CsrfField = { name: 'csrf_token', token: 'signed-csrf-value' };
const idle: FormState = { status: 'idle' };
const noop = () => undefined;
const initial = { fullName: 'Rahima Khatun', phone: '01712-345678' };

function input(label: RegExp): HTMLInputElement {
  const element = screen.getByLabelText(label);
  if (!(element instanceof HTMLInputElement)) throw new Error(`${String(label)} is not an input`);
  return element;
}

function hiddenCsrf(container: HTMLElement): string | undefined {
  return container.querySelector<HTMLInputElement>('input[type="hidden"][name="csrf_token"]')
    ?.value;
}

describe('ProfileFormView', () => {
  it('edits only name and phone, starting from the saved values', () => {
    const { container } = render(
      <ProfileFormView
        csrf={csrf}
        initial={initial}
        state={idle}
        formAction={noop}
        pending={false}
      />,
    );

    const names = Array.from(container.querySelectorAll('input'), (element) => element.name);
    expect(names.sort()).toEqual(['csrf_token', 'fullName', 'phone']);
    expect(hiddenCsrf(container)).toBe('signed-csrf-value');
    const fullName = input(/^Full name/);
    expect(fullName.value).toBe('Rahima Khatun');
    expect(fullName.autocomplete).toBe('name');
    const phone = input(/^Mobile phone/);
    expect(phone.value).toBe('01712-345678');
    expect(phone.type).toBe('tel');
    expect(phone.autocomplete).toBe('tel');
    expect(phone.inputMode).toBe('tel');
  });

  it('keeps what was typed and marks the invalid field after an error', () => {
    render(
      <ProfileFormView
        csrf={csrf}
        initial={initial}
        state={{
          status: 'error',
          message: 'Check the highlighted fields.',
          fieldErrors: { phone: 'Enter a valid Bangladeshi mobile number' },
          values: { fullName: 'Rahima K.', phone: '0123' },
        }}
        formAction={noop}
        pending={false}
      />,
    );

    expect(screen.getByRole('alert').textContent).toBe('Check the highlighted fields.');
    expect(input(/^Full name/).value).toBe('Rahima K.');
    const phone = input(/^Mobile phone/);
    expect(phone.value).toBe('0123');
    expect(phone.getAttribute('aria-invalid')).toBe('true');
    expect(phone.getAttribute('aria-describedby')).toBe('profile-phone-hint profile-phone-error');
  });

  it('shows the saved values, in local form, after saving', () => {
    render(
      <ProfileFormView
        csrf={csrf}
        initial={initial}
        state={{
          status: 'success',
          message: 'Your profile has been saved.',
          values: { fullName: 'Rahima Begum', phone: '+8801912345678' },
        }}
        formAction={noop}
        pending={false}
      />,
    );

    expect(screen.getByRole('status').textContent).toBe('Your profile has been saved.');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(input(/^Full name/).value).toBe('Rahima Begum');
    expect(input(/^Mobile phone/).value).toBe('01912-345678');
  });

  it('keeps a cleared field empty after saving', () => {
    render(
      <ProfileFormView
        csrf={csrf}
        initial={initial}
        state={{
          status: 'success',
          message: 'Your profile has been saved.',
          values: { fullName: '', phone: '' },
        }}
        formAction={noop}
        pending={false}
      />,
    );
    expect(input(/^Full name/).value).toBe('');
    expect(input(/^Mobile phone/).value).toBe('');
  });
});

describe('SignOutFormView', () => {
  it('signs out with a CSRF-protected POST', () => {
    const { container } = render(
      <SignOutFormView csrf={csrf} state={idle} formAction={noop} pending={false} />,
    );
    expect(container.querySelector('form')).not.toBeNull();
    expect(hiddenCsrf(container)).toBe('signed-csrf-value');
    expect(screen.getByRole('button', { name: 'Sign out' })).toHaveProperty('type', 'submit');
  });

  it('reports an expired form', () => {
    render(
      <SignOutFormView
        csrf={csrf}
        state={{
          status: 'error',
          message:
            'This form has expired or did not come from Nilzora. Reload the page and try again.',
        }}
        formAction={noop}
        pending={false}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('This form has expired');
  });
});
