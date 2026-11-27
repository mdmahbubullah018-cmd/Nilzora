import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
// Registers the native Google provider before any screen renders; a build without a web
// client id registers nothing and the sign-in screen keeps its button hidden.
import { registerNativeGoogleSignIn } from '@/auth/google-native';
import { CartButton } from '@/components/cart-button';
import { OfflineBanner } from '@/components/offline-banner';
import { OnboardingGate } from '@/features/onboarding/onboarding-gate';
import { PromoPopup } from '@/features/popup/promo-popup';
import { NotificationBridge } from '@/notifications/notification-bridge';
import { LiveEvents } from '@/features/events/live-events';
import { AppProviders } from '@/providers';
import { holdNativeSplash, StartupSplash } from '@/startup/startup-splash';
import { startupMark } from '@/startup/startup-timing';
import { theme } from '@/theme';

startupMark('js:root-layout');
registerNativeGoogleSignIn();
// The native splash stays up until the animated splash (StartupSplash) has drawn its first
// frame over the app; see src/startup/startup-splash.tsx for the whole launch sequence.
holdNativeSplash();

/** Header for stack screens opened above the tabs. */
const stackHeader = {
  headerShown: true,
  headerStyle: { backgroundColor: theme.colors.surfaceMuted },
  headerTintColor: theme.colors.link,
  headerTitleStyle: { color: theme.colors.foreground, fontWeight: theme.fontWeights.semibold },
  headerShadowVisible: false,
} as const;

/**
 * A stack screen that names itself in its own content (auth screens, a category). The bar
 * keeps only the back affordance: two titles for one screen reads as a mistake.
 */
const contentTitledHeader = { ...stackHeader, headerTitle: '' } as const;

/** The cart, in the header of a shopping screen opened above the tabs (where there is no bar). */
const cartHeaderButton = { headerRight: () => <CartButton /> } as const;

export default function RootLayout() {
  return (
    // Gesture Handler needs a root view above every gesture (the branded pull-to-refresh).
    <GestureHandlerRootView style={styles.root}>
      <AppProviders>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.colors.surfaceMuted },
            // One push animation for every stack screen. `slide_from_right` is the Android
            // transition (on iOS it resolves to the platform's own push); the system's swipe-back
            // gesture is left at its default, and a screen that must hold the customer (Checkout
            // while an order is placing) switches it off for itself.
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="shop"
            options={{ ...stackHeader, ...cartHeaderButton, title: 'Shop' }}
          />
          {/* A category draws its own header (back, name, cart): the native bar hides its back
            button when the page is the first route, as it is after a deep link or a
            notification. */}
          <Stack.Screen name="category/[slug]" options={{ headerShown: false }} />
          <Stack.Screen
            name="product/[slug]"
            options={{ ...stackHeader, ...cartHeaderButton, title: 'Product' }}
          />
          <Stack.Screen name="visual-search" options={{ headerShown: false }} />
          <Stack.Screen
            name="brands/index"
            options={{ ...stackHeader, ...cartHeaderButton, title: 'Brands' }}
          />
          <Stack.Screen
            name="brand/[slug]"
            options={{ ...stackHeader, ...cartHeaderButton, title: 'Brand' }}
          />
          <Stack.Screen name="orders" options={{ ...stackHeader, title: 'Orders' }} />
          {/* The voucher screens and a receipt are stack screens too. Registering them here is
            what gives them a header: the navigator's default hides it, and a screen that pads
            only the bottom would then start under the status bar with no way back. */}
          <Stack.Screen name="vouchers" options={{ ...stackHeader, title: 'Vouchers' }} />
          <Stack.Screen name="my-vouchers" options={{ ...stackHeader, title: 'My Vouchers' }} />
          {/* The account's notification history: a stack screen for the same reason. */}
          <Stack.Screen name="notifications" options={{ ...stackHeader, title: 'Notifications' }} />
          <Stack.Screen name="receipt/[orderNumber]" options={contentTitledHeader} />
          {/* The confirmation shown straight after checkout. It sits here for the same reason:
            a header with a way back, above the status bar. */}
          <Stack.Screen name="order-success/[orderNumber]" options={contentTitledHeader} />
          <Stack.Screen name="profile" options={{ ...stackHeader, title: 'Profile details' }} />
          <Stack.Screen name="payment" options={{ ...stackHeader, title: 'Payment information' }} />
          <Stack.Screen name="settings" options={{ ...stackHeader, title: 'Settings' }} />
          <Stack.Screen name="cart" options={{ ...stackHeader, title: 'Cart' }} />
          {/* Search draws its own header so the field can take focus on arrival. It fades in
            rather than sliding: it is a mode the customer enters, not a deeper page. */}
          <Stack.Screen
            name="search"
            options={{ headerShown: false, animation: 'fade', animationDuration: 200 }}
          />
          <Stack.Screen name="checkout" options={{ ...stackHeader, title: 'Checkout' }} />
          {/* Support titles itself below the bar, so the bar only carries the way back — which is
            also what keeps the title clear of the Android status bar. */}
          <Stack.Screen name="support/index" options={contentTitledHeader} />
          <Stack.Screen name="support/[conversationId]" options={contentTitledHeader} />
          <Stack.Screen name="order/[orderNumber]" options={{ ...stackHeader, title: 'Order' }} />
          <Stack.Screen name="addresses/index" options={{ ...stackHeader, title: 'Addresses' }} />
          <Stack.Screen name="addresses/new" options={{ ...stackHeader, title: 'New address' }} />
          <Stack.Screen
            name="addresses/[addressId]"
            options={{ ...stackHeader, title: 'Edit address' }}
          />
          <Stack.Screen name="sign-in" options={contentTitledHeader} />
          <Stack.Screen name="register" options={contentTitledHeader} />
          <Stack.Screen name="verify-email" options={contentTitledHeader} />
          <Stack.Screen name="forgot-password" options={contentTitledHeader} />
          <Stack.Screen name="reset-password" options={contentTitledHeader} />
          <Stack.Screen name="store" options={contentTitledHeader} />
          {/* The information pages name themselves in their content, like the store screen. */}
          <Stack.Screen name="about" options={contentTitledHeader} />
          <Stack.Screen name="faq" options={contentTitledHeader} />
          <Stack.Screen name="privacy" options={contentTitledHeader} />
          <Stack.Screen name="terms" options={contentTitledHeader} />
          <Stack.Screen name="returns-policy" options={contentTitledHeader} />
          <Stack.Screen name="delivery-policy" options={contentTitledHeader} />
          {/* Each returns screen titles itself; the bar gives the way back to the account. */}
          <Stack.Screen name="returns" options={contentTitledHeader} />
          <Stack.Screen name="returns/new" options={contentTitledHeader} />
          <Stack.Screen name="returns/[returnId]" options={contentTitledHeader} />
        </Stack>
        <OfflineBanner />
        <NotificationBridge />
        <LiveEvents />
        <OnboardingGate />
        {/* Waits for the launch sequence to release the screen (see the overlay claim). */}
        <PromoPopup />
        <StartupSplash />
        <StatusBar style="dark" />
      </AppProviders>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
