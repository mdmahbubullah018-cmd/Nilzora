import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { OfflineBanner } from '@/components/offline-banner';
import { QueryState } from '@/components/query-state';
import { PlaceOrderButton } from '@/features/checkout/place-order-button';
import { reportConnection, resetConnection } from '@/network/connectivity';

const METRICS = {
  frame: { x: 0, y: 0, width: 360, height: 800 },
  insets: { top: 24, left: 0, right: 0, bottom: 0 },
};

afterEach(() => {
  resetConnection();
});

describe('offline experience', () => {
  it('shows a quiet pill only while offline, and takes it away when the server answers', async () => {
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <OfflineBanner />
      </SafeAreaProvider>,
    );
    expect(screen.queryByTestId('offline-banner')).not.toBeOnTheScreen();

    await act(() => {
      reportConnection(false);
      return Promise.resolve();
    });
    expect(screen.getByText('You are offline. Showing saved information.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Check the connection again' })).toBeOnTheScreen();

    await act(() => {
      reportConnection(true);
      return Promise.resolve();
    });
    expect(screen.queryByTestId('offline-banner')).not.toBeOnTheScreen();
  });

  it('never offers to place an order that the server could not confirm', async () => {
    const onPress = jest.fn();
    await render(
      <PlaceOrderButton totalMinor={226_000} loading={false} disabled={false} onPress={onPress} />,
    );
    expect(screen.getByRole('button', { name: /Place order, total/ })).toBeEnabled();

    await act(() => {
      reportConnection(false);
      return Promise.resolve();
    });
    const button = screen.getByRole('button', { name: /Place order, total/ });
    expect(button).toBeDisabled();
    expect(screen.getByText('You are offline')).toBeOnTheScreen();
  });

  it('says a screen with nothing saved is offline, instead of loading forever', async () => {
    await render(
      <QueryState
        query={{
          status: 'pending',
          data: undefined,
          error: null,
          refetch: jest.fn(),
          fetchStatus: 'paused',
        }}
      >
        {() => null}
      </QueryState>,
    );
    expect(screen.getByText('You are offline')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen();
  });

  it('keeps showing saved data when a refresh could not run', async () => {
    await render(
      <QueryState
        query={{
          status: 'success',
          data: ['saved'],
          error: null,
          refetch: jest.fn(),
          fetchStatus: 'paused',
        }}
      >
        {(rows) => <Text>{`${String(rows.length)} saved`}</Text>}
      </QueryState>,
    );
    expect(screen.getByText('1 saved')).toBeOnTheScreen();
    expect(screen.queryByText('You are offline')).not.toBeOnTheScreen();
  });
});
