import { render, screen, userEvent } from '@testing-library/react-native';
import { StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { SessionProvider } from '../auth/session-context';
import type { SessionManager, SessionState } from '../auth/session-manager';
import { SignedInGate, type SignedInGateProps } from '../auth/signed-in-gate';
import { STACK_EDGES } from '../components/screen';
import { TAB_BAR_SPACE } from '../components/tab-bar';
import { resetRouterMock, router } from '../test-utils/expo-router-mock';
import { createStaticManager, CUSTOMER } from '../test-utils/session-fakes';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

beforeEach(resetRouterMock);

function renderGate(
  session: SessionState | SessionManager | null,
  props: Partial<SignedInGateProps> = {},
) {
  const manager =
    session === null || 'getState' in session ? session : createStaticManager(session);
  return {
    manager,
    done: render(
      <SessionProvider manager={manager}>
        <SignedInGate {...props}>
          <Text>private content</Text>
        </SignedInGate>
      </SessionProvider>,
    ),
  };
}

describe('SignedInGate', () => {
  it('renders its children for a signed-in customer, and nothing else', async () => {
    await renderGate({ status: 'signed_in', user: CUSTOMER.user }, { title: 'Orders' }).done;

    expect(screen.getByText('private content')).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'Orders' })).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeOnTheScreen();
  });

  it('shows a loading state while the saved session is checked', async () => {
    await renderGate({ status: 'restoring' }).done;

    expect(screen.getByRole('progressbar', { name: 'Checking your sign-in' })).toBeOnTheScreen();
    expect(screen.queryByText('private content')).not.toBeOnTheScreen();
  });

  it('explains when the build has no API address', async () => {
    await renderGate(null).done;

    expect(screen.getByRole('header', { name: 'Sign-in is not available' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeOnTheScreen();
    expect(screen.queryByText('private content')).not.toBeOnTheScreen();
  });

  it('offers a retry when the session could not be checked', async () => {
    const user = userEvent.setup();
    const { manager, done } = renderGate({ status: 'offline' });
    await done;
    const restore = (manager as ReturnType<typeof createStaticManager>).restore;
    restore.mockClear();

    expect(screen.getByRole('header', { name: 'Nilzora could not be reached' })).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Try again' }));

    expect(restore).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('private content')).not.toBeOnTheScreen();
  });

  it('shows a suspended account with only a sign-out action', async () => {
    const user = userEvent.setup();
    const { manager, done } = renderGate({ status: 'suspended' });
    await done;

    expect(screen.getByRole('alert')).toHaveTextContent(/Account suspended/);
    expect(screen.queryByText('private content')).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Sign out' }));
    expect((manager as ReturnType<typeof createStaticManager>).signOut).toHaveBeenCalledTimes(1);
  });

  describe('framing', () => {
    /** The gate's scrolling content style, flattened so padding can be read. */
    function contentStyle(): ViewStyle {
      const props = screen.getByTestId('signed-in-gate').props as {
        contentContainerStyle?: StyleProp<ViewStyle>;
      };
      return StyleSheet.flatten(props.contentContainerStyle) ?? {};
    }

    it('leaves room for the floating tab bar on a tab screen', async () => {
      await renderGate({ status: 'signed_out' }, { title: 'Orders' }).done;

      // The screen's own breathing room plus the bar's height.
      expect(Number(contentStyle().paddingBottom)).toBeGreaterThanOrEqual(40 + TAB_BAR_SPACE);
    });

    it('adds no tab-bar space on a stack screen', async () => {
      await renderGate({ status: 'signed_out' }, { edges: STACK_EDGES }).done;

      expect(Number(contentStyle().paddingBottom)).toBe(40);
    });
  });

  describe('when signed out', () => {
    it('offers Sign in and Create account, carrying a validated return path', async () => {
      const user = userEvent.setup();
      await renderGate(
        { status: 'signed_out' },
        { title: 'Orders', purpose: 'see your orders', returnTo: '/orders' },
      ).done;

      expect(screen.getByRole('header', { name: 'Orders' })).toBeOnTheScreen();
      expect(
        screen.getByText('Sign in or create an account to see your orders.'),
      ).toBeOnTheScreen();
      expect(screen.queryByText('private content')).not.toBeOnTheScreen();

      await user.press(screen.getByRole('button', { name: 'Sign in' }));
      expect(router.push).toHaveBeenLastCalledWith({
        pathname: '/sign-in',
        params: { returnTo: '/orders' },
      });
      await user.press(screen.getByRole('button', { name: 'Create account' }));
      expect(router.push).toHaveBeenLastCalledWith({
        pathname: '/register',
        params: { returnTo: '/orders' },
      });
    });

    it.each([undefined, 'https://evil.test', '//evil.test', '/orders?x=1', '/sign-in'])(
      'does not pass on an unusable return path (%p)',
      async (returnTo) => {
        const user = userEvent.setup();
        await renderGate({ status: 'signed_out' }, { returnTo }).done;

        await user.press(screen.getByRole('button', { name: 'Sign in' }));
        expect(router.push).toHaveBeenLastCalledWith('/sign-in');
        await user.press(screen.getByRole('button', { name: 'Create account' }));
        expect(router.push).toHaveBeenLastCalledWith('/register');
      },
    );

    it('says why a previous session ended', async () => {
      await renderGate({
        status: 'signed_out',
        notice: 'Your session has ended. Please sign in again.',
      }).done;

      expect(screen.getByText('Your session has ended. Please sign in again.')).toBeOnTheScreen();
    });

    it('can render bare, without its own screen frame, inside an existing screen', async () => {
      await renderGate({ status: 'signed_out' }, { title: 'Orders', bare: true }).done;

      expect(screen.getByRole('button', { name: 'Sign in' })).toBeOnTheScreen();
      expect(screen.queryByRole('header', { name: 'Orders' })).not.toBeOnTheScreen();
    });
  });
});
