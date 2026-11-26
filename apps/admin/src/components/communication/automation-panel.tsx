'use client';

import {
  CHAT_AUTOMATION_ACTION_TYPES,
  CHAT_AUTOMATION_TRIGGERS,
  CHAT_CONVERSATION_STATUSES,
  CHAT_PRIORITIES,
  type ChatAutomationAction,
  type ChatAutomationRule,
  type ChatAutomationRun,
  type ChatAutomationTrigger,
  type ChatTag,
  type ChatTeamMember,
  type ChatTemplate,
} from '@nilzora/contracts';
import { cn } from '@nilzora/ui';
import {
  Bot,
  CircleAlert,
  FlaskConical,
  History,
  LoaderCircle,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Chip } from '@/components/admin-kit/chip';
import { apiGet, apiPost } from './client';
import { PRIORITY_LABEL, relativeTime, STATUS_LABEL } from './inbox-model';
import { actionProblem, conditionsOf, draftOf, type RuleDraft } from './automation-model';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/*
 * Automation rules
 * ----------------
 * A rule is data, not code: a trigger, a small condition document and a list of actions from
 * the vocabulary the database validates. Each action is built with the value it needs (which
 * template, which status, which teammate), and an incomplete action cannot be saved — the
 * database accepts some of them without a value and they would only fail when the rule ran.
 *
 * A dry run answers whether a rule would fire for the conversation open in the Inbox; nothing
 * is sent.
 */

const TRIGGER_LABEL: Record<ChatAutomationTrigger, string> = {
  conversation_created: 'A conversation is opened',
  message_received: 'A customer sends a message',
  conversation_resolved: 'A conversation is resolved',
  conversation_reopened: 'A conversation is reopened',
  priority_changed: 'The priority changes',
  assignee_changed: 'The owner changes',
  order_status_changed: 'An order status changes',
  return_status_changed: 'A return status changes',
  refund_status_changed: 'A refund status changes',
  csat_received: 'A customer rates the conversation',
};

const ACTION_LABEL: Record<ChatAutomationAction['type'], string> = {
  reply_template: 'Send an approved template',
  system_message: 'Add a note line to the thread',
  set_status: 'Change the status',
  set_priority: 'Change the priority',
  set_tags: 'Apply tags',
  assign_to: 'Assign to a teammate',
  escalate: 'Escalate (urgent + notify)',
  notify_staff: 'Notify the team',
  pause_automation: 'Pause automation on this thread',
  schedule: 'Scheduled follow-up',
};

const KIND_LABEL: Record<string, string> = {
  customer_support: 'General questions',
  order_support: 'Order questions',
};

const NOTIFY_AUDIENCE = [
  { value: 'admin_workspace.access', label: 'The support team' },
  { value: 'moderator_workspace.access', label: 'Moderators' },
] as const;

const field =
  'w-full rounded-lg border border-input-border bg-surface px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30';
const quietButton =
  'inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground transition hover:bg-surface-muted disabled:opacity-50';

const BLANK: RuleDraft = {
  id: undefined,
  name: '',
  description: '',
  trigger: 'message_received',
  keywords: '',
  statuses: [],
  priorities: [],
  kinds: [],
  minMessages: '',
  actions: [],
  cooldownMinutes: '0',
  position: '100',
  stopProcessing: false,
  isActive: true,
};

function Panel({ title, icon: Icon, actions, children }: { title: string; icon: typeof Bot; actions?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="nz-panel-strong flex min-w-0 flex-col rounded-2xl border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
        <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-foreground">
          <Icon aria-hidden className="size-4 text-info-ink" />
          {title}
        </h3>
        {actions}
      </div>
      <div className="grid gap-3 p-4 sm:p-5"><AutoText value={children} /></div>
    </section>
  );
}

