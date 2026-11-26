import { act, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { useSupportSocket } from '@/features/support/use-support-socket';
import { renderHookWithProviders } from '@/test-utils/render-with-providers';
import { signedInState } from '@/test-utils/session-fakes';

type Handler = (...args: unknown[]) => void;

const mockSocket = {
  connected: true,
  handlers: new Map<string, Handler>(),
  on: jest.fn((event: string, handler: Handler) => {
    mockSocket.handlers.set(event, handler);
  }),
  emit: jest.fn(),
  connect: jest.fn(),
  disconnect: jest.fn(),
};
jest.mock('socket.io-client', () => ({ io: () => mockSocket }));
jest.mock('@/auth/api', () => ({
  ...jest.requireActual<object>('@/auth/api'),
  getMobileApiBaseUrl: () => 'https://api.example.test',
}));

// Every app-state subscriber (the providers' own included); a test sends the change to all.
const appStateListeners: ((state: AppStateStatus) => void)[] = [];
function changeAppState(state: AppStateStatus) {
  for (const listener of appStateListeners) listener(state);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSocket.connected = true;
  appStateListeners.length = 0;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListeners.push(listener);
    return { remove: () => undefined };
  });
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('support chat connection and the app lifecycle', () => {
  it('holds no connection while the app is away, and reconnects when it returns', async () => {
    await renderHookWithProviders(() => useSupportSocket(null), { session: signedInState() });
    // The socket is created once the session has produced a token.
    await waitFor(() => expect(mockSocket.on).toHaveBeenCalled());

    // Screen off / app in the background: the socket is closed, so nothing is sent or received.
    await act(() => {
      changeAppState('background');
      return Promise.resolve();
    });
    expect(mockSocket.disconnect).toHaveBeenCalled();

    // Back in the foreground: it connects again (with a current token), once.
    mockSocket.connected = false;
    await act(() => {
      changeAppState('active');
      return Promise.resolve();
    });
    expect(mockSocket.connect).toHaveBeenCalledTimes(1);
  });

  it('does not reconnect a connection that is already open', async () => {
    await renderHookWithProviders(() => useSupportSocket(null), { session: signedInState() });
    // The socket is created once the session has produced a token.
    await waitFor(() => expect(mockSocket.on).toHaveBeenCalled());
    await act(() => {
      changeAppState('active');
      return Promise.resolve();
    });
    expect(mockSocket.connect).not.toHaveBeenCalled();
  });
});
