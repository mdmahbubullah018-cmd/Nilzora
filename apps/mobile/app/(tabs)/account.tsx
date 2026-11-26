import { useRouter } from 'expo-router';
import { ChevronRight, CloudOff, Settings } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import {
  clearAccountSnapshot,
  loadAccountSnapshot,
  saveAccountSnapshot,
} from '@/auth/account-snapshot';
import { useSession, useSignedInUserId } from '@/auth/session-context';
import type { SessionUser } from '@/auth/session-manager';
import { Avatar } from '@/components/avatar';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { AppIcon } from '@/components/icon';
import { ListItem } from '@/components/list-item';
import { Notice } from '@/components/notice';
import { Screen } from '@/components/screen';
import { SoftWash } from '@/components/soft-wash';
import { TAB_BAR_SPACE } from '@/components/tab-bar';
import { TabHeader } from '@/components/tab-header';
import { useCart } from '@/cart/cart-context';
import { ADDRESSES_HREF } from '@/features/addresses/routes';
import { ORDERS_HREF, PAYMENT_HREF, PROFILE_HREF, SETTINGS_HREF } from '@/features/profile/routes';
import { SUPPORT_HREF } from '@/features/support/routes';
import { useUnreadNotificationCount } from '@/features/notifications/notification-hooks';
import { ReviewPrompt } from '@/features/reviews/review-prompt';
import { useSignOut } from '@/notifications/use-sign-out';
import { queryKeys } from '@/query/query-keys';
import { useManualRefresh } from '@/query/use-manual-refresh';
import { theme } from '@/theme';
import { useWishlist } from '@/wishlist';

/*
 * The Account center.
 *
 * Everything about the customer's own account in one place: who they are, their orders and
 * saved items, how they pay, and how to reach the store. Every row opens a screen that
 * exists; nothing is listed here that Nilzora does not actually offer (there are no saved
 * cards, because Nilzora takes cash on delivery only).
 */

/** The title above a group of rows. */
function GroupLabel({ children }: { children: string }) {
  return (
    <Text accessibilityRole="header" style={styles.groupLabel}>
      {children}
    </Text>
  );
}

/** One group of rows in a card, with its name above it. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <GroupLabel>{title}</GroupLabel>
      <Card>{children}</Card>
    </View>
  );
}

/** A small count before the chevron (units in the cart, products saved). */
function Count({ value, label }: { value: number; label: string }) {
  return (
    <View accessible accessibilityLabel={`${value} ${label}`} style={styles.count}>
      <Text style={styles.countText}>{value > 99 ? '99+' : String(value)}</Text>
    </View>
  );
}

function SignOutButton() {
  // Also removes this device's push token from the account before the session is cleared.
  const { signOut, signingOut } = useSignOut();

  return (
    <Button
      label="Sign out"
      variant="danger"
      loading={signingOut}
      accessibilityHint="Ends your session on this device"
      onPress={() => void signOut()}
    />
  );
}

/**
 * Ends the account screen. It takes the room left under the rows, so it sits at the foot of the
 * page when the account is shorter than the screen, and stays in normal flow — never over a
 * row — when the list is longer. `marginTop: 'auto'` is a flex rule, not an absolute offset, so
 * nothing can overlap whatever is above it.
 */
function SignOutFooter() {
  return (
    <View style={styles.signOut}>
      <SignOutButton />
    </View>
  );
}

/**
 * Who is signed in, and the way to their details. The whole block is one control.
 *
 * A pale blue card with the avatar, the name and the row that opens the profile: the light
 * counterpart of the navy panel this header used to be, so the account screen opens bright and
 * the navy is kept for the words that carry the meaning.
 */
