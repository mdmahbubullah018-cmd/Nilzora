'use client';

import {
  APP_ROLES,
  CHAT_MESSAGE_MAX_LENGTH,
  type ChatConversationDetail,
  type ChatInternalChannel,
  type ChatMessage,
  type ChatMessagePage,
  type ChatReportAction,
  type ChatReportQueueItem,
  type ChatReportStatus,
  type ChatTeamMember,
} from '@nilzora/contracts';
import { ChatAttachmentList, cn } from '@nilzora/ui';
import {
  ArrowLeft,
  CircleAlert,
  Flag,
  LoaderCircle,
  MessageSquarePlus,
  MessagesSquare,
  RefreshCw,
  Send,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Chip } from '@/components/admin-kit/chip';
import { RoleBadge } from '@/components/admin-kit/status-badge';
import { chatMediaUrl } from '@/lib/chat-media';
import { apiGet, apiPost } from './client';
import { clockTime, dayLabel, initialsOf, mergeMessages, relativeTime } from './inbox-model';
import { useChatSocket } from './use-chat-socket';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/*
 * The review queue and the team
 * -----------------------------
 * Reported messages are decided here, and the decision is what the database records. A
 * deletion is confirmed first because the customer sees it.
 *
 * The team view is the directory of teammates who can take conversations or use team chat —
 * each with the threads they hold now, straight from `chat_team_members` — and the staff-only
 * team threads this account is part of. Nothing in it is ever visible to a customer.
 */

const REASON_LABEL: Record<string, string> = {
  spam: 'Spam',
  abuse: 'Abuse',
  personal_information: 'Personal information',
  other: 'Other',
};

const ACTION_LABEL: Record<ChatReportAction, string> = {
  message_deleted: 'Delete the message',
  member_warned: 'Warn the member',
  no_action: 'No action needed',
  escalated: 'Escalate to an administrator',
};

const REPORT_STATUS: Record<ChatReportStatus, { label: string; tone: 'warning' | 'primary' | 'success' | 'neutral' }> = {
  open: { label: 'Waiting', tone: 'warning' },
  reviewing: { label: 'In review', tone: 'primary' },
  actioned: { label: 'Actioned', tone: 'success' },
  dismissed: { label: 'Dismissed', tone: 'neutral' },
};

const FILTERS: { key: ChatReportStatus | 'all'; label: string }[] = [
  { key: 'open', label: 'Waiting' },
  { key: 'reviewing', label: 'In review' },
  { key: 'actioned', label: 'Actioned' },
  { key: 'dismissed', label: 'Dismissed' },
  { key: 'all', label: 'All' },
];

function PanelMessage({
  tone,
  children,
  action,
}: {
  tone: 'muted' | 'warning' | 'danger';
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'nz-panel grid justify-items-center gap-3 rounded-2xl border p-8 text-center text-sm',
        tone === 'warning' && 'text-warning-ink',
        tone === 'danger' && 'text-danger-ink',
        tone === 'muted' && 'text-muted-foreground',
      )}
    >
      {tone === 'muted' ? null : <CircleAlert aria-hidden className="size-5" />}
      <div className="max-w-md"><AutoText value={children} /></div>
      {action}
    </div>
  );
}

