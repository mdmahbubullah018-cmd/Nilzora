import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FormState } from '@nilzora/web-session';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmEmailFormView } from './confirm-email-form';
import { GoogleButton } from './google-button';
import type { CsrfField, FormAction } from './form-kit';
import { LoginForm, LoginFormView } from './login-form';
import { RegisterForm, RegisterFormView } from './register-form';

const csrf: CsrfField = { name: 'csrf_token', token: 'signed-csrf-value' };
const idle: FormState = { status: 'idle' };
const noop = () => undefined;
const REGISTERED =
  'Check your inbox. If this address can be used for a new account, we have sent it a confirmation link.';

function input(label: RegExp): HTMLInputElement {
  const element = screen.getByLabelText(label);
  if (!(element instanceof HTMLInputElement)) throw new Error(`${String(label)} is not an input`);
  return element;
}

function hiddenValue(container: HTMLElement, name: string): string | undefined {
  const element = container.querySelector(`input[type="hidden"][name="${name}"]`);
  return element instanceof HTMLInputElement ? element.value : undefined;
}

/** Names of every control the form would submit. */
function controlNames(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('input, select, textarea'), (element) =>
    element.getAttribute('name'),
  ).filter((name): name is string => name !== null);
}

describe('LoginFormView', () => {
  it('labels its fields with the right autocomplete hints and carries CSRF and next', () => {
    const { container } = render(
      <LoginFormView csrf={csrf} next="/account" state={idle} formAction={noop} pending={false} />,
    );

    const email = input(/^Email address/);
    expect(email.type).toBe('email');
    expect(email.autocomplete).toBe('email');
    expect(email.required).toBe(true);
    const password = input(/^Password/);
    expect(password.type).toBe('password');
    expect(password.autocomplete).toBe('current-password');
    expect(password.required).toBe(true);
    expect(hiddenValue(container, 'csrf_token')).toBe('signed-csrf-value');
    expect(hiddenValue(container, 'next')).toBe('/account');
    expect(controlNames(container).sort()).toEqual(['csrf_token', 'email', 'next', 'password']);
  });

  it('shows errors on the fields and in an alert, keeping the email but not the password', () => {
    render(
      <LoginFormView
        csrf={csrf}
        next="/account"
        state={{
          status: 'error',
          message: 'Check the highlighted fields.',
          fieldErrors: { email: 'Enter a valid email address' },
          // Even if a password were ever echoed back, the form must not show it.
          values: { email: 'rahima@example', password: 'secret123' },
        }}
        formAction={noop}
        pending={false}
      />,
    );

    expect(screen.getByRole('alert').textContent).toBe('Check the highlighted fields.');
    const email = input(/^Email address/);
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(email.getAttribute('aria-describedby')).toBe('login-email-error');
    expect(document.getElementById('login-email-error')?.textContent).toBe(
      'Enter a valid email address',
    );
    expect(email.value).toBe('rahima@example');
    expect(input(/^Password/).value).toBe('');
  });

  it('shows the page notice until the form has a message of its own', () => {
    const notice = { tone: 'info', message: 'You have signed out.' } as const;
    const { rerender } = render(
      <LoginFormView
        csrf={csrf}
        next="/account"
        notice={notice}
        state={idle}
        formAction={noop}
        pending={false}
      />,
    );
    expect(screen.getByRole('status').textContent).toBe('You have signed out.');

    rerender(
      <LoginFormView
        csrf={csrf}
        next="/account"
        notice={notice}
        state={{ status: 'error', message: 'The email address or password is incorrect.' }}
        formAction={noop}
        pending={false}
      />,
    );
    expect(screen.queryByText('You have signed out.')).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe(
      'The email address or password is incorrect.',
    );
  });

  it('blocks repeat submissions while pending', () => {
    render(<LoginFormView csrf={csrf} next="/account" state={idle} formAction={noop} pending />);
    const button = screen.getByRole('button', { name: 'Sign in' });
    expect(button).toHaveProperty('disabled', true);
    expect(button.getAttribute('aria-busy')).toBe('true');
  });
});

describe('LoginForm', () => {
  it('posts the CSRF token and next path, then keeps the email and clears the password', async () => {
    const action = vi.fn<FormAction>((_previous, formData) => {
      const email = formData.get('email');
      return Promise.resolve({
        status: 'error',
        message: 'The email address or password is incorrect.',
        values: { email: typeof email === 'string' ? email : '' },
      });
    });
    render(<LoginForm action={action} csrf={csrf} next="/account/orders" />);

    fireEvent.change(input(/^Email address/), { target: { value: 'rahima@example.com' } });
    fireEvent.change(input(/^Password/), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'The email address or password is incorrect.',
    );
    expect(action).toHaveBeenCalledTimes(1);
    const submitted = action.mock.calls[0]?.[1];
    expect(submitted?.get('csrf_token')).toBe('signed-csrf-value');
    expect(submitted?.get('next')).toBe('/account/orders');
    expect(submitted?.get('email')).toBe('rahima@example.com');
    expect(input(/^Email address/).value).toBe('rahima@example.com');
    expect(input(/^Password/).value).toBe('');
  });
});

