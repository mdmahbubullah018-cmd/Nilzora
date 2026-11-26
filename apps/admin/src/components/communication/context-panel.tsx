'use client';

import type {
  ChatConversationDetail,
  ChatMessageFeedbackEntry,
  ChatTag,
  Permission,
} from '@nilzora/contracts';
import { cn } from '@nilzora/ui';
import {
  ExternalLink,
  Mail,
  Package,
  Phone,
  ShoppingBag,
  Star,
  Tag,
  ThumbsDown,
  ThumbsUp,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Chip } from '@/components/admin-kit/chip';
import { chatIconButton } from './chat-style';
import { ORDER_STATUS, PAYMENT_STATUS } from '@/components/admin-kit/status-badge';
import { ProductTile } from '@/components/catalog/product-tile';
import { formatMoney } from '@/lib/format';
import { duration } from './client';
import { fullTime, initialsOf } from './inbox-model';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/*
 * The customer and order beside the thread
 * ----------------------------------------
 * Everything here is the API's own answer for this conversation: the customer the thread
 * belongs to, the order or product it is about, its tags and the measures the database keeps.
 * Links to the full customer, order or product page appear only for an account that may open
 * those pages; the pages check again.
 */

const PARTICIPANT_ROLE: Record<string, string> = {
  customer: 'Customer',
  staff: 'Team',
  moderator: 'Moderator',
  system: 'System',
};

