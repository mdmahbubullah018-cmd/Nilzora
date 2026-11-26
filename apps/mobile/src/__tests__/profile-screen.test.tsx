import { render, screen, userEvent } from '@testing-library/react-native';
import ProfileScreen from '../../app/profile';
import { ApiProvider } from '../api/api-context';
import { SessionProvider } from '../auth/session-context';
import { createSessionManager, MESSAGES, type SessionManager } from '../auth/session-manager';
import { resetRouterMock, router } from '../test-utils/expo-router-mock';
import {
  createFakeApi,
  createMemoryStore,
  createStaticManager,
  CUSTOMER,
  fakeStoredSession,
  TOKEN_MARKER,
} from '../test-utils/session-fakes';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));
jest.mock('expo-notifications', () => ({}));

beforeEach(resetRouterMock);

function renderProfile(manager: SessionManager | null) {
  return render(
    <SessionProvider manager={manager}>
      <ApiProvider api={null}>
        <ProfileScreen />
      </ApiProvider>
    </SessionProvider>,
  );
}

/** The real session manager over a stubbed API, so a save goes through the whole path. */
function realManager(api = createFakeApi()): SessionManager {
  api.getMe.mockResolvedValue(CUSTOMER);
  const { store } = createMemoryStore(fakeStoredSession(1, Date.now()));
  return createSessionManager({ api, store });
}

describe('Profile details', () => {
  it('asks a signed-out visitor to sign in, and brings them back here', async () => {
    const user = userEvent.setup();
    await renderProfile(createStaticManager({ status: 'signed_out' }));

    expect(screen.getByRole('header', { name: 'Sign in to Nilzora' })).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/sign-in',
      params: { returnTo: '/profile' },
    });
  });

  it('shows an accessible loading state while the session is restored', async () => {
    await renderProfile(createStaticManager({ status: 'restoring' }));

    expect(screen.getByRole('progressbar', { name: 'Checking your sign-in' })).toBeOnTheScreen();
  });

  it('shows the account’s own details', async () => {
    await renderProfile(realManager());

    expect(await screen.findByLabelText('Name: Ayesha Rahman')).toBeOnTheScreen();
    expect(screen.getByLabelText('Email: customer@example.test')).toBeOnTheScreen();
    expect(screen.getByLabelText('Phone: Not added')).toBeOnTheScreen();
    expect(screen.getByLabelText('Member since: 5 January 2026')).toBeOnTheScreen();
    expect(screen.getByLabelText('Full name')).toHaveDisplayValue('Ayesha Rahman');
    expect(screen.getByLabelText('Mobile number')).toHaveDisplayValue('');
  });

  it('saves the profile and reports the outcome', async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    api.updateMe.mockResolvedValue({
      user: {
        ...CUSTOMER.user,
        profile: {
          ...CUSTOMER.user.profile,
          phone: '+8801712345678',
          updatedAt: '2026-10-23T12:00:00.000Z',
        },
      },
    });
    await renderProfile(realManager(api));

    await user.type(await screen.findByLabelText('Mobile number'), '01712-345678');
    await user.press(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText(MESSAGES.profileSaved)).toBeOnTheScreen();
    expect(api.updateMe).toHaveBeenCalledWith(expect.any(String), {
      fullName: 'Ayesha Rahman',
      phone: '+8801712345678',
    });
    expect(screen.getByLabelText('Mobile number')).toHaveDisplayValue('+8801712345678');
    expect(screen.getByLabelText('Phone: +8801712345678')).toBeOnTheScreen();
  });

  it('shows field errors from a rejected profile update', async () => {
    const user = userEvent.setup();
    const manager = createStaticManager({ status: 'signed_in', user: CUSTOMER.user });
    manager.updateProfile.mockResolvedValue({
      ok: false,
      message: MESSAGES.checkFields,
      fieldErrors: { phone: 'Enter a valid Bangladeshi mobile number' },
    });
    await renderProfile(manager);

    await user.press(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert', { name: MESSAGES.checkFields })).toBeOnTheScreen();
    expect(screen.getByText('Enter a valid Bangladeshi mobile number')).toBeOnTheScreen();
  });

  it('signs out from the profile screen too', async () => {
    const user = userEvent.setup();
    const manager = createStaticManager({ status: 'signed_in', user: CUSTOMER.user });
    await renderProfile(manager);

    await user.press(screen.getByRole('button', { name: 'Sign out' }));

    expect(manager.signOut).toHaveBeenCalledTimes(1);
  });

  it('never renders a token', async () => {
    await renderProfile(realManager());

    expect(await screen.findByText('Ayesha Rahman')).toBeOnTheScreen();
    expect(JSON.stringify(screen.toJSON())).not.toContain(TOKEN_MARKER);
  });
});
