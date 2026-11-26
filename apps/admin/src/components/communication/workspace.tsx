'use client';

import type { ChatConversationListResponse, Permission } from '@nilzora/contracts';
import { cn } from '@nilzora/ui';
import {
  BarChart3,
  Bot,
  Flag,
  Inbox,
  LibraryBig,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { AnalyticsPanel } from './analytics-panel';
import { AutomationPanel } from './automation-panel';
import { CommunicationCenter, OPEN_EVENT } from './communication-center';
import { ReportsPanel, TeamPanel } from './moderation-panels';
import { TemplatesPanel } from './templates-panel';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/*
 * The Communication workspace
 * ---------------------------
 * One shell for the screens that make up communication: the inbox, the overview, the message
 * library, automation, the review queue and the team.
 *
 * Which sections exist is decided by the permissions the server already put on the session,
 * and every panel's API call is checked again on the server — a section is a convenience, never
 * the control. The section is kept in the address (`?tab=`) so a link or a reload lands on it.
 * The inbox stays mounted while another section is open, so its socket and its place in the
 * queue survive a look at the analytics.
 */

export type CommunicationTab = 'inbox' | 'overview' | 'templates' | 'automation' | 'reports' | 'team';

interface TabDefinition {
  key: CommunicationTab;
  label: string;
  icon: LucideIcon;
  /** Any one of these opens the section; an empty list means every workspace account. */
  anyOf: readonly Permission[];
}

const TABS: readonly TabDefinition[] = [
  { key: 'inbox', label: 'Inbox', icon: Inbox, anyOf: ['admin_workspace.access', 'moderator_workspace.access'] },
  { key: 'overview', label: 'Overview', icon: BarChart3, anyOf: ['chat.analytics.read'] },
  { key: 'templates', label: 'Messages', icon: LibraryBig, anyOf: ['admin_workspace.access', 'moderator_workspace.access'] },
  { key: 'automation', label: 'Automation', icon: Bot, anyOf: ['chat.automation.manage'] },
  { key: 'reports', label: 'Reports', icon: Flag, anyOf: ['chat.reports.review'] },
  { key: 'team', label: 'Team', icon: UsersRound, anyOf: ['chat.internal.use'] },
];

/** The sections this account may open, in order; the first one is the landing section. */
export function availableTabs(
  permissions: readonly Permission[],
  only?: readonly CommunicationTab[],
): CommunicationTab[] {
  const held = new Set(permissions);
  const order = only ?? TABS.map((tab) => tab.key);
  return order.filter((key) => {
    const tab = TABS.find((entry) => entry.key === key);
    return tab !== undefined && (tab.anyOf.length === 0 || tab.anyOf.some((permission) => held.has(permission)));
  });
}

function replaceTabParam(tab: CommunicationTab, landing: CommunicationTab): void {
  const url = new URL(window.location.href);
  if (tab === landing) url.searchParams.delete('tab');
  else url.searchParams.set('tab', tab);
  window.history.replaceState(window.history.state, '', url.toString());
}

export function CommunicationWorkspace({
  initial,
  initialTab,
  initialConversationId,
  currentUserId,
  currentUserName,
  permissions,
  sections,
}: {
  /** The first page of the queue, or null when the account has no queue to work. */
  initial: ChatConversationListResponse | null;
  initialTab?: string | undefined;
  initialConversationId?: string | null | undefined;
  currentUserId: string;
  currentUserName: string;
  permissions: readonly Permission[];
  /** Limits and orders the sections, e.g. the moderator workspace shows what moderators use. */
  sections?: readonly CommunicationTab[];
}) {
  const tx = useTx();
  const available = availableTabs(permissions, sections).filter(
    (key) => key !== 'inbox' || initial !== null,
  );
  const landing = available[0] ?? 'inbox';
  const [tab, setTab] = useState<CommunicationTab>(
    available.find((key) => key === initialTab) ?? landing,
  );
  const [openConversationId, setOpenConversationId] = useState<string | null>(null);
  const [unread, setUnread] = useState(initial?.unread ?? 0);
  const held = new Set(permissions);

  const choose = (key: CommunicationTab) => {
    setTab(key);
    replaceTabParam(key, landing);
  };

  if (available.length === 0) {
    return (
      <p className="nz-panel rounded-2xl border p-6 text-sm text-muted-foreground"><AutoText>This account has no communication sections. Ask an administrator for access.</AutoText></p>
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <nav
        aria-label={tx("Communication sections")}
        className="-mx-1 overflow-x-auto pb-0.5 [-ms-overflow-style:none] scrollbar-none [&::-webkit-scrollbar]:hidden"
      >
        <ul className="flex min-w-max items-center gap-1.5 rounded-2xl border border-border/70 bg-surface/60 p-1.5 shadow-[0_1px_2px_rgb(15_23_42/0.04)] backdrop-blur-[2px]">
          {available.map((key) => {
            const item = TABS.find((entry) => entry.key === key);
            if (item === undefined) return null;
            const active = tab === item.key;
            const Icon = item.icon;
            return (
              <li key={item.key}>
                <button
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => choose(item.key)}
                  className={cn(
                    'group relative inline-flex h-9 items-center gap-2 rounded-xl px-3 text-sm font-semibold whitespace-nowrap transition-all duration-200',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    active
                      ? 'bg-surface text-foreground shadow-[0_1px_2px_rgb(15_23_42/0.08),inset_0_1px_0_rgb(255_255_255/0.6)] ring-1 ring-border'
                      : 'text-muted-foreground hover:bg-surface-muted/70 hover:text-foreground',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'grid size-6 place-items-center rounded-lg transition-colors',
                      active
                        ? 'bg-info-soft text-info-ink'
                        : 'bg-surface-muted/80 text-muted-foreground group-hover:text-foreground',
                    )}
                  >
                    <Icon className="size-3.5" />
                  </span>
                  {item.label}
                  {item.key === 'inbox' && unread > 0 ? (
                    <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary-action px-1.5 text-[10px] font-bold text-primary-action-foreground shadow-[0_1px_2px_rgb(2_132_199/0.4)]">
                      <span className="sr-only">Unread: </span>
                      {unread > 99 ? '99+' : unread}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {initial === null ? null : (
        <div hidden={tab !== 'inbox'} className="min-w-0">
          <CommunicationCenter
            initial={initial}
            initialConversationId={initialConversationId}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            permissions={permissions}
            onActiveConversation={setOpenConversationId}
            onUnread={setUnread}
          />
        </div>
      )}

      {tab === 'overview' ? <AnalyticsPanel /> : null}
      {tab === 'templates' ? (
        <TemplatesPanel
          conversationId={openConversationId}
          canManage={held.has('chat.templates.manage')}
        />
      ) : null}
      {tab === 'automation' ? <AutomationPanel conversationId={openConversationId} /> : null}
      {tab === 'reports' ? (
        <ReportsPanel
          canReview={held.has('chat.reports.review')}
          canOpen={(kind) =>
            initial !== null &&
            (kind === 'moderation'
              ? held.has('moderator_workspace.access') || held.has('admin_workspace.access')
              : held.has('admin_workspace.access'))
          }
          onOpenConversation={(conversationId) => {
            choose('inbox');
            window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: conversationId }));
          }}
        />
      ) : null}
      {tab === 'team' ? <TeamPanel currentUserId={currentUserId} /> : null}
    </div>
  );
}