export function ContextPanel({
  detail,
  permissions,
  feedback,
  tags,
  tagsBusy,
  onTags,
  onClose,
  className,
}: {
  detail: ChatConversationDetail | null;
  permissions: ReadonlySet<Permission>;
  feedback: readonly ChatMessageFeedbackEntry[];
  /** Every active tag, or null when the list could not be read. */
  tags: readonly ChatTag[] | null;
  tagsBusy: boolean;
  onTags: (tagIds: string[]) => void;
  onClose: () => void;
  className?: string;
}) {
  const tx = useTx();
  if (detail === null) {
    return (
      <aside aria-label={tx("Customer details")} className={cn('nz-panel-strong rounded-2xl border p-4', className)}>
        <p className="text-sm text-muted-foreground"><AutoText>Open a conversation to see who it is with.</AutoText></p>
      </aside>
    );
  }

  const { conversation, customer, order, product, participants } = detail;
  const firstResponse =
    conversation.firstResponseAt === null || conversation.firstResponseAt === undefined
      ? null
      : (new Date(conversation.firstResponseAt).getTime() - new Date(conversation.createdAt).getTime()) / 1000;

  return (
    <aside
      aria-label={tx("Customer details")}
      className={cn('nz-panel-strong nz-scroll flex min-h-0 flex-col overflow-y-auto rounded-2xl border', className)}
    >
      <div className="flex items-center justify-between border-b border-border/70 bg-surface/55 px-4 py-2.5 backdrop-blur-[2px] xl:hidden">
        <p className="font-display text-sm font-semibold text-foreground"><AutoText>Details</AutoText></p>
        <button
          type="button"
          onClick={onClose}
          aria-label={tx("Close details")}
          className={chatIconButton}
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>

      {customer === null ? null : (
        <Section title={tx("Customer")} icon={UserRound}>
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="grid size-10 shrink-0 place-items-center rounded-full bg-violet-soft text-sm font-semibold text-violet-ink ring-1 ring-violet-line"
            >
              {initialsOf(customer.name ?? customer.email ?? '?')}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">
                {customer.name ?? 'Name not given'}
              </p>
              {permissions.has('customers.read') ? (
                <Link
                  href={`/admin/customers/${customer.id}` as Route}
                  className="inline-flex items-center gap-1 text-xs font-medium text-link hover:underline"
                >
                  Customer profile
                  <ExternalLink aria-hidden className="size-3" />
                </Link>
              ) : null}
            </div>
          </div>
          <dl className="mt-3 grid gap-1.5 text-xs">
            {customer.email === null ? null : (
              <Fact icon={Mail} label={tx("Email")}>
                <a href={`mailto:${customer.email}`} className="break-all text-foreground hover:underline">
                  {customer.email}
                </a>
              </Fact>
            )}
            {customer.phone === null ? null : (
              <Fact icon={Phone} label={tx("Phone")}>
                <a href={`tel:${customer.phone}`} className="text-foreground hover:underline">
                  {customer.phone}
                </a>
              </Fact>
            )}
          </dl>
        </Section>
      )}

      {order === null ? null : (
        <Section title={tx("Order")} icon={Package}>
          <div className="flex items-center justify-between gap-2">
            {permissions.has('orders.read') ? (
              <Link
                href={`/admin/orders/${encodeURIComponent(order.number)}` as Route}
                className="inline-flex items-center gap-1 font-mono text-sm font-semibold text-link hover:underline"
              >
                {order.number}
                <ExternalLink aria-hidden className="size-3" />
              </Link>
            ) : (
              <span className="font-mono text-sm font-semibold text-foreground"><AutoText value={order.number} /></span>
            )}
            <span className="text-sm font-semibold text-foreground tabular-nums">
              {formatMoney(order.totalMinor)}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Chip tone={statusTone(ORDER_STATUS, order.status)} className="h-5 px-2 text-[10px]">
              {statusLabel(ORDER_STATUS, order.status)}
            </Chip>
            <Chip tone={statusTone(PAYMENT_STATUS, order.paymentStatus)} className="h-5 px-2 text-[10px]">
              {statusLabel(PAYMENT_STATUS, order.paymentStatus)}
            </Chip>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {order.itemCount} item{order.itemCount === 1 ? '' : 's'} · placed {fullTime(order.placedAt)}
          </p>
          {/* What the parcel actually holds, with the picture kept with the line, so an agent
              knows which of several products the customer means without opening the order. */}
          {order.items.length === 0 ? null : (
            <ul className="mt-2 grid gap-1.5">
              {order.items.map((line, index) => (
                <li
                  key={`${line.name}-${String(index)}`}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border border-border bg-surface px-2 py-1.5',
                    product !== null && line.productId === product.id
                      ? 'ring-1 ring-primary/40'
                      : null,
                  )}
                >
                  <ProductTile image={line.image} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-foreground">
                      {line.name}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {line.variantLabel === null ? '' : `${line.variantLabel} · `}
                      × {line.quantity}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {product === null ? null : (
        <Section title={tx("Product")} icon={ShoppingBag}>
          <div className="flex items-start gap-2">
            <ProductTile image={product.image} size="md" />
            <div className="min-w-0 flex-1">
              {permissions.has('products.read') ? (
                <Link
                  href={`/admin/products/${product.id}` as Route}
                  className="inline-flex items-center gap-1 text-sm font-semibold text-link hover:underline"
                >
                  {product.name}
                  <ExternalLink aria-hidden className="size-3" />
                </Link>
              ) : (
                <p className="text-sm font-semibold text-foreground"><AutoText value={product.name} /></p>
              )}
              {product.variantLabel === null ? null : (
                <p className="text-xs font-medium text-body"><AutoText value={product.variantLabel} /></p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {formatMoney(product.priceMinor)} · {product.status}
              </p>
            </div>
          </div>
        </Section>
      )}

      {conversation.kind === 'customer_support' || conversation.kind === 'order_support' ? (
        <TagsSection
          applied={conversation.tags ?? []}
          available={tags}
          busy={tagsBusy}
          onSave={onTags}
        />
      ) : null}

      <Section title={tx("Conversation")} icon={Users}>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-muted-foreground"><AutoText>Opened</AutoText></dt>
          <dd className="text-foreground"><AutoText value={fullTime(conversation.createdAt)} /></dd>
          <dt className="text-muted-foreground"><AutoText>First reply</AutoText></dt>
          <dd className="text-foreground">
            {firstResponse === null ? 'Not yet answered' : `after ${duration(firstResponse)}`}
          </dd>
          {conversation.lastCustomerMessageAt ? (
            <>
              <dt className="text-muted-foreground"><AutoText>Customer wrote</AutoText></dt>
              <dd className="text-foreground"><AutoText value={fullTime(conversation.lastCustomerMessageAt)} /></dd>
            </>
          ) : null}
          {conversation.resolvedAt === null ? null : (
            <>
              <dt className="text-muted-foreground"><AutoText>Resolved</AutoText></dt>
              <dd className="text-foreground"><AutoText value={fullTime(conversation.resolvedAt)} /></dd>
            </>
          )}
          {conversation.escalatedAt ? (
            <>
              <dt className="text-muted-foreground"><AutoText>Escalated</AutoText></dt>
              <dd className="text-danger-ink"><AutoText value={fullTime(conversation.escalatedAt)} /></dd>
            </>
          ) : null}
          {conversation.automationPaused ? (
            <>
              <dt className="text-muted-foreground"><AutoText>Automation</AutoText></dt>
              <dd className="text-foreground"><AutoText>Paused for this thread</AutoText></dd>
            </>
          ) : null}
          <dt className="text-muted-foreground"><AutoText>Rating</AutoText></dt>
          <dd className="text-foreground">
            {conversation.csatRating === null || conversation.csatRating === undefined ? (
              'Not rated'
            ) : (
              <span className="inline-flex items-center gap-0.5" aria-label={`${String(conversation.csatRating)} out of 5`}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star
                    key={star}
                    aria-hidden
                    className={cn(
                      'size-3.5',
                      star <= (conversation.csatRating ?? 0)
                        ? 'fill-warning text-warning'
                        : 'text-border-strong',
                    )}
                  />
                ))}
              </span>
            )}
          </dd>
        </dl>
        {participants.length === 0 ? null : (
          <ul className="mt-3 grid gap-1 border-t border-border pt-3">
            {participants.map((participant) => (
              <li key={participant.userId} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {participant.name ?? participant.email ?? 'Account'}
                </span>
                <span className="text-muted-foreground">
                  {PARTICIPANT_ROLE[participant.role] ?? participant.role}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {feedback.length === 0 ? null : (
        <Section title={tx("Reply feedback")} icon={ThumbsUp}>
          <ul className="grid gap-2">
            {feedback.map((entry) => (
              <li key={entry.id} className="text-xs">
                <span
                  className={cn(
                    'inline-flex items-center gap-1 font-semibold',
                    entry.verdict === 'helpful' ? 'text-success-ink' : 'text-danger-ink',
                  )}
                >
                  {entry.verdict === 'helpful' ? (
                    <ThumbsUp aria-hidden className="size-3" />
                  ) : (
                    <ThumbsDown aria-hidden className="size-3" />
                  )}
                  {entry.verdict === 'helpful' ? 'Helpful' : 'Not helpful'}
                </span>
                {entry.comment === null ? null : (
                  <p className="mt-0.5 text-muted-foreground">“{entry.comment}”</p>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </aside>
  );
}

function statusTone<K extends string>(
  map: Record<K, { tone: Parameters<typeof Chip>[0]['tone'] }>,
  value: string,
) {
  return value in map ? map[value as K].tone : 'neutral';
}

function statusLabel<K extends string>(map: Record<K, { label: string }>, value: string): string {
  return value in map ? map[value as K].label : value.replaceAll('_', ' ');
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof UserRound;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-border/60 px-4 py-3.5 last:border-b-0">
      <h3 className="mb-2.5 flex items-center gap-1.5 text-[10px] font-bold tracking-wider text-muted-foreground uppercase">
        <span className="grid size-5 place-items-center rounded-md bg-surface-muted/80 text-muted-foreground">
          <Icon aria-hidden className="size-3" />
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Fact({ icon: Icon, label, children }: { icon: typeof Mail; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <dt className="mt-0.5">
        <Icon aria-hidden className="size-3.5 text-muted-foreground" />
        <span className="sr-only"><AutoText value={label} /></span>
      </dt>
      <dd className="min-w-0"><AutoText value={children} /></dd>
    </div>
  );
}

function TagsSection({
  applied,
  available,
  busy,
  onSave,
}: {
  applied: readonly { id: string; label: string }[];
  available: readonly ChatTag[] | null;
  busy: boolean;
  onSave: (tagIds: string[]) => void;
}) {
  const tx = useTx();
  const [editing, setEditing] = useState(false);
  const appliedIds = new Set(applied.map((tag) => tag.id));
  const choices = (available ?? []).filter((tag) => tag.isActive || appliedIds.has(tag.id));

  return (
    <Section title={tx("Tags")} icon={Tag}>
      {applied.length === 0 ? (
        <p className="text-xs text-muted-foreground"><AutoText>No tags on this conversation.</AutoText></p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {applied.map((tag) => (
            <li key={tag.id}>
              <Chip tone="violet" className="h-5 px-2 text-[10px]">
                {tag.label}
              </Chip>
            </li>
          ))}
        </ul>
      )}
      {available === null ? null : choices.length === 0 ? (
        <p className="mt-2 text-[11px] text-muted-foreground"><AutoText>No tags exist yet. Create them under Messages.</AutoText></p>
      ) : editing ? (
        <fieldset className="mt-2.5 grid gap-1" disabled={busy}>
          <legend className="sr-only"><AutoText>Tags on this conversation</AutoText></legend>
          {choices.map((tag) => (
            <label key={tag.id} className="flex items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                defaultChecked={appliedIds.has(tag.id)}
                name="conversation-tag"
                value={tag.id}
                className="size-3.5 accent-primary"
              />
              {tag.label}
            </label>
          ))}
          <div className="mt-1.5 flex gap-2">
            <button
              type="button"
              onClick={(event) => {
                const form = event.currentTarget.closest('fieldset');
                const ids = [
                  ...(form?.querySelectorAll<HTMLInputElement>('input[name="conversation-tag"]:checked') ?? []),
                ].map((input) => input.value);
                onSave(ids);
                setEditing(false);
              }}
              className="inline-flex h-7 items-center rounded-lg bg-primary-action px-2.5 text-xs font-semibold text-primary-action-foreground hover:bg-primary-action-hover"
            ><AutoText>Save tags</AutoText></button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="inline-flex h-7 items-center rounded-lg border border-border px-2.5 text-xs font-medium text-foreground hover:bg-surface-muted"
            ><AutoText>Cancel</AutoText></button>
          </div>
        </fieldset>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          disabled={busy}
          className="mt-2 text-xs font-medium text-link hover:underline disabled:opacity-60"
        >
          {applied.length === 0 ? 'Add tags' : 'Change tags'}
        </button>
      )}
    </Section>
  );
}