export function AutomationPanel({ conversationId }: { conversationId: string | null }) {
  const tx = useTx();
  const [rules, setRules] = useState<ChatAutomationRule[]>([]);
  const [runs, setRuns] = useState<ChatAutomationRun[]>([]);
  const [templates, setTemplates] = useState<ChatTemplate[]>([]);
  const [tags, setTags] = useState<ChatTag[]>([]);
  const [members, setMembers] = useState<ChatTeamMember[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [preview, setPreview] = useState<{ ruleId: string; text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  const load = useCallback(async () => {
    const [list, log, library, tagList, team] = await Promise.all([
      apiGet<{ rules: ChatAutomationRule[] }>('?op=automation'),
      apiGet<{ runs: ChatAutomationRun[] }>('?op=automation-runs'),
      apiGet<{ templates: ChatTemplate[] }>('?op=templates'),
      apiGet<{ tags: ChatTag[] }>('?op=tags'),
      apiGet<{ members: ChatTeamMember[] }>('?op=team'),
    ]);
    if (!list.ok) {
      setError(list.message);
      setState(list.status === 403 || list.status === 401 ? 'denied' : 'error');
      return;
    }
    setRules(list.value.rules);
    setRuns(log.ok ? log.value.runs : []);
    setTemplates(library.ok ? library.value.templates.filter((item) => item.isActive) : []);
    setTags(tagList.ok ? tagList.value.tags.filter((tag) => tag.isActive) : []);
    setMembers(team.ok ? team.value.members.filter((member) => member.canSupport) : []);
    setState('ready');
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load, reload]);

  const save = async () => {
    if (draft === null) return;
    if (draft.actions.length === 0) {
      setNotice({ tone: 'danger', text: 'Add at least one action.' });
      return;
    }
    const problem = draft.actions.map(actionProblem).find((message) => message !== null);
    if (problem !== undefined && problem !== null) {
      setNotice({ tone: 'danger', text: problem });
      return;
    }
    setBusy(true);
    setNotice(null);
    const result = await apiPost<null>({
      op: 'automation-save',
      ...(draft.id === undefined ? {} : { id: draft.id }),
      name: draft.name,
      ...(draft.description.trim() === '' ? {} : { description: draft.description.trim() }),
      trigger: draft.trigger,
      conditions: conditionsOf(draft),
      actions: draft.actions,
      position: Math.max(0, Math.min(100_000, Number(draft.position) || 0)),
      cooldownSeconds: Math.max(0, Math.round((Number(draft.cooldownMinutes) || 0) * 60)),
      stopProcessing: draft.stopProcessing,
      isActive: draft.isActive,
    });
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: 'danger', text: result.message });
      return;
    }
    setDraft(null);
    setNotice({ tone: 'success', text: 'Rule saved.' });
    setReload((value) => value + 1);
  };

  const toggle = async (rule: ChatAutomationRule) => {
    const result = await apiPost<null>({ op: 'automation-toggle', ruleId: rule.id, isActive: !rule.isActive });
    setNotice(
      result.ok
        ? { tone: 'success', text: rule.isActive ? `“${rule.name}” is off.` : `“${rule.name}” is on.` }
        : { tone: 'danger', text: result.message },
    );
    if (result.ok) setReload((value) => value + 1);
  };

  const remove = async (rule: ChatAutomationRule) => {
    if (!window.confirm(`Delete “${rule.name}”? Its run history is deleted with it.`)) return;
    const result = await apiPost<null>({ op: 'automation-delete', id: rule.id });
    setNotice(result.ok ? { tone: 'success', text: 'Rule deleted.' } : { tone: 'danger', text: result.message });
    if (result.ok) setReload((value) => value + 1);
  };

  const dryRun = async (rule: ChatAutomationRule) => {
    if (conversationId === null) return;
    const result = await apiPost<{ wouldRun: boolean; reasons: string[] }>({
      op: 'automation-preview',
      ruleId: rule.id,
      conversationId,
    });
    if (!result.ok) {
      setNotice({ tone: 'danger', text: result.message });
      return;
    }
    setPreview({
      ruleId: rule.id,
      ok: result.value.wouldRun,
      text: result.value.wouldRun
        ? 'This rule would run for the conversation open in the Inbox.'
        : `It would not run: ${result.value.reasons.join(' ') || 'its conditions do not match.'}`,
    });
  };

  if (state === 'loading') {
    return (
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]" aria-label={tx("Loading automation")}>
        <div className="nz-panel nz-shimmer h-80 rounded-2xl border" />
        <div className="nz-panel nz-shimmer h-80 rounded-2xl border" />
      </div>
    );
  }
  if (state === 'denied' || state === 'error') {
    return (
      <div role="alert" className="nz-panel grid justify-items-center gap-3 rounded-2xl border p-8 text-center text-sm">
        <CircleAlert aria-hidden className={cn('size-5', state === 'denied' ? 'text-warning-ink' : 'text-danger-ink')} />
        <p className="max-w-md text-foreground">
          {state === 'denied'
            ? 'Automation is not available to this account. Ask an administrator for the “Manage chat automation” permission.'
            : (error ?? 'Automation could not be loaded.')}
        </p>
        {state === 'error' ? (
          <button type="button" onClick={() => setReload((value) => value + 1)} className={quietButton}>
            <RefreshCw aria-hidden className="size-3.5" /><AutoText>Try again</AutoText></button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
      <div className="grid gap-4">
        <Panel
          title={tx("Rules")}
          icon={Bot}
          actions={
            <button
              type="button"
              onClick={() => {
                setDraft({ ...BLANK, actions: [] });
                setNotice(null);
              }}
              className={quietButton}
            >
              <Plus aria-hidden className="size-3.5" /><AutoText>New rule</AutoText></button>
          }
        >
          {notice === null ? null : (
            <p role="status" className={cn('text-xs font-medium', notice.tone === 'success' ? 'text-success-ink' : 'text-danger-ink')}>
              {notice.text}
            </p>
          )}
          {conversationId === null ? (
            <p className="text-[11px] text-muted-foreground"><AutoText>Open a conversation in the Inbox to try a rule against it without sending anything.</AutoText></p>
          ) : null}
          {rules.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              No automation yet. A rule can, for example, acknowledge a refund question or raise the
              priority when a customer writes “urgent”.
            </p>
          ) : (
            <ul className="grid gap-2">
              {rules.map((rule) => (
                <li key={rule.id} className={cn('grid gap-2 rounded-xl border p-3.5', rule.isActive ? 'border-border' : 'border-dashed border-border opacity-80')}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-sm font-semibold text-foreground"><AutoText value={rule.name} /></span>
                    <Chip tone={rule.isActive ? 'success' : 'neutral'} dot className="h-5 px-2 text-[10px]">
                      {rule.isActive ? 'On' : 'Off'}
                    </Chip>
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      Ran {rule.runCount}×{rule.lastRunAt === null ? '' : ` · last ${relativeTime(rule.lastRunAt)} ago`}
                    </span>
                  </div>
                  <p className="text-xs text-body">
                    <span className="font-medium"><AutoText>When</AutoText></span> {TRIGGER_LABEL[rule.trigger].toLowerCase()}
                    <span className="font-medium"> then</span>{' '}
                    {rule.actions.map((action) => ACTION_LABEL[action.type].toLowerCase()).join(', then ')}
                    {rule.cooldownSeconds > 0
                      ? ` · at most once every ${String(Math.round(rule.cooldownSeconds / 60))} min per thread`
                      : ''}
                  </p>
                  {rule.description === null ? null : <p className="text-[11px] text-muted-foreground"><AutoText value={rule.description} /></p>}
                  {preview?.ruleId === rule.id ? (
                    <p className={cn('rounded-lg px-3 py-2 text-xs', preview.ok ? 'bg-success-soft text-success-ink' : 'bg-warning-soft text-warning-ink')}>
                      {preview.text}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setDraft(draftOf(rule));
                        setNotice(null);
                      }}
                      className={quietButton}
                    >
                      <Pencil aria-hidden className="size-3.5" /><AutoText>Edit</AutoText></button>
                    <button type="button" onClick={() => void toggle(rule)} className={quietButton}>
                      <Power aria-hidden className="size-3.5" />
                      {rule.isActive ? 'Turn off' : 'Turn on'}
                    </button>
                    {conversationId === null ? null : (
                      <button type="button" onClick={() => void dryRun(rule)} className={quietButton}>
                        <FlaskConical aria-hidden className="size-3.5" /><AutoText>Try on open conversation</AutoText></button>
                    )}
                    <button
                      type="button"
                      onClick={() => void remove(rule)}
                      className={cn(quietButton, 'text-danger-ink hover:bg-danger-soft')}
                    >
                      <Trash2 aria-hidden className="size-3.5" /><AutoText>Delete</AutoText></button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={tx("Recent runs")} icon={History}>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground"><AutoText>Nothing has run yet.</AutoText></p>
          ) : (
            <div className="-mx-4 overflow-x-auto sm:-mx-5">
              <table className="w-full min-w-136 text-sm">
                <caption className="sr-only"><AutoText>Automation runs, newest first</AutoText></caption>
                <thead>
                  <tr className="border-b border-border text-left text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                    <th scope="col" className="px-4 py-2 sm:px-5"><AutoText>Rule</AutoText></th>
                    <th scope="col" className="px-3 py-2"><AutoText>Trigger</AutoText></th>
                    <th scope="col" className="px-3 py-2"><AutoText>Result</AutoText></th>
                    <th scope="col" className="px-4 py-2 sm:px-5"><AutoText>When</AutoText></th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id} className="border-b border-border last:border-b-0">
                      <th scope="row" className="px-4 py-2 text-left font-medium text-foreground sm:px-5">
                        {run.ruleName ?? 'Deleted rule'}
                      </th>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{TRIGGER_LABEL[run.trigger]}</td>
                      <td className="px-3 py-2">
                        <Chip
                          tone={run.status === 'failed' ? 'danger' : run.status === 'applied' ? 'success' : 'neutral'}
                          className="h-5 px-2 text-[10px]"
                        >
                          {run.status === 'applied' ? 'Applied' : run.status === 'failed' ? 'Failed' : 'Skipped'}
                        </Chip>
                        {run.error === null ? null : (
                          <span className="mt-0.5 block max-w-64 truncate text-[11px] text-danger-ink" title={run.error}>
                            {run.error}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground sm:px-5">
                        {new Date(run.createdAt).toLocaleString('en-GB')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {draft === null ? (
        <div className="nz-panel hidden rounded-2xl border p-6 text-center text-sm text-muted-foreground xl:block"><AutoText>Choose a rule to edit, or start a new one.</AutoText></div>
      ) : (
        <RuleEditor
          draft={draft}
          onDraft={setDraft}
          onSave={() => void save()}
          onCancel={() => setDraft(null)}
          busy={busy}
          templates={templates}
          tags={tags}
          members={members}
          notice={notice}
        />
      )}
    </div>
  );
}

function RuleEditor({
  draft,
  onDraft,
  onSave,
  onCancel,
  busy,
  templates,
  tags,
  members,
  notice,
}: {
  draft: RuleDraft;
  onDraft: (draft: RuleDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
  templates: readonly ChatTemplate[];
  tags: readonly ChatTag[];
  members: readonly ChatTeamMember[];
  notice: { tone: 'success' | 'danger'; text: string } | null;
}) {
  const tx = useTx();
  const setAction = (index: number, action: ChatAutomationAction) =>
    onDraft({ ...draft, actions: draft.actions.map((entry, at) => (at === index ? action : entry)) });
  const toggleIn = (list: readonly string[], value: string, on: boolean) =>
    on ? [...list, value] : list.filter((entry) => entry !== value);

  return (
    <form
      aria-label={tx("Rule editor")}
      className="nz-panel-strong grid gap-4 rounded-2xl border p-4 sm:p-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <h3 className="font-display text-sm font-semibold text-foreground">
        {draft.id === undefined ? 'New rule' : 'Edit rule'}
      </h3>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Name
        <input required value={draft.name} onChange={(event) => onDraft({ ...draft, name: event.target.value })} maxLength={120} className={cn(field, 'h-9')} />
      </label>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        When
        <select
          value={draft.trigger}
          onChange={(event) => onDraft({ ...draft, trigger: event.target.value as ChatAutomationTrigger })}
          className={cn(field, 'h-9')}
        >
          {CHAT_AUTOMATION_TRIGGERS.map((trigger) => (
            <option key={trigger} value={trigger}>
              {TRIGGER_LABEL[trigger]}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="grid gap-2.5 rounded-xl border border-border p-3">
        <legend className="px-1 text-xs font-semibold text-foreground"><AutoText>Only if (all optional)</AutoText></legend>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          The message mentions any of (comma separated)
          <input
            value={draft.keywords}
            onChange={(event) => onDraft({ ...draft, keywords: event.target.value })}
            placeholder={tx("refund, return")}
            className={cn(field, 'h-9')}
          />
        </label>
        <CheckGroup
          label={tx("Status is")}
          options={CHAT_CONVERSATION_STATUSES.map((value) => ({ value, label: STATUS_LABEL[value] }))}
          selected={draft.statuses}
          onToggle={(value, on) => onDraft({ ...draft, statuses: toggleIn(draft.statuses, value, on) })}
        />
        <CheckGroup
          label={tx("Priority is")}
          options={[...CHAT_PRIORITIES].reverse().map((value) => ({ value, label: PRIORITY_LABEL[value] }))}
          selected={draft.priorities}
          onToggle={(value, on) => onDraft({ ...draft, priorities: toggleIn(draft.priorities, value, on) })}
        />
        <CheckGroup
          label={tx("Conversation is about")}
          options={Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))}
          selected={draft.kinds}
          onToggle={(value, on) => onDraft({ ...draft, kinds: toggleIn(draft.kinds, value, on) })}
        />
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          At least this many messages
          <input
            value={draft.minMessages}
            onChange={(event) => onDraft({ ...draft, minMessages: event.target.value.replace(/\D/g, '') })}
            inputMode="numeric"
            className={cn(field, 'h-9 w-28')}
          />
        </label>
      </fieldset>

      <fieldset className="grid gap-2 rounded-xl border border-border p-3">
        <legend className="px-1 text-xs font-semibold text-foreground"><AutoText>Then, in order</AutoText></legend>
        {draft.actions.length === 0 ? (
          <p className="text-xs text-muted-foreground"><AutoText>Add at least one action below.</AutoText></p>
        ) : (
          <ol className="grid gap-2">
            {draft.actions.map((action, index) => (
              <li key={`${action.type}-${String(index)}`} className="grid gap-2 rounded-lg bg-surface-muted/70 p-2.5">
                <div className="flex items-center gap-2">
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-info-soft text-[10px] font-bold text-info-ink">
                    {index + 1}
                  </span>
                  <span className="flex-1 text-xs font-semibold text-foreground">{ACTION_LABEL[action.type]}</span>
                  <button
                    type="button"
                    aria-label={`Remove “${ACTION_LABEL[action.type]}”`}
                    onClick={() => onDraft({ ...draft, actions: draft.actions.filter((_, at) => at !== index) })}
                    className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-danger-soft hover:text-danger-ink"
                  >
                    <Trash2 aria-hidden className="size-3.5" />
                  </button>
                </div>
                <ActionFields
                  action={action}
                  onChange={(next) => setAction(index, next)}
                  templates={templates}
                  tags={tags}
                  members={members}
                />
                {actionProblem(action) === null ? null : (
                  <p className="text-[11px] text-warning-ink"><AutoText value={actionProblem(action)} /></p>
                )}
              </li>
            ))}
          </ol>
        )}
        {draft.actions.length >= 10 ? null : (
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Add an action
            <select
              value=""
              onChange={(event) => {
                const type = event.target.value as ChatAutomationAction['type'];
                if (type.length === 0) return;
                onDraft({ ...draft, actions: [...draft.actions, { type }] });
              }}
              className={cn(field, 'h-9')}
            >
              <option value=""><AutoText>Choose…</AutoText></option>
              {CHAT_AUTOMATION_ACTION_TYPES.filter((type) => type !== 'schedule').map((type) => (
                <option key={type} value={type} disabled={type === 'reply_template' && templates.length === 0}>
                  {ACTION_LABEL[type]}
                  {type === 'reply_template' && templates.length === 0 ? ' (write a template first)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Run order (lower runs first)
          <input
            value={draft.position}
            onChange={(event) => onDraft({ ...draft, position: event.target.value.replace(/\D/g, '') })}
            inputMode="numeric"
            className={cn(field, 'h-9')}
          />
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          At most once per thread every (minutes)
          <input
            value={draft.cooldownMinutes}
            onChange={(event) => onDraft({ ...draft, cooldownMinutes: event.target.value.replace(/\D/g, '') })}
            inputMode="numeric"
            className={cn(field, 'h-9')}
          />
        </label>
      </div>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Note for the team (optional)
        <input
          value={draft.description}
          onChange={(event) => onDraft({ ...draft, description: event.target.value })}
          maxLength={300}
          className={cn(field, 'h-9')}
        />
      </label>
      <div className="grid gap-1.5">
        <label className="flex items-center gap-2 text-xs font-medium text-foreground">
          <input type="checkbox" checked={draft.stopProcessing} onChange={(event) => onDraft({ ...draft, stopProcessing: event.target.checked })} className="size-4 accent-primary" /><AutoText>Stop later rules from running after this one</AutoText></label>
        <label className="flex items-center gap-2 text-xs font-medium text-foreground">
          <input type="checkbox" checked={draft.isActive} onChange={(event) => onDraft({ ...draft, isActive: event.target.checked })} className="size-4 accent-primary" /><AutoText>Turn this rule on</AutoText></label>
      </div>
      {notice === null || notice.tone !== 'danger' ? null : (
        <p role="alert" className="text-xs font-medium text-danger-ink">
          {notice.text}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary-action px-4 text-sm font-semibold text-primary-action-foreground hover:bg-primary-action-hover disabled:opacity-50"
        >
          {busy ? <LoaderCircle aria-hidden className="size-4 motion-safe:animate-spin" /> : null}
          Save rule
        </button>
        <button type="button" onClick={onCancel} className={cn(quietButton, 'h-9 px-4 text-sm')}><AutoText>Cancel</AutoText></button>
      </div>
    </form>
  );
}

function CheckGroup({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: readonly { value: string; label: string }[];
  selected: readonly string[];
  onToggle: (value: string, on: boolean) => void;
}) {
  return (
    <fieldset className="grid gap-1">
      <legend className="text-xs font-medium text-muted-foreground"><AutoText value={label} /></legend>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {options.map((option) => (
          <label key={option.value} className="flex items-center gap-1.5 text-xs text-foreground">
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              onChange={(event) => onToggle(option.value, event.target.checked)}
              className="size-3.5 accent-primary"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ActionFields({
  action,
  onChange,
  templates,
  tags,
  members,
}: {
  action: ChatAutomationAction;
  onChange: (action: ChatAutomationAction) => void;
  templates: readonly ChatTemplate[];
  tags: readonly ChatTag[];
  members: readonly ChatTeamMember[];
}) {
  const tx = useTx();
  const small = cn(field, 'h-8 text-xs');
  switch (action.type) {
    case 'reply_template':
      return (
        <select
          aria-label={tx("Template")}
          value={action.templateId ?? ''}
          onChange={(event) => onChange({ type: 'reply_template', ...(event.target.value === '' ? {} : { templateId: event.target.value }) })}
          className={small}
        >
          <option value=""><AutoText>Choose a template…</AutoText></option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name} ({template.locale.toUpperCase()})
            </option>
          ))}
        </select>
      );
    case 'system_message':
      return (
        <textarea
          aria-label={tx("Line to add")}
          value={action.body ?? ''}
          onChange={(event) => onChange({ type: 'system_message', body: event.target.value })}
          rows={2}
          maxLength={1000}
          placeholder={tx("Shown in the thread to everyone, e.g. “We have received your request.”")}
          className={cn(field, 'py-1.5 text-xs')}
        />
      );
    case 'set_status':
      return (
        <select
          aria-label={tx("New status")}
          value={typeof action.value === 'string' ? action.value : ''}
          onChange={(event) => onChange({ type: 'set_status', ...(event.target.value === '' ? {} : { value: event.target.value }) })}
          className={small}
        >
          <option value=""><AutoText>Choose a status…</AutoText></option>
          {CHAT_CONVERSATION_STATUSES.map((value) => (
            <option key={value} value={value}>
              {STATUS_LABEL[value]}
            </option>
          ))}
        </select>
      );
    case 'set_priority':
      return (
        <select
          aria-label={tx("New priority")}
          value={typeof action.value === 'string' ? action.value : ''}
          onChange={(event) => onChange({ type: 'set_priority', ...(event.target.value === '' ? {} : { value: event.target.value }) })}
          className={small}
        >
          <option value=""><AutoText>Choose a priority…</AutoText></option>
          {[...CHAT_PRIORITIES].reverse().map((value) => (
            <option key={value} value={value}>
              {PRIORITY_LABEL[value]}
            </option>
          ))}
        </select>
      );
    case 'set_tags': {
      const chosen = Array.isArray(action.value) ? action.value : [];
      return tags.length === 0 ? (
        <p className="text-[11px] text-muted-foreground"><AutoText>No tags exist yet. Create them under Messages.</AutoText></p>
      ) : (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {tags.map((tag) => (
            <label key={tag.id} className="flex items-center gap-1.5 text-xs text-foreground">
              <input
                type="checkbox"
                checked={chosen.includes(tag.slug)}
                onChange={(event) =>
                  onChange({
                    type: 'set_tags',
                    value: event.target.checked ? [...chosen, tag.slug] : chosen.filter((slug) => slug !== tag.slug),
                  })
                }
                className="size-3.5 accent-primary"
              />
              {tag.label}
            </label>
          ))}
        </div>
      );
    }
    case 'assign_to':
      return (
        <select
          aria-label={tx("Teammate")}
          value={action.userId ?? ''}
          onChange={(event) => onChange({ type: 'assign_to', ...(event.target.value === '' ? {} : { userId: event.target.value }) })}
          className={small}
        >
          <option value=""><AutoText>Choose a teammate…</AutoText></option>
          {members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.name ?? member.email ?? 'Teammate'}
            </option>
          ))}
        </select>
      );
    case 'notify_staff':
    case 'escalate':
      return (
        <div className="grid gap-1.5 sm:grid-cols-2">
          <select
            aria-label={tx("Who is notified")}
            value={action.permission ?? 'admin_workspace.access'}
            onChange={(event) => onChange({ ...action, permission: event.target.value })}
            className={small}
          >
            {NOTIFY_AUDIENCE.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <input
            aria-label={tx("Notification title (optional)")}
            value={action.title ?? ''}
            onChange={(event) => onChange({ ...action, ...(event.target.value === '' ? { title: undefined } : { title: event.target.value }) })}
            maxLength={120}
            placeholder={action.type === 'escalate' ? 'Conversation escalated' : 'New message in a conversation'}
            className={small}
          />
        </div>
      );
    case 'schedule':
      return (
        <p className="text-[11px] text-muted-foreground">
          A follow-up scheduled {String(Math.round((action.delaySeconds ?? 0) / 60))} minutes later. It is kept
          as it is when you save.
        </p>
      );
    case 'pause_automation':
      return <p className="text-[11px] text-muted-foreground"><AutoText>No further automation runs on this thread.</AutoText></p>;
  }
}