describe('RegisterFormView', () => {
  it('asks only for name, email, phone and password, with no role or permission field', () => {
    const { container } = render(
      <RegisterFormView csrf={csrf} state={idle} formAction={noop} pending={false} />,
    );

    expect(controlNames(container).sort()).toEqual([
      'csrf_token',
      'email',
      'fullName',
      'password',
      'phone',
    ]);
    expect(screen.queryByLabelText(/role|permission/i)).toBeNull();
    expect(hiddenValue(container, 'csrf_token')).toBe('signed-csrf-value');

    const fullName = input(/^Full name/);
    expect(fullName.autocomplete).toBe('name');
    expect(fullName.required).toBe(false);
    const email = input(/^Email address/);
    expect(email.type).toBe('email');
    expect(email.autocomplete).toBe('email');
    expect(email.required).toBe(true);
    const phone = input(/^Mobile phone/);
    expect(phone.type).toBe('tel');
    expect(phone.autocomplete).toBe('tel');
    expect(phone.inputMode).toBe('tel');
    expect(phone.required).toBe(false);
    expect(phone.getAttribute('aria-describedby')).toBe('register-phone-hint');
    const password = input(/^Password/);
    expect(password.type).toBe('password');
    expect(password.autocomplete).toBe('new-password');
    expect(password.required).toBe(true);
    expect(document.getElementById('register-password-hint')?.textContent).toMatch(
      /8 characters.*letters and numbers/,
    );
  });

  it('keeps typed details after an error but never the password', () => {
    render(
      <RegisterFormView
        csrf={csrf}
        state={{
          status: 'error',
          message: 'Check the highlighted fields.',
          fieldErrors: { password: 'Choose a stronger password.' },
          values: {
            fullName: 'Rahima Khatun',
            email: 'rahima@example.com',
            phone: '01712-345678',
            password: 'password1',
          },
        }}
        formAction={noop}
        pending={false}
      />,
    );

    expect(screen.getByRole('alert').textContent).toBe('Check the highlighted fields.');
    expect(input(/^Full name/).value).toBe('Rahima Khatun');
    expect(input(/^Email address/).value).toBe('rahima@example.com');
    expect(input(/^Mobile phone/).value).toBe('01712-345678');
    const password = input(/^Password/);
    expect(password.value).toBe('');
    expect(password.getAttribute('aria-invalid')).toBe('true');
    expect(password.getAttribute('aria-describedby')).toBe(
      'register-password-hint register-password-error',
    );
  });

  it('replaces the form with the generic confirmation message on success', () => {
    const { container } = render(
      <RegisterFormView
        csrf={csrf}
        state={{ status: 'success', message: REGISTERED, values: { email: 'rahima@example.com' } }}
        formAction={noop}
        pending={false}
      />,
    );

    expect(container.querySelector('form')).toBeNull();
    expect(screen.queryByLabelText(/^Password/)).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('If this address can be used');
    // The next step is the emailed code, not the password.
    expect(screen.getByRole('link', { name: 'Enter my code' }).getAttribute('href')).toBe(
      '/verify-otp?email=rahima%40example.com',
    );
  });
});

describe('RegisterForm', () => {
  it('shows the confirmation message after the action succeeds', async () => {
    const action = vi.fn<FormAction>(() =>
      Promise.resolve({ status: 'success', message: REGISTERED }),
    );
    const { container } = render(<RegisterForm action={action} csrf={csrf} />);

    fireEvent.change(input(/^Email address/), { target: { value: 'rahima@example.com' } });
    fireEvent.change(input(/^Password/), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect((await screen.findByRole('status')).textContent).toContain('Check your inbox');
    expect(container.querySelector('form')).toBeNull();
    expect(action.mock.calls[0]?.[1].get('csrf_token')).toBe('signed-csrf-value');
  });
});

describe('ConfirmEmailFormView', () => {
  const tokenHash = 'pkce_2b7f0c9e4d1a8b3c6e5f7a9d0b1c2e3f';

  it('confirms only through an explicit button that posts the token hash and CSRF token', () => {
    const { container } = render(
      <ConfirmEmailFormView
        csrf={csrf}
        tokenHash={tokenHash}
        state={idle}
        formAction={noop}
        pending={false}
      />,
    );

    expect(screen.getByRole('button', { name: 'Confirm my email' })).toHaveProperty(
      'type',
      'submit',
    );
    expect(hiddenValue(container, 'tokenHash')).toBe(tokenHash);
    expect(hiddenValue(container, 'csrf_token')).toBe('signed-csrf-value');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows why a confirmation failed', () => {
    render(
      <ConfirmEmailFormView
        csrf={csrf}
        tokenHash={tokenHash}
        state={{
          status: 'error',
          message: 'This confirmation link is invalid, expired or already used.',
        }}
        formAction={noop}
        pending={false}
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe(
      'This confirmation link is invalid, expired or already used.',
    );
  });
});

describe('GoogleButton', () => {
  it('submits the CSRF token and the return path to the action', async () => {
    const action = vi.fn<FormAction>(() => Promise.resolve({ status: 'idle' }));
    const { container } = render(<GoogleButton action={action} csrf={csrf} next="/checkout" />);

    expect(screen.getByRole('button', { name: 'Continue with Google' })).not.toBeNull();
    const hidden = [...container.querySelectorAll<HTMLInputElement>('input[type="hidden"]')];
    const fieldValue = (name: string) => hidden.find((input) => input.name === name)?.value ?? null;
    expect(fieldValue(csrf.name)).toBe(csrf.token);
    expect(fieldValue('next')).toBe('/checkout');

    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    await waitFor(() => expect(action).toHaveBeenCalled());
    expect(action.mock.calls[0]?.[1]).toBeInstanceOf(FormData);
  });

  it('shows the failure message the action returns', async () => {
    const action = vi.fn<FormAction>(() =>
      Promise.resolve({ status: 'error', message: 'Google sign-in is not available right now.' }),
    );
    render(<GoogleButton action={action} csrf={csrf} next="/account" />);

    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Google sign-in is not available right now.',
    );
  });
});
