'use client';

import type { ChatAnalytics } from '@nilzora/contracts';
import { cn } from '@nilzora/ui';
import {
  Activity,
  Bot,
  CheckCircle2,
  CircleAlert,
  Clock,
  Flag,
  Hourglass,
  Inbox,
  MessagesSquare,
  RefreshCw,
  Smile,
  Timer,
  UserRoundX,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { BarList } from '@/components/admin-kit/charts/bar-list';
import { ComboChart } from '@/components/admin-kit/charts/combo-chart';
import { DonutChart } from '@/components/admin-kit/charts/donut-chart';
import { KpiCard } from '@/components/admin-kit/kpi-card';
import { MetricTile } from '@/components/admin-kit/metric-tile';
import { SectionCard } from '@/components/admin-kit/section-card';
import { formatCount } from '@/lib/format';
import { apiGet, defaultRange, duration } from './client';
import { STATUS_LABEL } from './inbox-model';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/*
 * The communication overview
 * --------------------------
 * One report from `chat_analytics`, which the database computes from rows the triggers already
 * maintain. Nothing here is derived from a sample and nothing is invented: every figure is a
 * field of the API's answer. The only work done in the browser is filling the days the report
 * left out (a day with no conversations) with zeros, so the chart's time axis is honest.
 */

const RANGES = [
  { key: '7', label: '7 days' },
  { key: '30', label: '30 days' },
  { key: '90', label: '90 days' },
] as const;
type RangeKey = (typeof RANGES)[number]['key'];

const STATUS_TONE = {
  open: 'primary',
  pending: 'warning',
  resolved: 'success',
  closed: 'neutral',
} as const;
const KIND_LABEL: Record<string, string> = {
  customer_support: 'General questions',
  order_support: 'Order questions',
  moderation: 'Moderation',
  internal_direct: 'Team, direct',
  internal_group: 'Team, group',
};

/** Every day of the report's range, with the report's figures where it has them. */
export function filledDays(report: ChatAnalytics): ChatAnalytics['daily'] {
  const byDate = new Map(report.daily.map((day) => [day.date, day]));
  const from = new Date(report.range.from);
  const to = new Date(report.range.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return report.daily;
  const days: ChatAnalytics['daily'] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  while (cursor <= to && days.length < 400) {
    const date = cursor.toISOString().slice(0, 10);
    days.push(byDate.get(date) ?? { date, created: 0, messages: 0 });
    byDate.delete(date);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  // A day the report has outside the computed window (a time-zone edge) is kept, not dropped.
  return [...days, ...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function dayShort(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(value.getTime())
    ? date
    : value.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function AnalyticsPanel() {
  const tx = useTx();
  const [range, setRange] = useState<RangeKey>('30');
  const [report, setReport] = useState<ChatAnalytics | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(0);

  const load = useCallback(async (key: RangeKey) => {
    const days = Number(key);
    const window = defaultRange();
    const from = new Date(new Date(window.to).getTime() - (days - 1) * 24 * 60 * 60 * 1000);
    from.setHours(0, 0, 0, 0);
    const result = await apiGet<ChatAnalytics>(
      `?op=analytics&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(window.to)}`,
    );
    if (result.ok) {
      setReport(result.value);
      setError(null);
      setState('ready');
      return;
    }
    setError(result.message);
    setState(result.status === 403 ? 'denied' : 'error');
  }, []);

  useEffect(() => {
    void (async () => {
      await load(range);
    })();
  }, [load, range, token]);

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <div
        role="group"
        aria-label={tx('Report period')}
        className="flex rounded-xl bg-surface-muted p-1"
      >
        {RANGES.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={range === option.key}
            onClick={() => {
              setState('loading');
              setRange(option.key);
            }}
            className={cn(
              'h-8 rounded-lg px-3 text-xs font-semibold transition',
              range === option.key
                ? 'bg-surface text-foreground shadow-sm ring-1 ring-border'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Last {option.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => {
          setState('loading');
          setToken((value) => value + 1);
        }}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-foreground hover:bg-surface-muted"
      >
        <RefreshCw
          aria-hidden
          className={cn('size-3.5', state === 'loading' && 'motion-safe:animate-spin')}
        />
        <AutoText>Refresh</AutoText>
      </button>
    </div>
  );

  if (state === 'denied') {
    return (
      <div role="status" className="nz-panel rounded-2xl border p-6 text-sm text-warning-ink">
        This account cannot read communication analytics. Ask an administrator for the “Read
        communication analytics” permission.
      </div>
    );
  }

  if (state === 'error' || (state === 'ready' && report === null)) {
    return (
      <div className="grid gap-4">
        {toolbar}
        <div
          role="alert"
          className="nz-panel grid justify-items-center gap-3 rounded-2xl border p-8 text-center text-sm"
        >
          <CircleAlert aria-hidden className="size-5 text-danger-ink" />
          <p className="text-foreground">{error ?? 'The report could not be loaded.'}</p>
        </div>
      </div>
    );
  }

  if (report === null) {
    return (
      <div className="grid gap-4" aria-label={tx('Loading the report')}>
        {toolbar}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((tile) => (
            <div key={tile} className="nz-panel nz-shimmer h-32 rounded-2xl border" />
          ))}
        </div>
        <div className="nz-panel nz-shimmer h-80 rounded-2xl border" />
      </div>
    );
  }

  const days = filledDays(report);
  const statusSegments = (['open', 'pending', 'resolved', 'closed'] as const).map((status) => ({
    key: status,
    label: STATUS_LABEL[status],
    value: Number(report.conversations.byStatus[status] ?? 0),
    tone: STATUS_TONE[status],
  }));
  const statusTotal = statusSegments.reduce((sum, segment) => sum + segment.value, 0);
  const kindItems = Object.entries(report.conversations.byKind)
    .filter(([, value]) => Number(value) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .map(([kind, value]) => ({
      key: kind,
      label: KIND_LABEL[kind] ?? kind.replaceAll('_', ' '),
      value: Number(value),
      display: formatCount(Number(value)),
    }));
  const satisfaction = report.satisfaction;
  const starItems = (
    [
      ['5', satisfaction.five],
      ['4', satisfaction.four],
      ['3', satisfaction.three],
      ['2', satisfaction.two],
      ['1', satisfaction.one],
    ] as const
  ).map(([stars, value]) => ({
    key: stars,
    label: `${stars} star${stars === '1' ? '' : 's'}`,
    value,
    display: formatCount(value),
  }));
  const messageItems = [
    {
      key: 'customers',
      label: 'From customers',
      value: report.messages.fromCustomers,
      display: formatCount(report.messages.fromCustomers),
    },
    {
      key: 'staff',
      label: 'From the team',
      value: report.messages.fromStaff,
      display: formatCount(report.messages.fromStaff),
    },
    {
      key: 'automated',
      label: 'Automatic replies',
      value: report.messages.automated,
      display: formatCount(report.messages.automated),
    },
  ];
  const quiet = report.conversations.created === 0 && report.messages.total === 0;

  return (
    <div className="grid gap-4">
      {toolbar}

      <section
        aria-label={tx('Queue at a glance')}
        className="nz-stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <KpiCard
          label={tx('Conversations opened')}
          value={formatCount(report.conversations.created)}
          icon={Inbox}
          tone="primary"
          footnote={`${formatCount(report.messages.total)} messages in this period`}
        />
        <KpiCard
          label={tx('Waiting for a first reply')}
          value={formatCount(report.conversations.waitingNow)}
          icon={Hourglass}
          tone={report.conversations.waitingNow > 0 ? 'warning' : 'success'}
          footnote="Right now, across the queue"
        />
        <KpiCard
          label={tx('Unassigned')}
          value={formatCount(report.conversations.unassignedNow)}
          icon={UserRoundX}
          tone={report.conversations.unassignedNow > 0 ? 'warning' : 'neutral'}
          footnote="Open threads nobody owns yet"
        />
        <KpiCard
          label={tx('Resolved')}
          value={formatCount(report.resolution.resolved)}
          icon={CheckCircle2}
          tone="success"
          footnote={`Average time to resolve: ${duration(report.resolution.averageSeconds)}`}
        />
      </section>

      <section
        aria-label={tx('Response times')}
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <MetricTile
          label={tx('Average first reply')}
          value={duration(report.firstResponse.averageSeconds)}
          icon={Timer}
          tone="primary"
          hint={`${formatCount(report.firstResponse.answered)} conversations answered`}
        />
        <MetricTile
          label={tx('Median first reply')}
          value={duration(report.firstResponse.p50Seconds)}
          icon={Clock}
          tone="violet"
          hint={tx('Half are answered faster')}
        />
        <MetricTile
          label={tx('Slowest tenth')}
          value={duration(report.firstResponse.p90Seconds)}
          icon={Hourglass}
          tone="warning"
          hint={tx('Nine in ten are faster')}
        />
        <MetricTile
          label={tx('Satisfaction')}
          value={
            satisfaction.responses === 0 ? 'No ratings' : `${satisfaction.average.toFixed(1)} / 5`
          }
          icon={Smile}
          tone="success"
          hint={`${formatCount(satisfaction.responses)} rating${satisfaction.responses === 1 ? '' : 's'}`}
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <SectionCard
          title={tx('Volume')}
          icon={Activity}
          description={tx('Messages written and conversations opened, per day.')}
        >
          {quiet ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              <AutoText>No conversations in this period.</AutoText>
            </p>
          ) : (
            <ComboChart
              data={days.map((day) => ({
                label: dayShort(day.date),
                area: day.messages,
                line: day.created,
              }))}
              title={tx('Messages and new conversations per day')}
              summary={`${formatCount(report.messages.total)} messages and ${formatCount(report.conversations.created)} new conversations.`}
              areaSeries={{ label: 'Messages', tone: 'primary' }}
              lineSeries={{ label: 'New conversations', tone: 'violet' }}
              formatArea={formatCount}
              formatLine={formatCount}
              integerLine
              bandLabel="Day"
            />
          )}
        </SectionCard>
        <SectionCard
          title={tx('Status')}
          icon={MessagesSquare}
          description={tx('Conversations opened in this period, by where they are now.')}
        >
          {statusTotal === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              <AutoText>Nothing to show yet.</AutoText>
            </p>
          ) : (
            <DonutChart
              segments={statusSegments}
              title={tx('Conversations by status')}
              centerValue={formatCount(statusTotal)}
              centerLabel="conversations"
            />
          )}
        </SectionCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title={tx('What customers ask about')} icon={Inbox}>
          {kindItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <AutoText>No conversations in this period.</AutoText>
            </p>
          ) : (
            <BarList items={kindItems} label={tx('Conversations by topic')} tone="primary" />
          )}
        </SectionCard>
        <SectionCard title={tx('Who wrote')} icon={MessagesSquare}>
          {report.messages.total === 0 ? (
            <p className="text-sm text-muted-foreground">
              <AutoText>No messages in this period.</AutoText>
            </p>
          ) : (
            <BarList items={messageItems} label={tx('Messages by author')} tone="violet" />
          )}
        </SectionCard>
        <SectionCard title={tx('Ratings')} icon={Smile}>
          {satisfaction.responses === 0 ? (
            <p className="text-sm text-muted-foreground">
              <AutoText>No customer has rated a conversation in this period.</AutoText>
            </p>
          ) : (
            <BarList items={starItems} label={tx('Ratings by stars')} tone="success" />
          )}
        </SectionCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <SectionCard title={tx('Who is answering')} icon={Users} flush>
          {report.agents.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">
              <AutoText>No conversations were assigned in this period.</AutoText>
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-lg text-sm">
                <caption className="sr-only">
                  <AutoText>Conversations and response times by teammate</AutoText>
                </caption>
                <thead>
                  <tr className="border-y border-border text-left text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                    <th scope="col" className="px-5 py-2.5 sm:px-6">
                      <AutoText>Teammate</AutoText>
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right">
                      <AutoText>Conversations</AutoText>
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right">
                      <AutoText>Resolved</AutoText>
                    </th>
                    <th scope="col" className="px-5 py-2.5 text-right sm:px-6">
                      <AutoText>First reply</AutoText>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.agents.map((agent) => (
                    <tr key={agent.userId} className="border-b border-border last:border-b-0">
                      <th
                        scope="row"
                        className="px-5 py-2.5 text-left font-medium text-foreground sm:px-6"
                      >
                        {agent.name ?? 'Account removed'}
                      </th>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        <AutoText value={formatCount(agent.conversations)} />
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        <AutoText value={formatCount(agent.resolved)} />
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums sm:px-6">
                        <AutoText value={duration(agent.averageFirstResponseSeconds)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
        <div className="grid content-start gap-3">
          <MetricTile
            label={tx('Automation')}
            value={`${formatCount(report.automation.applied)} applied`}
            icon={Bot}
            tone={report.automation.failed > 0 ? 'danger' : 'primary'}
            hint={`${formatCount(report.automation.activeRules)} active rule${report.automation.activeRules === 1 ? '' : 's'} · ${formatCount(report.automation.failed)} failed · ${formatCount(report.automation.pendingJobs)} scheduled`}
          />
          <MetricTile
            label={tx('Reported messages')}
            value={`${formatCount(report.moderation.openReports)} waiting`}
            icon={Flag}
            tone={report.moderation.openReports > 0 ? 'warning' : 'success'}
            hint={`${formatCount(report.moderation.resolved)} decided in this period`}
          />
        </div>
      </div>
    </div>
  );
}
