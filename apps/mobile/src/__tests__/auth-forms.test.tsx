import { ApiError } from '@nilzora/api-client';
import { render, screen, userEvent } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import RegisterScreen from '../../app/register';
import SignInScreen from '../../app/sign-in';
import { SessionProvider } from '../auth/session-context';
import { registerGoogleIdTokenProvider, resetGoogleIdTokenProvider } from '../auth/google-signin';
import { createSessionManager, MESSAGES } from '../auth/session-manager';
import {
  createFakeApi,
  createMemoryStore,
  CUSTOMER,
  fakeAuthSession,
  TOKEN_MARKER,
} from '../test-utils/session-fakes';

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  dismissTo: jest.fn(),
  canGoBack: jest.fn(() => true),
};
const mockParams: Record<string, string | string[] | undefined> = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(mockParams)) delete mockParams[key];
});

afterEach(() => {
  resetGoogleIdTokenProvider();
});

async function setup(screenElement: ReactElement) {
  const api = createFakeApi();
  const memory = createMemoryStore();
  const manager = createSessionManager({ api, store: memory.store });
  await manager.restore();
  await render(<SessionProvider manager={manager}>{screenElement}</SessionProvider>);
  return { api, manager, ...memory, user: userEvent.setup() };
}

describe('SignInScreen', () => {
  it('labels its fields for assistive technology and password managers', async () => {
    await setup(<SignInScreen />);

    const email = screen.getByLabelText('Email');
    expect(email).toHaveProp('keyboardType', 'email-address');
    expect(email).toHaveProp('autoComplete', 'email');
    expect(email).toHaveProp('autoCapitalize', 'none');
    const password = screen.getByLabelText('Password');
    expect(password).toHaveProp('secureTextEntry', true);
    expect(password).toHaveProp('autoComplete', 'current-password');
  });

  it('shows validation errors without calling the API', async () => {
    const { api, user } = await setup(<SignInScreen />);

    await user.press(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert', { name: MESSAGES.checkFields })).toBeOnTheScreen();
    expect(screen.getByText('Enter a valid email address')).toBeOnTheScreen();
    expect(screen.getByText('Enter your password.')).toBeOnTheScreen();
    expect(api.login).not.toHaveBeenCalled();
  });

  it('shows a fixed message for wrong credentials and stays on the form', async () => {
    const { api, user } = await setup(<SignInScreen />);
    api.login.mockRejectedValue(new ApiError(401, 'invalid_credentials', 'raw API text'));

    await user.type(screen.getByLabelText('Email'), 'customer@example.test');
    await user.type(screen.getByLabelText('Password'), 'wrong-password1');
    await user.press(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByRole('alert', { name: MESSAGES.invalidCredentials }),
    ).toBeOnTheScreen();
    expect(screen.queryByText('raw API text')).not.toBeOnTheScreen();
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it('signs in, keeps the tokens out of the UI and returns to the account tab', async () => {
    const { api, manager, saved, user } = await setup(<SignInScreen />);
    const session = fakeAuthSession(1, Date.now());
    api.login.mockResolvedValue(session);
    api.getMe.mockResolvedValue(CUSTOMER);

    await user.type(screen.getByLabelText('Email'), 'customer@example.test');
    await user.type(screen.getByLabelText('Password'), 'correct-password1');
    await user.press(screen.getByRole('button', { name: 'Sign in' }));

    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    expect(manager.getState().status).toBe('signed_in');
    expect(saved()?.accessToken).toBe(session.accessToken);
    expect(JSON.stringify(screen.toJSON())).not.toContain(TOKEN_MARKER);
  });

  it('returns to the screen it was opened for after signing in', async () => {
    mockParams.returnTo = '/orders';
    const { api, user } = await setup(<SignInScreen />);
    api.login.mockResolvedValue(fakeAuthSession(1, Date.now()));
    api.getMe.mockResolvedValue(CUSTOMER);

    await user.type(screen.getByLabelText('Email'), 'customer@example.test');
    await user.type(screen.getByLabelText('Password'), 'correct-password1');
    await user.press(screen.getByRole('button', { name: 'Sign in' }));

    expect(mockRouter.dismissTo).toHaveBeenCalledWith('/orders');
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it.each(['https://evil.test', '//evil.test', '/orders?next=//evil.test', '/sign-in'])(
    'ignores the unsafe returnTo %p and keeps the default destination',
    async (returnTo) => {
      mockParams.returnTo = returnTo;
      const { api, user } = await setup(<SignInScreen />);
      api.login.mockResolvedValue(fakeAuthSession(1, Date.now()));
      api.getMe.mockResolvedValue(CUSTOMER);

      await user.type(screen.getByLabelText('Email'), 'customer@example.test');
      await user.type(screen.getByLabelText('Password'), 'correct-password1');
      await user.press(screen.getByRole('button', { name: 'Sign in' }));

      expect(mockRouter.dismissTo).not.toHaveBeenCalled();
      expect(mockRouter.back).toHaveBeenCalledTimes(1);
    },
  );

  it('carries the returnTo on to registration', async () => {
    mockParams.returnTo = '/checkout';
    const { user } = await setup(<SignInScreen />);

    await user.press(screen.getByRole('button', { name: 'Create an account' }));

    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/register',
      params: { returnTo: '/checkout' },
    });
  });

  it('ignores repeated presses while a sign-in is in progress', async () => {
    const { api, user } = await setup(<SignInScreen />);
    let finish!: () => void;
    api.login.mockImplementation(
      () =>
        new Promise((_, reject) => {
          finish = () => reject(new ApiError(401, 'invalid_credentials', 'x'));
        }),
    );

    await user.type(screen.getByLabelText('Email'), 'customer@example.test');
    await user.type(screen.getByLabelText('Password'), 'password1');
    const button = screen.getByRole('button', { name: 'Sign in' });
    await user.press(button);

    expect(button).toBeDisabled();
    expect(button).toBeBusy();
    await user.press(button);
    expect(api.login).toHaveBeenCalledTimes(1);

    finish();
    expect(
      await screen.findByRole('alert', { name: MESSAGES.invalidCredentials }),
    ).toBeOnTheScreen();
  });

  it('explains when the build has no API address', async () => {
    await render(
      <SessionProvider manager={null}>
        <SignInScreen />
      </SessionProvider>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/Sign-in is not available/);
    expect(screen.queryByLabelText('Email')).not.toBeOnTheScreen();
  });

  it('offers Google sign-in when this build can show Google, and signs in with it', async () => {
    registerGoogleIdTokenProvider({
      requestIdToken: () => Promise.resolve({ ok: true, idToken: 'header.claims.signature' }),
    });
    const { api, user } = await setup(<SignInScreen />);
    api.completeGoogleIdToken.mockResolvedValue(fakeAuthSession(1, Date.now()));
    api.getMe.mockResolvedValue(CUSTOMER);

    const button = screen.getByRole('button', { name: 'Continue with Google' });
    await user.press(button);

    expect(api.completeGoogleIdToken).toHaveBeenCalledWith({
      idToken: 'header.claims.signature',
    });
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('hides the Google button when the native module is absent', async () => {
    await setup(<SignInScreen />);

    expect(screen.queryByRole('button', { name: 'Continue with Google' })).not.toBeOnTheScreen();
  });

  it('shows a fixed message when Google sign-in is cancelled', async () => {
    registerGoogleIdTokenProvider({
      requestIdToken: () => Promise.resolve({ ok: false, reason: 'cancelled' }),
    });
    const { api, user } = await setup(<SignInScreen />);

    await user.press(screen.getByRole('button', { name: 'Continue with Google' }));

    expect(await screen.findByRole('alert', { name: MESSAGES.googleCancelled })).toBeOnTheScreen();
    expect(api.completeGoogleIdToken).not.toHaveBeenCalled();
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it('shows the busy state and blocks a second Google press while it runs', async () => {
    let release: (value: { ok: false; reason: 'cancelled' }) => void = () => undefined;
    const pending = new Promise<{ ok: false; reason: 'cancelled' }>((resolve) => {
      release = resolve;
    });
    registerGoogleIdTokenProvider({ requestIdToken: () => pending });
    const { api, user } = await setup(<SignInScreen />);

    const button = screen.getByRole('button', { name: 'Continue with Google' });
    await user.press(button);

    expect(button).toBeBusy();
    await user.press(button);
    expect(api.completeGoogleIdToken).not.toHaveBeenCalled();

    // Cancelling keeps the visitor on the form, so the button must become usable again.
    release({ ok: false, reason: 'cancelled' });
    expect(await screen.findByRole('alert', { name: MESSAGES.googleCancelled })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).not.toBeBusy();
    expect(api.completeGoogleIdToken).not.toHaveBeenCalled();
  });
});

describe('RegisterScreen', () => {
  it('has no role field', async () => {
    await setup(<RegisterScreen />);

    expect(screen.getByLabelText('Email')).toBeOnTheScreen();
    expect(screen.getByLabelText('Password')).toHaveProp('autoComplete', 'new-password');
    expect(screen.getByLabelText('Full name')).toHaveProp('autoComplete', 'name');
    expect(screen.getByLabelText('Mobile number')).toHaveProp('autoComplete', 'tel');
    expect(screen.queryByLabelText(/role/i)).not.toBeOnTheScreen();
  });

  it('shows field errors for invalid input', async () => {
    const { api, user } = await setup(<RegisterScreen />);

    await user.type(screen.getByLabelText('Email'), 'customer@example.test');
    await user.type(screen.getByLabelText('Password'), 'onlyletters');
    await user.press(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Use both letters and numbers')).toBeOnTheScreen();
    expect(api.register).not.toHaveBeenCalled();
  });

  it('shows the same check-your-inbox answer after registering', async () => {
    const { api, user } = await setup(<RegisterScreen />);
    api.register.mockResolvedValue({ status: 'accepted', message: 'from the API' });

    await user.type(screen.getByLabelText('Email'), 'new@example.test');
    await user.type(screen.getByLabelText('Password'), 'letters123');
    await user.press(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText(MESSAGES.registered)).toBeOnTheScreen();
    expect(api.register).toHaveBeenCalledWith({
      email: 'new@example.test',
      password: 'letters123',
    });
    // Verifying the address is the next step, and it signs the customer in.
    await user.press(screen.getByRole('button', { name: 'Enter my code' }));
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/verify-email',
      params: { email: 'new@example.test' },
    });
  });

  it('carries a safe returnTo on to sign-in', async () => {
    mockParams.returnTo = '/addresses/new';
    const { user } = await setup(<RegisterScreen />);

    await user.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(mockRouter.replace).toHaveBeenLastCalledWith({
      pathname: '/sign-in',
      params: { returnTo: '/addresses/new' },
    });
  });

  it('does not forward an unsafe returnTo to sign-in', async () => {
    mockParams.returnTo = 'javascript:alert(1)';
    const { user } = await setup(<RegisterScreen />);

    await user.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(mockRouter.replace).toHaveBeenLastCalledWith('/sign-in');
  });
});
