import { Tabs, useRouter } from 'expo-router';
import { TabBar, type TabBarItem } from '@/components/tab-bar';
import { badgeFor, hrefFor, TAB_BAR, TAB_DEFINITIONS } from '@/navigation/tabs';
import { theme } from '@/theme';
import { useWishlist } from '@/wishlist';

export default function TabsLayout() {
  const router = useRouter();
  const wishlist = useWishlist();

  return (
    <Tabs
      // A custom renderer, so the bar can float as a translucent slab instead of a full-width
      // opaque strip. `tabBarStyle` below is only the layer behind it (needed to keep content
      // from sitting under the floating bar).
      tabBar={(props) => {
        const items: TabBarItem[] = TAB_BAR.map((destination) => ({
          key: destination.key,
          label: destination.label,
          icon: destination.icon,
          activeIcon: destination.activeIcon,
          ...badgeFor(destination.key, wishlist.count),
        }));
        // Chat is a screen above the tabs, so it never owns a route index of its own.
        const current = props.state.routes[props.state.index]?.name;
        const activeIndex = Math.max(
          TAB_BAR.findIndex((destination) => destination.key === current),
          0,
        );

        return (
          <TabBar
            items={items}
            activeIndex={activeIndex}
            onSelect={(index) => {
              const destination = TAB_BAR[index];
              if (destination === undefined) return;
              // Chat opens the app's existing support screen; the other four switch tabs.
              if (destination.href !== undefined) {
                router.push(destination.href);
                return;
              }
              router.navigate(hrefFor(destination.key));
            }}
          />
        );
      }}
      screenOptions={{
        headerShown: false,
        // A quick cross-fade between tabs instead of a hard swap. The bar is drawn by the
        // custom renderer above, so only the scenes fade.
        animation: 'fade',
        transitionSpec: { animation: 'timing', config: { duration: 160 } },
        // link (#0369A1) keeps the small labels above 4.5:1 on white.
        tabBarActiveTintColor: theme.colors.link,
        tabBarInactiveTintColor: theme.colors.mutedForeground,
        tabBarStyle: { display: 'none' },
      }}
    >
      {Object.entries(TAB_DEFINITIONS).map(([name, definition]) => (
        <Tabs.Screen key={name} name={name} options={{ title: definition.label }} />
      ))}
    </Tabs>
  );
}
