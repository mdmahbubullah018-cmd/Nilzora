import { act, render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Animated, Text } from 'react-native';
import { AvailabilityBadge } from '../components/availability-badge';
import { ListScreen } from '../components/list-screen';
import { Price } from '../components/price';
import { Screen } from '../components/screen';
import { SectionHeader } from '../components/section-header';
import { ListSkeleton, Skeleton, SkeletonGroup } from '../components/skeleton';
import { listActions, refreshList } from '../test-utils/refresh';

describe('Price', () => {
  it('shows the price and is read as one phrase', async () => {
    await render(<Price priceMinor={125_000} />);

    expect(screen.getByText('৳1,250')).toBeOnTheScreen();
    expect(screen.getByLabelText('Price 1,250 taka')).toBeOnTheScreen();
  });

  it('strikes through a higher former price and speaks it', async () => {
    await render(<Price priceMinor={75_000} compareAtPriceMinor={100_000} />);

    expect(screen.getByText('৳1,000')).toHaveStyle({ textDecorationLine: 'line-through' });
    expect(screen.getByLabelText('Price 750 taka, was 1,000 taka')).toBeOnTheScreen();
    expect(screen.queryByText('Save 25%')).not.toBeOnTheScreen();
  });

  it('shows the offer badge when asked, and includes it in the spoken label', async () => {
    await render(<Price priceMinor={75_000} compareAtPriceMinor={100_000} showSaving />);

    expect(screen.getByText('Save 25%')).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Price 750 taka, was 1,000 taka, save 25 percent'),
    ).toBeOnTheScreen();
  });

  it.each([null, undefined, 75_000, 50_000])(
    'ignores a former price of %p that is not higher',
    async (compareAt) => {
      await render(<Price priceMinor={75_000} compareAtPriceMinor={compareAt} showSaving />);

      expect(screen.getByLabelText('Price 750 taka')).toBeOnTheScreen();
      expect(screen.queryByText(/Save/)).not.toBeOnTheScreen();
    },
  );
});

describe('AvailabilityBadge', () => {
  it.each([
    ['in_stock', 'In stock'],
    ['low_stock', 'Only a few left'],
    ['out_of_stock', 'Out of stock'],
  ] as const)('labels %s in words, not just colour', async (availability, label) => {
    await render(<AvailabilityBadge availability={availability} />);

    expect(screen.getByText(label)).toBeOnTheScreen();
    expect(screen.getByLabelText(`Availability: ${label}`)).toBeOnTheScreen();
  });
});

describe('SectionHeader', () => {
  it('shows a title only, or a "See all" action with a specific spoken name', async () => {
    const onActionPress = jest.fn();
    const user = userEvent.setup();
    const { rerender } = await render(<SectionHeader title="Featured" />);
    expect(screen.getByRole('header', { name: 'Featured' })).toBeOnTheScreen();
    expect(screen.queryByText('See all')).not.toBeOnTheScreen();

    await rerender(<SectionHeader title="Featured" onActionPress={onActionPress} />);
    await user.press(screen.getByRole('link', { name: 'See all: Featured' }));
    expect(onActionPress).toHaveBeenCalledTimes(1);
  });

  it('accepts its own action wording', async () => {
    await render(
      <SectionHeader
        title="Categories"
        actionLabel="Browse"
        actionAccessibilityLabel="Browse every category"
        onActionPress={jest.fn()}
      />,
    );

    expect(screen.getByRole('link', { name: 'Browse every category' })).toBeOnTheScreen();
    expect(screen.getByText('Browse')).toBeOnTheScreen();
  });
});

describe('Skeleton', () => {
  it('is a single busy progress element and hides its blocks from screen readers', async () => {
    await render(
      <SkeletonGroup label="Loading products">
        <Skeleton testID="block" />
        <Skeleton />
      </SkeletonGroup>,
    );

    expect(screen.getByRole('progressbar', { name: 'Loading products' })).toBeBusy();
    expect(screen.queryByTestId('block')).not.toBeOnTheScreen(); // hidden from accessibility
    expect(screen.getByTestId('block', { includeHiddenElements: true })).toBeTruthy();
  });

  it('pulses while it is shown and stops when it goes away', async () => {
    const start = jest.fn();
    const stop = jest.fn();
    const loop = jest.spyOn(Animated, 'loop').mockReturnValue({ start, stop } as never);
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValueOnce(false);

    const { unmount } = await render(
      <SkeletonGroup>
        <Skeleton />
      </SkeletonGroup>,
    );
    await waitFor(() => {
      expect(start).toHaveBeenCalledTimes(1);
    });
    await unmount();

    expect(stop).toHaveBeenCalled();
    loop.mockRestore();
  });

  it('does not animate when the device asks to reduce motion', async () => {
    const loop = jest.spyOn(Animated, 'loop');
    await render(
      <SkeletonGroup>
        <Skeleton />
      </SkeletonGroup>,
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(loop).not.toHaveBeenCalled();
    loop.mockRestore();
  });

  it('renders a ListSkeleton with the requested number of rows', async () => {
    await render(<ListSkeleton rows={2} label="Loading orders" />);

    expect(screen.getByRole('progressbar', { name: 'Loading orders' })).toBeOnTheScreen();
  });
});

describe('Screen and ListScreen', () => {
  it('keep rendering title and content as before', async () => {
    await render(
      <Screen title="Cart">
        <Text>body</Text>
      </Screen>,
    );

    expect(screen.getByRole('header', { name: 'Cart' })).toBeOnTheScreen();
    expect(screen.getByText('body')).toBeOnTheScreen();
  });

  it('lets a Screen pull to refresh', async () => {
    const onRefresh = jest.fn();
    await render(
      <Screen title="Order" onRefresh={onRefresh} testID="scroll">
        <Text>body</Text>
      </Screen>,
    );

    await refreshList('scroll');
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('renders title, header, rows and the empty component of a list', async () => {
    const { rerender } = await render(
      <ListScreen
        title="Orders"
        header={<Text>logo row</Text>}
        listHeader={<Text>filters</Text>}
        data={['NZ100001', 'NZ100002']}
        keyExtractor={(id) => id}
        renderItem={({ item }) => <Text>{item}</Text>}
      />,
    );

    expect(screen.getByRole('header', { name: 'Orders' })).toBeOnTheScreen();
    expect(screen.getByText('logo row')).toBeOnTheScreen();
    expect(screen.getByText('filters')).toBeOnTheScreen();
    expect(screen.getByText('NZ100001')).toBeOnTheScreen();
    expect(screen.getByText('NZ100002')).toBeOnTheScreen();

    await rerender(
      <ListScreen
        title="Orders"
        data={[] as string[]}
        renderItem={({ item }) => <Text>{item}</Text>}
        ListEmptyComponent={<Text>No orders yet</Text>}
      />,
    );
    expect(screen.getByText('No orders yet')).toBeOnTheScreen();
  });

  it('wires pull-to-refresh into a list', async () => {
    const onRefresh = jest.fn();
    await render(
      <ListScreen
        data={['a']}
        testID="list"
        renderItem={({ item }) => <Text>{item}</Text>}
        onRefresh={onRefresh}
      />,
    );

    expect(listActions('list')).toEqual([{ name: 'refresh', label: 'Refresh' }]);
    await refreshList('list');
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('cannot be refreshed unless asked', async () => {
    await render(
      <ListScreen data={['a']} testID="list" renderItem={({ item }) => <Text>{item}</Text>} />,
    );

    expect(listActions('list')).toEqual([]);
  });
});