function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-foreground hover:bg-surface-muted"
    >
      <RefreshCw aria-hidden className="size-3.5" /><AutoText>Try again</AutoText></button>
  );
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export function ReportsPanel({
  canReview,
  canOpen,
  onOpenConversation,
}: {
  canReview: boolean;
  /** Whether this account can open a thread of this kind in the inbox. */
  canOpen: (conversationKind: string) => boolean;
  onOpenConversation: (conversationId: string) => void;
}) {
  const tx = useTx();
  const [filter, setFilter] = useState<ChatReportStatus | 'all'>('open');
  const [reports, setReports] = useState<ChatReportQueueItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (key: ChatReportStatus | 'all') => {
    const result = await apiGet<{ reports: ChatReportQueueItem[]; totalCount: number }>(
      `?op=reports&status=${key}`,
    );
    if (!result.ok) {
      setError(result.message);
      setState(result.status === 403 || result.status === 401 ? 'denied' : 'error');
      return;
    }
    setReports(result.value.reports);
    setTotalCount(result.value.totalCount);
    setState('ready');
  }, []);

  useEffect(() => {
    if (!canReview) return;
    void (async () => {
      await load(filter);
    })();
  }, [canReview, filter, load]);

  const decide = useCallback(
    async (report: ChatReportQueueItem, status: 'reviewing' | 'dismissed' | 'actioned', action?: ChatReportAction) => {
      if (action === 'message_deleted' && !window.confirm('Delete this message for everyone? The customer will see that it was removed.')) {
        return;
      }
      setBusy(report.id);
      const result = await apiPost<{ status: string }>({
        op: 'report-decide',
        reportId: report.id,
        status,
        actionTaken: action,
      });
      setBusy(null);
      setNotice(
        result.ok
          ? { tone: 'success', text: status === 'reviewing' ? 'Marked as in review.' : 'Decision saved.' }
          : { tone: 'danger', text: result.message },
      );
      if (result.ok) await load(filter);
    },
    [filter, load],
  );

  if (!canReview) {
    return (
      <PanelMessage tone="warning">
        This account cannot review reported messages. Ask an administrator for the “Review reported
        messages” permission.
      </PanelMessage>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={tx("Report status")} className="flex flex-wrap gap-1 rounded-xl bg-surface-muted p-1">
          {FILTERS.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={filter === option.key}
              onClick={() => {
                setState('loading');
                setNotice(null);
                setFilter(option.key);
              }}
              className={cn(
                'h-8 rounded-lg px-3 text-xs font-semibold transition',
                filter === option.key
                  ? 'bg-surface text-foreground shadow-sm ring-1 ring-border'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        {state === 'ready' ? (
          <p className="text-xs text-muted-foreground">
            {totalCount} report{totalCount === 1 ? '' : 's'}
          </p>
        ) : null}
        {notice === null ? null : (
          <p
            role="status"
            className={cn('ml-auto text-xs font-medium', notice.tone === 'success' ? 'text-success-ink' : 'text-danger-ink')}
          >
            {notice.text}
          </p>
        )}
      </div>

      {state === 'loading' ? (
        <div className="grid gap-3" aria-label={tx("Loading reports")}>
          {[0, 1].map((row) => (
            <div key={row} className="nz-panel nz-shimmer h-36 rounded-2xl border" />
          ))}
        </div>
      ) : state === 'denied' ? (
        <PanelMessage tone="warning"><AutoText>The review queue is not available to this account.</AutoText></PanelMessage>
      ) : state === 'error' ? (
        <PanelMessage tone="danger" action={<RetryButton onClick={() => void load(filter)} />}>
          {error ?? 'The reports could not be loaded.'}
        </PanelMessage>
      ) : reports.length === 0 ? (
        <div className="nz-panel grid justify-items-center gap-2 rounded-2xl border px-6 py-12 text-center">
          <span className="grid size-11 place-items-center rounded-full bg-success-soft text-success-ink ring-1 ring-success-line">
            <ShieldCheck aria-hidden className="size-5" />
          </span>
          <p className="text-sm font-semibold text-foreground">
            {filter === 'open' ? 'Nothing is waiting for review' : 'No reports here'}
          </p>
          <p className="max-w-sm text-xs text-muted-foreground"><AutoText>Messages that customers or the team report appear here for a decision.</AutoText></p>
        </div>
      ) : (
        <ul className="grid gap-3">
          {reports.map((report) => {
            const decided = report.status === 'dismissed' || report.status === 'actioned';
            return (
              <li key={report.id} className="nz-panel grid gap-3 rounded-2xl border p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone="danger" className="h-6">
                    <Flag aria-hidden className="size-3" />
                    {REASON_LABEL[report.reason] ?? report.reason}
                  </Chip>
                  <Chip tone={REPORT_STATUS[report.status].tone} dot className="h-6">
                    {REPORT_STATUS[report.status].label}
                  </Chip>
                  <span className="min-w-0 truncate text-xs text-muted-foreground">
                    in “{report.conversationSubject}”
                  </span>
                  <time
                    dateTime={report.createdAt}
                    className="ml-auto shrink-0 text-xs text-muted-foreground"
                    title={new Date(report.createdAt).toLocaleString('en-GB')}
                  >
                    Reported {relativeTime(report.createdAt)} ago
                  </time>
                </div>
                <blockquote className="rounded-xl border border-border bg-surface-muted/70 px-3.5 py-3">
                  <p className="text-[11px] font-medium text-muted-foreground">
                    {report.messageSenderName ?? 'Removed account'} ·{' '}
                    {new Date(report.messageCreatedAt).toLocaleString('en-GB')}
                  </p>
                  <p className={cn('mt-1 text-sm whitespace-pre-wrap', report.messageBody === null ? 'text-muted-foreground italic' : 'text-foreground')}>
                    {report.messageBody ?? 'This message has been deleted.'}
                  </p>
                </blockquote>
                <div className="grid gap-1 text-xs text-muted-foreground">
                  {report.details === null ? null : <p>“{report.details}”</p>}
                  <p>
                    Reported by {report.reporterName ?? 'a removed account'}
                    {report.actionTaken === null ? '' : ` · Outcome: ${ACTION_LABEL[report.actionTaken]}`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  {canOpen(report.conversationKind) ? (
                    <button
                      type="button"
                      onClick={() => onOpenConversation(report.conversationId)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground hover:bg-surface-muted"
                    >
                      <MessagesSquare aria-hidden className="size-3.5" /><AutoText>Open conversation</AutoText></button>
                  ) : null}
                  {decided ? null : (
                    <>
                      {report.status === 'open' ? (
                        <button
                          type="button"
                          disabled={busy === report.id}
                          onClick={() => void decide(report, 'reviewing')}
                          className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-xs font-medium text-foreground hover:bg-surface-muted disabled:opacity-50"
                        ><AutoText>Start review</AutoText></button>
                      ) : null}
                      <button
                        type="button"
                        disabled={busy === report.id}
                        onClick={() => void decide(report, 'dismissed')}
                        className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-xs font-medium text-foreground hover:bg-surface-muted disabled:opacity-50"
                      ><AutoText>Dismiss</AutoText></button>
                      <span aria-hidden className="mx-1 hidden h-5 w-px bg-border sm:block" />
                      {(Object.keys(ACTION_LABEL) as ChatReportAction[]).map((action) => (
                        <button
                          key={action}
                          type="button"
                          disabled={busy === report.id}
                          onClick={() => void decide(report, 'actioned', action)}
                          className={cn(
                            'inline-flex h-8 items-center rounded-lg border px-2.5 text-xs font-medium disabled:opacity-50',
                            action === 'message_deleted'
                              ? 'border-danger-line bg-danger-soft text-danger-ink hover:brightness-95'
                              : 'border-border text-foreground hover:bg-surface-muted',
                          )}
                        >
                          {ACTION_LABEL[action]}
                        </button>
                      ))}
                      {busy === report.id ? (
                        <LoaderCircle aria-label={tx("Saving")} className="size-4 motion-safe:animate-spin text-muted-foreground" />
                      ) : null}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

function memberName(member: ChatTeamMember): string {
  return member.name?.trim() || member.email || 'Teammate';
}

export function TeamPanel({ currentUserId }: { currentUserId: string }) {
  const tx = useTx();
  const [members, setMembers] = useState<ChatTeamMember[]>([]);
  const [channels, setChannels] = useState<ChatInternalChannel[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [preset, setPreset] = useState<string[]>([]);
  const [reload, setReload] = useState(0);

  const load = useCallback(async () => {
    const [team, list] = await Promise.all([
      apiGet<{ members: ChatTeamMember[] }>('?op=team'),
      apiGet<{ channels: ChatInternalChannel[] }>('?op=internal'),
    ]);
    if (!list.ok) {
      setError(list.message);
      setState(list.status === 403 || list.status === 401 ? 'denied' : 'error');
      return;
    }
    setMembers(team.ok ? team.value.members : []);
    setChannels(list.value.channels);
    setState('ready');
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load, reload]);

  const startWith = useCallback((memberIds: string[]) => {
    setPreset(memberIds);
    setComposing(true);
    setActiveId(null);
  }, []);

  if (state === 'loading') {
    return (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]" aria-label={tx("Loading the team")}>
        <div className="nz-panel nz-shimmer h-72 rounded-2xl border" />
        <div className="nz-panel nz-shimmer h-72 rounded-2xl border" />
      </div>
    );
  }
  if (state === 'denied') {
    return (
      <PanelMessage tone="warning">
        Team chat is not available to this account. Ask an administrator for the “Use internal team
        chat” permission.
      </PanelMessage>
    );
  }
  if (state === 'error') {
    return (
      <PanelMessage tone="danger" action={<RetryButton onClick={() => setReload((value) => value + 1)} />}>
        {error ?? 'The team could not be loaded.'}
      </PanelMessage>
    );
  }

  const unread = channels.reduce((sum, channel) => sum + channel.unreadCount, 0);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      <section
        aria-label={tx("Team conversations")}
        className={cn('nz-panel-strong flex min-h-0 flex-col overflow-hidden rounded-2xl border', (activeId !== null || composing) && 'hidden lg:flex')}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <h3 className="font-display text-sm font-semibold text-foreground"><AutoText>Team threads</AutoText></h3>
            <p className="text-[11px] text-muted-foreground">
              Staff only{unread > 0 ? ` · ${String(unread)} unread` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={() => startWith([])}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary-action px-2.5 text-xs font-semibold text-primary-action-foreground hover:bg-primary-action-hover"
          >
            <MessageSquarePlus aria-hidden className="size-3.5" /><AutoText>New</AutoText></button>
        </div>
        {channels.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground"><AutoText>You are not in a team thread yet. Start one with a teammate from the directory.</AutoText></p>
        ) : (
          <ul className="nz-scroll max-h-120 overflow-y-auto">
            {channels.map((channel) => (
              <li key={channel.id}>
                <button
                  type="button"
                  aria-current={activeId === channel.id ? 'true' : undefined}
                  onClick={() => {
                    setComposing(false);
                    setActiveId(channel.id);
                  }}
                  className={cn(
                    'grid w-full gap-0.5 border-b border-border px-4 py-3 text-left transition-colors',
                    activeId === channel.id ? 'bg-info-soft/70' : 'hover:bg-surface-muted/70',
                  )}
                >
                  <span className="flex items-baseline gap-2">
                    <span className={cn('min-w-0 flex-1 truncate text-sm text-foreground', channel.unreadCount > 0 ? 'font-semibold' : 'font-medium')}>
                      {channel.subject}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {relativeTime(channel.lastMessageAt)}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {channel.lastMessagePreview ?? 'No messages yet'}
                    </span>
                    {channel.unreadCount > 0 ? (
                      <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary-action px-1.5 text-[10px] font-bold text-primary-action-foreground">
                        {channel.unreadCount}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {channel.kind === 'internal_direct' ? 'Direct' : (channel.department ?? 'Group')} ·{' '}
                    {channel.employeeCount} member{channel.employeeCount === 1 ? '' : 's'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className={cn('min-w-0', activeId === null && !composing && 'hidden lg:block')}>
        {composing ? (
          <NewTeamThread
            members={members.filter((member) => member.canUseInternal && member.userId !== currentUserId)}
            preset={preset}
            onCancel={() => setComposing(false)}
            onStarted={(conversationId) => {
              setComposing(false);
              setActiveId(conversationId);
              setReload((value) => value + 1);
            }}
          />
        ) : activeId !== null ? (
          <TeamThread
            key={activeId}
            conversationId={activeId}
            currentUserId={currentUserId}
            onBack={() => setActiveId(null)}
            onActivity={() => setReload((value) => value + 1)}
          />
        ) : (
          <TeamDirectory members={members} currentUserId={currentUserId} onMessage={(id) => startWith([id])} />
        )}
      </div>
    </div>
  );
}

function TeamDirectory({
  members,
  currentUserId,
  onMessage,
}: {
  members: readonly ChatTeamMember[];
  currentUserId: string;
  onMessage: (userId: string) => void;
}) {
  const tx = useTx();
  const totals = useMemo(
    () => ({
      support: members.filter((member) => member.canSupport).length,
      active: members.reduce((sum, member) => sum + member.openCount + member.pendingCount, 0),
    }),
    [members],
  );

  return (
    <section aria-label={tx("Team directory")} className="nz-panel-strong overflow-hidden rounded-2xl border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
        <div>
          <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-foreground">
            <UsersRound aria-hidden className="size-4 text-info-ink" /><AutoText>Directory</AutoText></h3>
          <p className="text-[11px] text-muted-foreground">
            {members.length} teammate{members.length === 1 ? '' : 's'} · {totals.support} can take
            customer conversations · {totals.active} conversation{totals.active === 1 ? '' : 's'} in
            hand
          </p>
        </div>
      </div>
      {members.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted-foreground"><AutoText>No teammates can take conversations or use team chat yet.</AutoText></p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-160 text-sm">
            <caption className="sr-only"><AutoText>Teammates, what they can work, and the conversations they hold</AutoText></caption>
            <thead>
              <tr className="border-b border-border text-left text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                <th scope="col" className="px-4 py-2.5 sm:px-5"><AutoText>Teammate</AutoText></th>
                <th scope="col" className="px-3 py-2.5"><AutoText>Works on</AutoText></th>
                <th scope="col" className="px-3 py-2.5 text-right"><AutoText>Open</AutoText></th>
                <th scope="col" className="px-3 py-2.5 text-right"><AutoText>In progress</AutoText></th>
                <th scope="col" className="px-3 py-2.5 text-right" title={tx("Resolved or closed in the last 30 days")}><AutoText>Resolved 30d</AutoText></th>
                <th scope="col" className="px-4 py-2.5 sm:px-5">
                  <span className="sr-only"><AutoText>Actions</AutoText></span>
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const me = member.userId === currentUserId;
                const role = APP_ROLES.find((value) => value === member.role);
                return (
                  <tr key={member.userId} className="border-b border-border last:border-b-0">
                    <th scope="row" className="px-4 py-3 text-left font-normal sm:px-5">
                      <span className="flex items-center gap-3">
                        <span
                          aria-hidden
                          className="grid size-8 shrink-0 place-items-center rounded-full bg-info-soft text-[11px] font-semibold text-info-ink ring-1 ring-info-line"
                        >
                          {initialsOf(memberName(member))}
                        </span>
                        <span className="grid min-w-0">
                          <span className="flex items-center gap-2 truncate font-medium text-foreground">
                            {memberName(member)}
                            {me ? <span className="text-[11px] font-normal text-muted-foreground">(you)</span> : null}
                          </span>
                          <span className="truncate text-[11px] text-muted-foreground"><AutoText value={member.email} /></span>
                        </span>
                      </span>
                    </th>
                    <td className="px-3 py-3">
                      <span className="flex flex-wrap items-center gap-1">
                        {role === undefined ? null : <RoleBadge role={role} />}
                        {member.canSupport ? <Chip tone="primary" className="h-5 px-2 text-[10px]"><AutoText>Support</AutoText></Chip> : null}
                        {member.canModerate ? <Chip tone="moderator" className="h-5 px-2 text-[10px]"><AutoText>Moderation</AutoText></Chip> : null}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-foreground"><AutoText value={member.openCount} /></td>
                    <td className="px-3 py-3 text-right tabular-nums text-foreground"><AutoText value={member.pendingCount} /></td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                      {member.resolvedRecentCount}
                    </td>
                    <td className="px-4 py-3 text-right sm:px-5">
                      {me || !member.canUseInternal ? null : (
                        <button
                          type="button"
                          onClick={() => onMessage(member.userId)}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground hover:bg-surface-muted"
                        >
                          <MessagesSquare aria-hidden className="size-3.5" /><AutoText>Message</AutoText></button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function NewTeamThread({
  members,
  preset,
  onCancel,
  onStarted,
}: {
  members: readonly ChatTeamMember[];
  preset: readonly string[];
  onCancel: () => void;
  onStarted: (conversationId: string) => void;
}) {
  const tx = useTx();
  const [chosen, setChosen] = useState<string[]>([...preset]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const group = chosen.length > 1;

  const start = async () => {
    if (chosen.length === 0) {
      setError('Choose at least one teammate.');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await apiPost<ChatConversationDetail>({
      op: 'internal-start',
      kind: group ? 'internal_group' : 'internal_direct',
      participantIds: chosen,
      ...(subject.trim() === '' ? {} : { subject: subject.trim() }),
      ...(body.trim() === '' ? {} : { body: body.trim() }),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onStarted(result.value.conversation.id);
  };

  return (
    <form
      className="nz-panel-strong grid gap-4 rounded-2xl border p-4 sm:p-5"
      onSubmit={(event) => {
        event.preventDefault();
        void start();
      }}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          aria-label={tx("Back")}
          className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-surface-muted hover:text-foreground"
        >
          <ArrowLeft aria-hidden className="size-4" />
        </button>
        <h3 className="font-display text-sm font-semibold text-foreground"><AutoText>New team thread</AutoText></h3>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-xs font-medium text-muted-foreground"><AutoText>Who is in it</AutoText></legend>
        {members.length === 0 ? (
          <p className="text-xs text-muted-foreground"><AutoText>No other teammate can use team chat yet.</AutoText></p>
        ) : (
          <ul className="nz-scroll grid max-h-56 gap-1 overflow-y-auto rounded-xl border border-border p-1.5 sm:grid-cols-2">
            {members.map((member) => (
              <li key={member.userId}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-muted">
                  <input
                    type="checkbox"
                    checked={chosen.includes(member.userId)}
                    onChange={(event) =>
                      setChosen((current) =>
                        event.target.checked
                          ? [...current, member.userId]
                          : current.filter((id) => id !== member.userId),
                      )
                    }
                    className="size-4 accent-primary"
                  />
                  <span className="min-w-0 truncate text-foreground"><AutoText value={memberName(member)} /></span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
      {group ? (
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Subject
          <input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            maxLength={160}
            placeholder={tx("Team conversation")}
            className="h-9 rounded-lg border border-input-border bg-surface px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          />
        </label>
      ) : null}
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        First message (optional)
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={3}
          maxLength={CHAT_MESSAGE_MAX_LENGTH}
          className="rounded-lg border border-input-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        />
      </label>
      {error === null ? null : (
        <p role="alert" className="text-xs text-danger-ink">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy || chosen.length === 0}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary-action px-4 text-sm font-semibold text-primary-action-foreground hover:bg-primary-action-hover disabled:opacity-50"
        >
          {busy ? <LoaderCircle aria-hidden className="size-4 motion-safe:animate-spin" /> : null}
          {group ? 'Start group thread' : 'Start conversation'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-foreground hover:bg-surface-muted"
        ><AutoText>Cancel</AutoText></button>
      </div>
    </form>
  );
}

function TeamThread({
  conversationId,
  currentUserId,
  onBack,
  onActivity,
}: {
  conversationId: string;
  currentUserId: string;
  onBack: () => void;
  onActivity: () => void;
}) {
  const tx = useTx();
  const [detail, setDetail] = useState<ChatConversationDetail | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [thread, page] = await Promise.all([
        apiGet<ChatConversationDetail>(`?op=thread&id=${conversationId}`),
        apiGet<ChatMessagePage>(`?op=messages&id=${conversationId}`),
      ]);
      if (cancelled) return;
      if (!thread.ok || !page.ok) {
        setState('error');
        setError((!thread.ok ? thread.message : !page.ok ? page.message : null) ?? null);
        return;
      }
      setDetail(thread.value);
      setMessages((current) => mergeMessages(current, page.value.messages));
      setState('ready');
      const newest = page.value.messages.at(-1);
      if (newest) void apiPost({ op: 'read', id: conversationId, seq: newest.seq });
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, token]);

  useEffect(() => {
    const element = scrollRef.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
  }, [messages]);

  const handlers = useMemo(
    () => ({
      onMessage: (event: { conversationId: string; message: ChatMessage }) => {
        if (event.conversationId !== conversationId) return;
        setMessages((current) => mergeMessages(current, [event.message]));
        if (event.message.senderId !== currentUserId) {
          void apiPost({ op: 'read', id: conversationId, seq: event.message.seq });
        }
        onActivity();
      },
      onReconnected: () => setToken((value) => value + 1),
    }),
    [conversationId, currentUserId, onActivity],
  );
  const { connection } = useChatSocket(conversationId, handlers);

  const send = async () => {
    const body = draft.trim();
    if (body === '' || sending) return;
    setSending(true);
    setError(null);
    const result = await apiPost<{ message: ChatMessage }>({
      op: 'send',
      id: conversationId,
      clientMessageId: crypto.randomUUID(),
      body,
    });
    setSending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setDraft('');
    setMessages((current) => mergeMessages(current, [result.value.message]));
    onActivity();
  };

  const members = detail?.participants ?? [];

  return (
    <section
      aria-label={tx("Team thread")}
      className="nz-panel-strong flex h-[min(42rem,calc(100dvh-14rem))] min-h-112 flex-col overflow-hidden rounded-2xl border"
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2.5 sm:px-4">
        <button
          type="button"
          onClick={onBack}
          aria-label={tx("Back to the team")}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-surface-muted hover:text-foreground"
        >
          <ArrowLeft aria-hidden className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-sm font-semibold text-foreground">
            {detail?.conversation.subject ?? 'Team thread'}
          </h3>
          <p className="truncate text-[11px] text-muted-foreground">
            {members.map((member) => member.name ?? member.email ?? 'Teammate').join(', ') || 'Loading…'}
            {' · '}
            {connection === 'live' ? 'Live' : 'Reconnecting…'}
          </p>
        </div>
      </header>
      <div ref={scrollRef} className="nz-scroll min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5">
        {state === 'loading' ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle aria-hidden className="size-4 motion-safe:animate-spin" /><AutoText>Loading messages…</AutoText></p>
        ) : state === 'error' ? (
          <p className="flex items-center gap-2 text-sm text-danger-ink">
            <CircleAlert aria-hidden className="size-4" />
            {error ?? 'This thread could not be opened.'}
          </p>
        ) : messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground"><AutoText>No messages yet. Say hello.</AutoText></p>
        ) : (
          <ol className="grid gap-2.5">
            {messages.map((message, index) => {
              const mine = message.senderId === currentUserId;
              const previous = messages[index - 1];
              const newDay =
                previous === undefined ||
                new Date(previous.createdAt).toDateString() !== new Date(message.createdAt).toDateString();
              return (
                <li key={message.id} className="grid gap-2.5">
                  {newDay ? (
                    <p className="text-center text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                      {dayLabel(message.createdAt)}
                    </p>
                  ) : null}
                  {message.kind === 'system' ? (
                    <p className="text-center text-[11px] text-muted-foreground"><AutoText value={message.body} /></p>
                  ) : (
                    <div className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
                      <p className="mb-0.5 px-1 text-[11px] text-muted-foreground">
                        {mine ? 'You' : (message.senderName ?? 'Teammate')} · {clockTime(message.createdAt)}
                      </p>
                      <div
                        className={cn(
                          'grid max-w-[min(34rem,85%)] gap-2 rounded-2xl px-3 py-2 text-sm',
                          mine
                            ? 'rounded-br-md bg-primary-action text-primary-action-foreground'
                            : 'rounded-bl-md border border-border bg-surface-muted text-foreground',
                        )}
                      >
                        {message.attachments.length === 0 ? null : (
                          <ChatAttachmentList
                            attachments={message.attachments}
                            tone={mine ? 'outgoing' : 'incoming'}
                            resolveMediaUrl={chatMediaUrl}
                          />
                        )}
                        {message.body === null || message.body === '' ? null : (
                          <p className="wrap-break-word whitespace-pre-wrap"><AutoText value={message.body} /></p>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
      <form
        className="border-t border-border p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        {error === null || state === 'error' ? null : (
          <p role="alert" className="mb-2 text-xs text-danger-ink">
            {error}
          </p>
        )}
        <div className="flex items-end gap-2 rounded-xl border border-input-border bg-surface p-1.5 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
          <label htmlFor={`team-${conversationId}`} className="sr-only"><AutoText>Message the team</AutoText></label>
          <textarea
            id={`team-${conversationId}`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send();
              }
            }}
            rows={1}
            maxLength={CHAT_MESSAGE_MAX_LENGTH}
            placeholder={tx("Message the team…")}
            className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            disabled={sending || draft.trim() === '' || state !== 'ready'}
            aria-label={tx("Send to the team")}
            className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-action text-primary-action-foreground hover:bg-primary-action-hover disabled:opacity-40"
          >
            {sending ? <LoaderCircle aria-hidden className="size-4 motion-safe:animate-spin" /> : <Send aria-hidden className="size-4" />}
          </button>
        </div>
      </form>
    </section>
  );
}
