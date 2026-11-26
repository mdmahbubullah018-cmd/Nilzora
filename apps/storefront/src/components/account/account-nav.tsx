import { cn } from '@nilzora/ui';
import { AccountTabs, type AccountTab } from './account-tabs';

/** Every part of the account, in the order it is reached. */
const ACCOUNT_LINKS: readonly AccountTab[] = [
  { href: '/account', label: 'Overview' },
  { href: '/account/orders', label: 'Orders' },
  { href: '/account/returns', label: 'Returns' },
  { href: '/account/addresses', label: 'Addresses' },
  { href: '/account/vouchers', label: 'Vouchers' },
  { href: '/account/notifications', label: 'Notifications' },
  { href: '/account/support', label: 'Support' },
];

export type AccountSection = (typeof ACCOUNT_LINKS)[number]['href'];

/**
 * One row of the account's sections, so every account page carries the same way around it:
 * a swipeable rail on a phone, a single tidy row from `sm`. The current section is the only
 * filled pill and the only one marked `aria-current`, so the page a visitor is on is never
 * in doubt, and a section is always one tap away instead of a trip back to the overview.
 *
 * The row itself is the client component that keeps the current pill in view; this page-level
 * wrapper accepts the same `className` the pages already pass.
 */
export function AccountNav({
  current,
  className,
}: {
  current: AccountSection;
  className?: string;
}) {
  return (
    // `min-w-0` matters: the account pages sit this row in a grid, and without it the row's
    // own min-content (six pills) widens the whole page instead of scrolling inside the rail.
    <div className={cn('min-w-0', className)}>
      <AccountTabs tabs={ACCOUNT_LINKS} current={current} label="Your account" />
    </div>
  );
}
