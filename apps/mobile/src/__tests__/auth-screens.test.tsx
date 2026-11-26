import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import ForgotPasswordScreen from '../../app/forgot-password';
import ResetPasswordScreen, { PASSWORD_MISMATCH } from '../../app/reset-password';
import VerifyEmailScreen from '../../app/verify-email';
import { SessionProvider } from '../auth/session-context';
import { createStaticManager } from '../test-utils/session-fakes';
import { resetRouterMock, router, searchParams } from '../test-utils/expo-router-mock';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

beforeEach(async () => {
  resetRouterMock();
  await AsyncStorage.clear();
});

function signOutManager() {
  const manager = createStaticManager({ status: 'signed_out' });
  manager.verifyEmailCode.mockResolvedValue({ ok: true });
  manager.resendEmailCode.mockResolvedValue({ ok: true, message: 'A new code is on its way.' });
  manager.requestPasswordReset.mockResolvedValue({ ok: true, message: 'Code sent.' });
  manager.resetPassword.mockResolvedValue({ ok: true });
  return manager;
}

const digitBox = (index: number, label = 'Verification code') =>
  screen.getByLabelText(`${label}, digit ${String(index)} of 6`);

describe('VerifyEmailScreen', () => {
  it('redeems the code with the real session manager and confirms before leaving', async () => {
    const manager = signOutManager();
    searchParams.email = 'customer@example.test';
    searchParams.returnTo = '/orders';
    const user = userEvent.setup();
    await render(
      <SessionProvider manager={manager}>
        <VerifyEmailScreen />
      </SessionProvider>,
    );

    await fireEvent.changeText(digitBox(1), '123456');
    await user.press(screen.getByRole('button', { name: 'Verify and continue' }));

    expect(manager.verifyEmailCode).toHaveBeenCalledWith('customer@example.test', '123456');
    expect(await screen.findByRole('header', { name: 'Email verified' })).toBeOnTheScreen();
    // Nothing has navigated yet: the customer continues deliberately.
    expect(router.dismissTo).not.toHaveBeenCalled();

    await user.press(screen.getByRole('button', { name: 'Continue' }));

    expect(router.dismissTo).toHaveBeenCalledWith('/orders');
  });

  it('keeps the form and shows the fixed message when the code is refused', async () => {
    const manager = signOutManager();
    manager.verifyEmailCode.mockResolvedValue({
      ok: false,
      message: 'Check the highlighted fields.',
      fieldErrors: { code: 'Enter the six-digit code from your email.' },
    });
    const user = userEvent.setup();
    await render(
      <SessionProvider manager={manager}>
        <VerifyEmailScreen />
      </SessionProvider>,
    );

    await fireEvent.changeText(digitBox(1), '000000');
    await user.press(screen.getByRole('button', { name: 'Verify and continue' }));

    expect(await screen.findByText('Check the highlighted fields.')).toBeOnTheScreen();
    expect(screen.getByText('Enter the six-digit code from your email.')).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'Email verified' })).not.toBeOnTheScreen();
    expect(router.back).not.toHaveBeenCalled();
  });

  it('sends a new code and then rests the button for a while', async () => {
    const manager = signOutManager();
    const user = userEvent.setup();
    await render(
      <SessionProvider manager={manager}>
        <VerifyEmailScreen />
      </SessionProvider>,
    );

    await user.press(screen.getByRole('button', { name: 'Send a new code' }));

    expect(manager.resendEmailCode).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('A new code is on its way.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Send a new code in 60 seconds' })).toBeDisabled();
  });

  it('explains when the build has no API address', async () => {
    await render(
      <SessionProvider manager={null}>
        <VerifyEmailScreen />
      </SessionProvider>,
    );

    expect(screen.getByText('Verification is not available')).toBeOnTheScreen();
  });
});

describe('ForgotPasswordScreen', () => {
  it('asks for a code and carries the address to the reset screen', async () => {
    const manager = signOutManager();
    const user = userEvent.setup();
    await render(
      <SessionProvider manager={manager}>
        <ForgotPasswordScreen />
      </SessionProvider>,
    );

    await user.type(screen.getByLabelText('Email'), 'Customer@Example.test ');
    await user.press(screen.getByRole('button', { name: 'Email me a code' }));

    expect(manager.requestPasswordReset).toHaveBeenCalledWith('Customer@Example.test ');
    expect(router.push).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: '/reset-password',
        params: { email: 'customer@example.test' },
      }),
    );
  });

  it('never reveals whether an address exists', async () => {
    await render(
      <SessionProvider manager={signOutManager()}>
        <ForgotPasswordScreen />
      </SessionProvider>,
    );

    expect(screen.getByText(/whether or not an account exists/)).toBeOnTheScreen();
  });
});

describe('ResetPasswordScreen', () => {
  function renderReset(manager = signOutManager()) {
    searchParams.email = 'customer@example.test';
    return render(
      <SessionProvider manager={manager}>
        <ResetPasswordScreen />
      </SessionProvider>,
    );
  }

  async function fill(manager: ReturnType<typeof signOutManager>, confirmation: string) {
    const user = userEvent.setup();
    const view = await renderReset(manager);
    await fireEvent.changeText(digitBox(1, 'Reset code'), '654321');
    await user.type(screen.getByLabelText('New password'), 'correct-password1');
    await user.type(screen.getByLabelText('Confirm new password'), confirmation);
    await user.press(screen.getByRole('button', { name: 'Set new password' }));
    return { user, view };
  }

  it('blocks the API call when the two passwords differ', async () => {
    const manager = signOutManager();

    await fill(manager, 'different-password1');

    expect(manager.resetPassword).not.toHaveBeenCalled();
    expect(await screen.findByText(PASSWORD_MISMATCH)).toBeOnTheScreen();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('sets the password with the real manager and returns to sign-in', async () => {
    const manager = signOutManager();

    await fill(manager, 'correct-password1');

    expect(manager.resetPassword).toHaveBeenCalledWith(
      'customer@example.test',
      '654321',
      'correct-password1',
    );
    expect(router.replace).toHaveBeenCalledWith('/sign-in');
  });
});
