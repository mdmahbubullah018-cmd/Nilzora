import { SignedInGate } from '@/auth/signed-in-gate';
import { Screen, STACK_EDGES } from '@/components/screen';
import { NotificationSettings } from '@/features/notifications/notification-settings';
import { OrderUpdatesCard } from '@/notifications/order-updates-card';
import { ProductAnnouncementsCard } from '@/notifications/product-announcements-card';

/*
 * Settings -> Notifications.
 *
 * Ordered from the phone outwards: what this device is allowed to show, then what the account
 * chooses to be told, and finally the phone's own settings - the only place a refused system
 * permission can be granted.
 */
export default function SettingsScreen() {
  return (
    <SignedInGate purpose="manage your notifications" returnTo="/settings" edges={STACK_EDGES}>
      <Screen edges={STACK_EDGES}>
        <OrderUpdatesCard />
        <ProductAnnouncementsCard />
        <NotificationSettings />
      </Screen>
    </SignedInGate>
  );
}
