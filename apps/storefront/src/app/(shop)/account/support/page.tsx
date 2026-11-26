import type { ChatConversationStatus, ChatConversationSummary } from '@nilzora/contracts';
import {
  Alert,
  Badge,
  Card,
  CardContent,
  EmptyState,
  Logo,
  PageHeader,
  type BadgeTone,
} from '@nilzora/ui';
import { Clock, MessageCircle, Package, ShoppingBag } from 'lucide-react';
import type { Metadata } from 'next';
import { AccountNav } from '@/components/account/account-nav';
import { OpenConversationButton } from '@/components/support/open-conversation-button';
import { AskSupportButton } from '@/components/support/ask-support-button';
import { formatLongDate } from '@/lib/format';
import { support } from '@/lib/support';

export const metadata: Metadata = {
  title: 'Support',
  robots: { index: false, follow: false },
};

const STATUS: Record<ChatConversationStatus, { label: string; tone: BadgeTone }> = {
  open: { label: 'Open', tone: 'primary' },
  pending: { label: 'In progress', tone: 'warning' },
  resolved: { label: 'Resolved', tone: 'success' },
  closed: { label: 'Closed', tone: 'neutral' },
};

function isActive(conversation: ChatConversationSummary): boolean {
  return conversation.status === 'open' || conversation.status === 'pending';
}

/**
 * The customer's support inbox. Every conversation is read on the server with this account's
 * own session, so the page can only ever list threads the API decided this customer may see.
 * Open and in-progress threads come first; resolved and closed ones stay readable below.
 */
export default async function SupportInboxPage() {
  const result = await support.listConversations({ pageSize: 30 });
  const conversations = result.ok ? result.value.conversations : [];
  const active = conversations.filter(isActive);
  const earlier = conversations.filter((conversation) => !isActive(conversation));

  return (
    <div className="mx-auto grid max-w-4xl grid-cols-[minmax(0,1fr)] gap-8 px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <AccountNav current="/account/support" />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid gap-2">
          {/* The official artwork, so the page reads as the same conversation as the chat panel. */}
          <div className="flex items-center gap-2">
            <Logo size="sm" decorative />
            <span className="text-xs text-muted-foreground">
              You are talking to the Nilzora team.
            </span>
          </div>
          <PageHeader
            eyebrow="Your account"
            title="Support"
            description="Conversations with the Nilzora team. Ask about an order, a product or anything else."
          />
        </div>
        <div className="shrink-0">
          <AskSupportButton label="Start a new conversation" request={{}} tone="primary" />
        </div>
      </div>

      {!result.ok ? (
        <Alert tone="warning" title="We could not load your conversations">
          {result.message}
        </Alert>
      ) : conversations.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={MessageCircle}
              title="No conversations yet"
              description="Start one with the button above, or use “Get help” on any order and “Ask about this product” on a product page."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          {active.length === 0 ? null : (
            <ConversationSection title="Active" conversations={active} />
          )}
          {earlier.length === 0 ? null : (
            <ConversationSection title="Earlier" conversations={earlier} />
          )}
          {result.value.total > conversations.length ? (
            <p className="text-sm text-muted-foreground">
              Showing your {conversations.length} most recent conversations.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function ConversationSection({
  title,
  conversations,
}: {
  title: string;
  conversations: readonly ChatConversationSummary[];
}) {
  return (
    <section aria-label={title} className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h2>
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-3">
        {conversations.map((conversation) => {
          const status = STATUS[conversation.status];
          const Icon = conversation.orderNumber
            ? Package
            : conversation.productName
              ? ShoppingBag
              : MessageCircle;
          const unread = conversation.unreadCount > 0;
          return (
            <li key={conversation.id}>
              <Card className={unread ? 'ring-1 ring-primary-action/30' : undefined}>
                <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <span
                    aria-hidden
                    className="hidden size-10 shrink-0 place-items-center rounded-full bg-primary-action/10 text-link sm:grid"
                  >
                    <Icon className="size-5" />
                  </span>
                  <div className="grid min-w-0 flex-1 gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p
                        className={`min-w-0 truncate text-sm text-foreground ${unread ? 'font-semibold' : 'font-medium'}`}
                      >
                        {conversation.subject}
                      </p>
                      <Badge tone={status.tone}>{status.label}</Badge>
                      {unread ? (
                        <Badge tone="offer">
                          {conversation.unreadCount} new{' '}
                          {conversation.unreadCount === 1 ? 'reply' : 'replies'}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {conversation.lastMessagePreview ?? 'No messages yet'}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Clock aria-hidden className="size-3.5" />
                        Last activity {formatLongDate(conversation.lastMessageAt)}
                      </span>
                      {conversation.orderNumber ? (
                        <span>Order {conversation.orderNumber}</span>
                      ) : null}
                      {conversation.productName ? <span>{conversation.productName}</span> : null}
                    </p>
                  </div>
                  <div className="shrink-0">
                    <OpenConversationButton
                      conversationId={conversation.id}
                      label={unread ? 'Read reply' : 'Open'}
                    />
                  </div>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
