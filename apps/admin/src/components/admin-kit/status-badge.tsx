import type {
  AppRole,
  ModerationStatus,
  ModerationTaskStatus,
  OrderStatus,
  PaymentStatus,
  ProductStatus,
  ProfileStatus,
} from '@nilzora/contracts';
import { LOW_STOCK_THRESHOLD } from '@nilzora/contracts';
import { Chip } from './chip';
import type { StatusTone } from './status-tones';
import { roleLabel } from '@/lib/identity';
import type { ChartTone } from './charts/tones';

/*
 * One label and tone per status, so every screen names a status the same way. Records
 * over the contract enums: a new status fails typecheck until it is labelled here.
 * Badges always carry the label as text; colour only reinforces it.
 */

interface StatusStyle {
  label: string;
  tone: StatusTone;
}

export const ORDER_STATUS: Record<OrderStatus, StatusStyle> = {
  pending: { label: 'Pending', tone: 'warning' },
  confirmed: { label: 'Confirmed', tone: 'primary' },
  processing: { label: 'Processing', tone: 'violet' },
  shipped: { label: 'Shipped', tone: 'primary' },
  delivered: { label: 'Delivered', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

/**
 * Chart colours for order statuses (the donut and any per-status chart): six distinct
 * hues in both themes, ordered so neighbouring statuses stay easy to tell apart.
 */
export const ORDER_STATUS_CHART_TONE: Record<OrderStatus, ChartTone> = {
  pending: 'warning',
  confirmed: 'moderator',
  processing: 'violet',
  shipped: 'primary',
  delivered: 'success',
  cancelled: 'neutral',
};

export const PAYMENT_STATUS: Record<PaymentStatus, StatusStyle> = {
  pending: { label: 'Cash pending', tone: 'warning' },
  collected: { label: 'Cash collected', tone: 'success' },
  cancelled: { label: 'Not due', tone: 'neutral' },
};

export const PRODUCT_STATUS: Record<ProductStatus, StatusStyle> = {
  draft: { label: 'Draft', tone: 'neutral' },
  active: { label: 'On sale', tone: 'success' },
  archived: { label: 'Archived', tone: 'neutral' },
};

/** A product's content review state. */
export const MODERATION_STATUS: Record<ModerationStatus, StatusStyle> = {
  not_submitted: { label: 'Not submitted', tone: 'neutral' },
  pending: { label: 'In review', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  changes_requested: { label: 'Changes requested', tone: 'violet' },
  rejected: { label: 'Rejected', tone: 'danger' },
};

/** One review task's outcome. */
export const MODERATION_TASK_STATUS: Record<ModerationTaskStatus, StatusStyle> = {
  pending: { label: 'Pending', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  changes_requested: { label: 'Changes requested', tone: 'violet' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};

export const ACCOUNT_STATUS: Record<ProfileStatus, StatusStyle> = {
  active: { label: 'Active', tone: 'success' },
  suspended: { label: 'Suspended', tone: 'danger' },
};

const ROLE_TONE: Record<AppRole, StatusTone> = {
  super_admin: 'violet',
  admin: 'primary',
  staff: 'neutral',
  moderator: 'moderator',
  customer: 'neutral',
};

function StatusBadge({ style, className }: { style: StatusStyle; className?: string }) {
  return (
    <Chip tone={style.tone} dot className={className}>
      {style.label}
    </Chip>
  );
}

interface BadgeOf<T> {
  status: T;
  className?: string;
}

export function OrderStatusBadge({ status, className }: BadgeOf<OrderStatus>) {
  return <StatusBadge style={ORDER_STATUS[status]} className={className} />;
}

export function PaymentStatusBadge({ status, className }: BadgeOf<PaymentStatus>) {
  return <StatusBadge style={PAYMENT_STATUS[status]} className={className} />;
}

export function ProductStatusBadge({ status, className }: BadgeOf<ProductStatus>) {
  return <StatusBadge style={PRODUCT_STATUS[status]} className={className} />;
}

export function ModerationStatusBadge({ status, className }: BadgeOf<ModerationStatus>) {
  return <StatusBadge style={MODERATION_STATUS[status]} className={className} />;
}

export function ModerationTaskStatusBadge({ status, className }: BadgeOf<ModerationTaskStatus>) {
  return <StatusBadge style={MODERATION_TASK_STATUS[status]} className={className} />;
}

export function AccountStatusBadge({ status, className }: BadgeOf<ProfileStatus>) {
  return <StatusBadge style={ACCOUNT_STATUS[status]} className={className} />;
}

/** Role names as the workspaces show them ("Owner" for super_admin). */
export function RoleBadge({ role, className }: { role: AppRole; className?: string }) {
  return (
    <Chip tone={ROLE_TONE[role]} className={className}>
      {roleLabel(role)}
    </Chip>
  );
}

export type StockLevel = 'out' | 'low' | 'in';

/** Sold out at 0, low at or below the store's low-stock threshold, otherwise in stock. */
export function stockLevel(quantity: number): StockLevel {
  if (quantity <= 0) return 'out';
  return quantity <= LOW_STOCK_THRESHOLD ? 'low' : 'in';
}

const STOCK_LEVEL: Record<StockLevel, StatusStyle> = {
  out: { label: 'Out of stock', tone: 'danger' },
  low: { label: 'Low stock', tone: 'warning' },
  in: { label: 'In stock', tone: 'success' },
};

/** The stock band of an exact quantity, e.g. "Low stock". */
export function StockBadge({ quantity, className }: { quantity: number; className?: string }) {
  return <StatusBadge style={STOCK_LEVEL[stockLevel(quantity)]} className={className} />;
}