function AccountHeader({ user }: { user: SessionUser }) {
  const router = useRouter();
  const name = user.profile.fullName?.trim() || user.email || 'Nilzora customer';
  const detail = user.profile.phone ?? user.email;
  const since = formatMemberSince(user.profile.createdAt);

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Profile details for ${name}`}
      accessibilityHint="Opens your name, picture and phone number"
      android_ripple={{ color: 'rgba(2, 132, 199, 0.12)' }}
      onPress={() => {
        router.push(PROFILE_HREF);
      }}
      style={({ pressed }) => [styles.header, pressed ? styles.headerPressed : null]}
    >
      <SoftWash />
      <View style={styles.headerTop}>
        <Avatar
          name={name}
          size="lg"
          tone="light"
          seed={user.email ?? name}
          pictureUrl={user.profile.avatar?.thumbUrl ?? user.profile.googleAvatar ?? null}
        />
        <View style={styles.headerText}>
          <Text numberOfLines={1} style={styles.headerName}>
            {name}
          </Text>
          {detail ? (
            <Text numberOfLines={1} style={styles.headerDetail}>
              {detail}
            </Text>
          ) : null}
          {since ? <Text style={styles.headerSince}>{since}</Text> : null}
        </View>
      </View>
      <View style={styles.headerAction}>
        <Text style={styles.headerActionText}>Edit profile</Text>
        <ChevronRight size={16} color={theme.colors.link} accessible={false} />
      </View>
    </Pressable>
  );
}

/** "Member since March 2025", from the date the API records for the profile. */
function formatMemberSince(createdAt: string): string | null {
  if (!createdAt) return null;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  const month = new Intl.DateTimeFormat('en-GB', { month: 'long' }).format(date);
  return `Member since ${month} ${String(date.getFullYear())}`;
}

/** The rows every visitor can use, signed in or not. */
function SupportRows() {
  const router = useRouter();
  return (
    <Group title="Support">
      <ListItem
        icon="help"
        label="Help & support"
        hint="Opens your support conversations"
        onPress={() => router.push(SUPPORT_HREF)}
      />
      <ListItem
        icon="shop"
        label="Contact Nilzora"
        hint="Opens the store's phone, email and address"
        onPress={() => router.push('/store')}
        last
      />
    </Group>
  );
}

/** The information pages, available whether or not anyone is signed in. */
function InformationRows() {
  const router = useRouter();
  return (
    <Group title="Information">
      <ListItem
        icon="info"
        label="About Nilzora"
        hint="Opens what the store is and how shopping works"
        onPress={() => router.push('/about')}
      />
      <ListItem
        icon="question"
        label="Frequently asked questions"
        hint="Opens short answers about orders, delivery, returns and accounts"
        onPress={() => router.push('/faq')}
      />
      <ListItem
        icon="delivery"
        label="Delivery policy"
        hint="Opens where the store delivers and how delivery works"
        onPress={() => router.push('/delivery-policy')}
      />
      <ListItem
        icon="returns"
        label="Returns and refunds policy"
        hint="Opens how returns and refunds are handled"
        onPress={() => router.push('/returns-policy')}
      />
      <ListItem
        icon="shield"
        label="Privacy policy"
        hint="Opens what the store keeps and why"
        onPress={() => router.push('/privacy')}
      />
      <ListItem
        icon="document"
        label="Terms of service"
        hint="Opens the rules for shopping with the store"
        onPress={() => router.push('/terms')}
        last
      />
    </Group>
  );
}

function ShoppingRows() {
  const router = useRouter();
  const cart = useCart();
  const wishlist = useWishlist();
  const notificationUnread = useUnreadNotificationCount();
  return (
    <Group title="Shopping">
      <ListItem
        icon="orders"
        label="My orders"
        hint="Opens your full order history"
        onPress={() => router.push(ORDERS_HREF)}
      />
      <ListItem
        icon="wishlist"
        label="Wishlist"
        hint="Opens the products you saved"
        trailing={wishlist.count > 0 ? <Count value={wishlist.count} label="saved" /> : undefined}
        onPress={() => router.navigate('/wishlist')}
      />
      <ListItem
        icon="voucher"
        label="My Vouchers"
        hint="Opens the vouchers you collected"
        onPress={() => router.push('/my-vouchers')}
      />
      <ListItem
        icon="notifications"
        label="Notifications"
        hint="Order, payment, return and refund updates"
        trailing={
          notificationUnread.data !== undefined && notificationUnread.data > 0 ? (
            <Count value={notificationUnread.data} label="unread" />
          ) : undefined
        }
        onPress={() => router.push('/notifications')}
      />
      <ListItem
        icon="voucher"
        label="Voucher Center"
        hint="Opens vouchers you can collect"
        onPress={() => router.push('/vouchers')}
      />
      <ListItem
        icon="cart"
        label="Cart"
        hint="Opens your cart"
        trailing={cart.count > 0 ? <Count value={cart.count} label="items" /> : undefined}
        onPress={() => router.navigate('/cart')}
      />
      <ListItem
        icon="location"
        label="Saved addresses"
        hint="Opens your delivery addresses"
        onPress={() => router.push(ADDRESSES_HREF)}
      />
      <ListItem
        icon="returns"
        label="Returns"
        hint="Opens the items you are sending back"
        onPress={() => router.push('/returns')}
        last
      />
    </Group>
  );
}

function AccountRows() {
  const router = useRouter();
  return (
    <Group title="Account">
      <ListItem
        icon="profile"
        label="Profile details"
        hint="Opens your name, picture and phone number"
        onPress={() => router.push(PROFILE_HREF)}
      />
      <ListItem
        icon="cash"
        label="Payment information"
        hint="Explains how Nilzora takes payment"
        onPress={() => router.push(PAYMENT_HREF)}
        last
      />
    </Group>
  );
}

function PreferenceRows() {
  const router = useRouter();
  return (
    <Group title="Preferences">
      <ListItem
        icon="notifications"
        label="Settings"
        hint="Opens your order-update notifications"
        onPress={() => router.push(SETTINGS_HREF)}
        last
      />
    </Group>
  );
}

/** The three things an account actually does, said in the customer's own terms. */
const GUEST_BENEFITS = [
  { icon: 'orders', text: 'Follow every order from checkout to your door.' },
  { icon: 'location', text: 'Save the addresses you order to most often.' },
  { icon: 'wishlist', text: 'Keep your wishlist with your profile, on any phone.' },
] as const;

/**
 * The signed-out account.
 *
 * A guest still gets a finished screen: one pale blue welcome card that says what an account is
 * for and offers the two ways in, then the help and information rows every visitor can use. It
 * is the same card language as the signed-in header above, so signing in changes the content and
 * not the design.
 */
function SignedOut({ notice }: { notice: string | undefined }) {
  const router = useRouter();
  return (
    <>
      {notice ? <Notice tone="warning">{notice}</Notice> : null}
      <View style={styles.guest}>
        <SoftWash />
        <View style={styles.guestHead}>
          <View style={styles.guestBadge}>
            <AppIcon name="profile" size="lg" color={theme.colors.primaryAction} />
          </View>
          <View style={styles.guestHeadText}>
            <Text accessibilityRole="header" style={styles.guestTitle}>
              Sign in to Nilzora
            </Text>
            <Text style={styles.guestBody}>
              Your orders, addresses and saved products stay with your profile.
            </Text>
          </View>
        </View>
        <View style={styles.guestBenefits}>
          {GUEST_BENEFITS.map((benefit) => (
            <View key={benefit.text} style={styles.guestBenefit}>
              <AppIcon name={benefit.icon} size="sm" color={theme.colors.primaryAction} />
              <Text style={styles.guestBenefitText}>{benefit.text}</Text>
            </View>
          ))}
        </View>
        <View style={styles.guestActions}>
          <Button label="Sign in" onPress={() => router.push('/sign-in')} />
          <Button
            label="Create account"
            variant="secondary"
            onPress={() => router.push('/register')}
          />
        </View>
      </View>
      <SupportRows />
      <InformationRows />
    </>
  );
}

function SignedIn({ user }: { user: SessionUser }) {
  return (
    <>
      <AccountHeader user={user} />
      <ShoppingRows />
      <AccountRows />
      <SupportRows />
      <InformationRows />
      <PreferenceRows />
      <SignOutFooter />
    </>
  );
}

function Pending({ label }: { label: string }) {
  return (
    <Card style={styles.padded}>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={label}
        style={styles.loading}
      >
        <ActivityIndicator color={theme.colors.link} />
        <Text style={styles.muted}>{label}…</Text>
      </View>
    </Card>
  );
}

/**
 * The account details saved on this phone, while the server cannot be reached. Written after the
 * server confirms the account, removed when the account signs out (see account-snapshot.ts).
 */
function useSavedAccount(state: { status: string; user?: SessionUser }): SessionUser | null {
  const [saved, setSaved] = useState<SessionUser | null>(null);
  const status = state.status;
  const user = state.status === 'signed_in' ? (state.user ?? null) : null;
  useEffect(() => {
    if (user !== null) void saveAccountSnapshot(user);
  }, [user]);
  useEffect(() => {
    if (status === 'signed_out') void clearAccountSnapshot();
    if (status !== 'offline') return;
    let alive = true;
    void loadAccountSnapshot().then((found) => {
      if (alive) setSaved(found);
    });
    return () => {
      alive = false;
    };
  }, [status]);
  return status === 'offline' ? saved : null;
}

export default function AccountScreen() {
  const { state, manager } = useSession();
  const savedAccount = useSavedAccount(state);
  const signedInUserId = useSignedInUserId();
  const queryClient = useQueryClient();
  // The account's own server data on this tab: the unread-notification badge. Only offered while
  // signed in (the pull is paused otherwise), so it never asks for an account that is not there.
  const { onRefresh } = useManualRefresh(() =>
    queryClient.refetchQueries(
      { queryKey: queryKeys.notifications.unread(signedInUserId), type: 'active' },
      { throwOnError: true },
    ),
  );

  let content: ReactNode;
  if (state.status === 'unconfigured' || manager === null) {
    content = (
      <Card>
        <EmptyState
          icon={Settings}
          title="Sign-in is not available"
          description="This build has no valid API address (EXPO_PUBLIC_API_BASE_URL), so it cannot reach Nilzora."
        />
      </Card>
    );
  } else if (state.status === 'restoring') {
    content = <Pending label="Checking your sign-in" />;
  } else if (state.status === 'signed_out') {
    content = <SignedOut notice={state.notice} />;
  } else if (state.status === 'signed_in') {
    content = (
      <>
        <SignedIn user={state.user} />
        {/* One quiet sheet about a delivered product still to review (the server decides). */}
        <ReviewPrompt />
      </>
    );
  } else if (state.status === 'offline' && savedAccount !== null) {
    // Offline, but this phone knows who is signed in: the account stays usable, clearly as saved
    // information. Anything that needs the server says so when it is tried.
    content = (
      <>
        <Notice tone="info" title="You are offline">
          Showing the account details saved on this phone. Orders, vouchers and support load when
          you are back online.
        </Notice>
        <SignedIn user={savedAccount} />
        <Button label="Try again" variant="secondary" onPress={() => void manager.restore()} />
      </>
    );
  } else if (state.status === 'offline') {
    content = (
      <>
        <Card>
          <EmptyState
            icon={CloudOff}
            title="Nilzora could not be reached"
            description="Your account could not be checked right now. Check your connection, then try again."
          />
        </Card>
        <Button label="Try again" onPress={() => void manager.restore()} />
        <SignOutFooter />
      </>
    );
  } else {
    content = (
      <>
        <Notice tone="danger" title="Account suspended">
          This account is suspended. Contact Nilzora support for help.
        </Notice>
        <SignOutFooter />
      </>
    );
  }

  return (
    <Screen
      title="Account"
      header={<TabHeader />}
      bottomSpace={TAB_BAR_SPACE}
      onRefresh={onRefresh}
      refreshEnabled={signedInUserId !== null}
    >
      {content}
    </Screen>
  );
}

const styles = StyleSheet.create({
  signOut: { marginTop: 'auto' },
  group: { gap: theme.spacing[2] },
  groupLabel: { color: theme.colors.mutedForeground, ...theme.text.caption, letterSpacing: 0.4 },
  header: {
    gap: theme.spacing[4],
    padding: theme.spacing[5],
    borderRadius: theme.radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.accentBorder,
    backgroundColor: theme.colors.accentSurface,
    overflow: 'hidden',
    ...theme.shadow.card,
  },
  headerPressed: { opacity: 0.92 },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[4],
  },
  headerText: { flex: 1, gap: 2 },
  headerName: { color: theme.colors.foreground, ...theme.text.heading, fontSize: 19 },
  headerDetail: { color: theme.colors.body, ...theme.text.body },
  headerSince: {
    color: theme.colors.mutedForeground,
    ...theme.text.caption,
    marginTop: 2,
  },
  headerAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.radii.full,
    borderWidth: 1,
    borderColor: theme.colors.accentBorder,
    backgroundColor: theme.colors.surface,
  },
  headerActionText: {
    color: theme.colors.link,
    ...theme.text.bodyStrong,
  },
  padded: { padding: theme.spacing[5], gap: theme.spacing[4] },
  /** The guest's welcome card: the pale blue field the signed-in header uses. */
  guest: {
    gap: theme.spacing[5],
    padding: theme.spacing[5],
    borderRadius: theme.radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.accentBorder,
    backgroundColor: theme.colors.accentSurface,
    overflow: 'hidden',
    ...theme.shadow.card,
  },
  guestHead: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[4] },
  guestBadge: {
    width: 52,
    height: 52,
    borderRadius: theme.radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.accentBorder,
  },
  guestHeadText: { flex: 1, gap: 2 },
  guestTitle: { color: theme.colors.foreground, ...theme.text.heading, fontSize: 19 },
  guestBody: { color: theme.colors.body, ...theme.text.body },
  guestBenefits: { gap: theme.spacing[2] },
  guestBenefit: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3] },
  guestBenefitText: { flex: 1, color: theme.colors.body, ...theme.text.body },
  guestActions: { gap: theme.spacing[3] },
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[3],
    minHeight: theme.touchTarget,
  },
  muted: { color: theme.colors.mutedForeground, ...theme.text.body },
  count: {
    minWidth: 24,
    height: 22,
    paddingHorizontal: 7,
    borderRadius: theme.radii.full,
    backgroundColor: theme.colors.infoSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: {
    color: theme.colors.primaryAction,
    fontSize: 12,
    fontWeight: theme.fontWeights.semibold,
  },
});
