import type { InventoryMovement, InventoryReason } from '@nilzora/contracts';
import { cn } from '@nilzora/ui';
import { Chip } from '@/components/admin-kit/chip';
import type { StatusTone } from '@/components/admin-kit/status-tones';
import type { Route } from 'next';
import Link from 'next/link';
import { formatCount, formatDateTime } from '@/lib/format';
import { AutoText } from '@/components/i18n/translate';

/*
 * Stock ledger entries as the inventory page and the product page show them. Every
 * change is signed in text (+ / −) and named, never shown by colour alone.
 */

export const INVENTORY_REASON: Record<InventoryReason, { label: string; tone: StatusTone }> = {
  initial_stock: { label: 'Opening stock', tone: 'primary' },
  order_placed: { label: 'Order placed', tone: 'violet' },
  order_cancelled: { label: 'Order cancelled', tone: 'neutral' },
  adjustment: { label: 'Adjustment', tone: 'warning' },
};

export function ReasonBadge({ reason }: { reason: InventoryReason }) {
  const style = INVENTORY_REASON[reason];
  return <Chip tone={style.tone}><AutoText value={style.label} /></Chip>;
}

/** "+12" or "−3", with the direction in words for assistive technology. */
export function StockChange({ change, className }: { change: number; className?: string }) {
  const added = change > 0;
  return (
    <span
      className={cn(
        'font-semibold tabular-nums',
        added ? 'text-success-ink' : 'text-danger-ink',
        className,
      )}
    >
      <span aria-hidden="true">{added ? '+' : '−'}</span>
      <span className="sr-only">{added ? 'Added ' : 'Removed '}</span>
      {formatCount(Math.abs(change))}
    </span>
  );
}

/** Who made a change: a staff name or email, the customer of an order, or the system. */
export function movementActor(movement: Pick<InventoryMovement, 'actor' | 'reason'>): string {
  if (!movement.actor) return 'System';
  const named = movement.actor.name ?? movement.actor.email;
  if (named) return named;
  return movement.reason === 'order_placed' || movement.reason === 'order_cancelled'
    ? 'Customer'
    : 'Staff account';
}

export function orderPath(orderNumber: string): Route {
  return `/admin/orders/${orderNumber}` as Route;
}

export function OrderLink({ orderNumber }: { orderNumber: string }) {
  return (
    <Link
      href={orderPath(orderNumber)}
      className="nz-tap rounded-sm font-mono text-xs font-medium text-link underline-offset-4 hover:underline"
    >
      {orderNumber}
    </Link>
  );
}

/** A product page's recent movements, newest first. */
export function RecentMovementList({ movements }: { movements: readonly InventoryMovement[] }) {
  return (
    <ol className="grid divide-y divide-hairline">
      {movements.map((movement) => (
        <li key={movement.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
          <StockChange change={movement.change} className="w-14 shrink-0 text-sm" />
          <div className="grid min-w-0 flex-1 gap-0.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <ReasonBadge reason={movement.reason} />
              {movement.orderNumber ? <OrderLink orderNumber={movement.orderNumber} /> : null}
            </div>
            {movement.note ? (
              <p className="text-xs break-words text-body"><AutoText value={movement.note} /></p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              <time dateTime={movement.createdAt}><AutoText value={formatDateTime(movement.createdAt)} /></time>
              {' · '}
              {movementActor(movement)}
            </p>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {formatCount(movement.stockAfter)} left
          </span>
        </li>
      ))}
    </ol>
  );
}
