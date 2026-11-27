'use client';

import {
  CHAT_TEMPLATE_BODY_MAX,
  CHAT_TEMPLATE_CATEGORIES,
  CHAT_TEMPLATE_LOCALES,
  CHAT_TEMPLATE_VARIABLES,
  type ChatSavedReply,
  type ChatTag,
  type ChatTemplate,
} from '@nilzora/contracts';
import { cn } from '@nilzora/ui';
import {
  Archive,
  CircleAlert,
  Eye,
  LibraryBig,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Tag,
  Trash2,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Chip } from '@/components/admin-kit/chip';
import { apiGet, apiPost } from './client';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/*
 * The message library: templates, saved replies and tags
 * ------------------------------------------------------
 * A template is approved wording a customer may read, filled in by the API with the thread's
 * real values; a saved reply is an agent's own shortcut (or a shared one, which needs the same
 * permission as templates); a tag is an observation about a thread.
 *
 * The variable buttons offer exactly the vocabulary the database validates, so they can only
 * insert something the API will accept. Editing controls appear for an account that holds the
 * permission, and every save is checked again by the API.
 */

const CATEGORY_LABEL: Record<ChatTemplate['category'], string> = {
  greeting: 'Greeting',
  order_update: 'Order update',
  shipping: 'Shipping',
  returns: 'Returns',
  payment: 'Payment',
  closing: 'Closing',
  internal: 'Internal',
  other: 'Other',
};

const LOCALE_LABEL: Record<ChatTemplate['locale'], string> = { en: 'English', bn: 'বাংলা' };

const VARIABLE_LABEL: Record<(typeof CHAT_TEMPLATE_VARIABLES)[number], string> = {
  customer_name: 'Customer name',
  agent_name: 'Your name',
  store_name: 'Store name',
  order_number: 'Order number',
  order_status: 'Order status',
  payment_status: 'Payment status',
  product_name: 'Product',
  return_status: 'Return status',
  refund_status: 'Refund status',
  support_hours: 'Support hours',
};

interface Draft {
  id: string | undefined;
  name: string;
  category: ChatTemplate['category'];
  locale: ChatTemplate['locale'];
  body: string;
  description: string;
  isActive: boolean;
}

const BLANK: Draft = {
  id: undefined,
  name: '',
  category: 'other',
  locale: 'en',
  body: '',
  description: '',
  isActive: true,
};

const field =
  'w-full rounded-lg border border-input-border bg-surface px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30';
const quietButton =
  'inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground transition hover:bg-surface-muted disabled:opacity-50';
const primaryButton =
  'inline-flex h-9 items-center gap-2 rounded-lg bg-primary-action px-4 text-sm font-semibold text-primary-action-foreground transition hover:bg-primary-action-hover disabled:opacity-50';

function Panel({
  title,
  icon: Icon,
  actions,
  children,
  className,
}: {
  title: string;
  icon: typeof LibraryBig;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={title}
      className={cn('nz-panel-strong flex min-w-0 flex-col rounded-2xl border', className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
        <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-foreground">
          <Icon aria-hidden className="size-4 text-info-ink" />
          {title}
        </h3>
        {actions}
      </div>
      <div className="grid gap-3 p-4 sm:p-5">
        <AutoText value={children} />
      </div>
    </section>
  );
}

function Notice({ notice }: { notice: { tone: 'success' | 'danger'; text: string } | null }) {
  if (notice === null) return null;
  return (
    <p
      role="status"
      className={cn(
        'text-xs font-medium',
        notice.tone === 'success' ? 'text-success-ink' : 'text-danger-ink',
      )}
    >
      {notice.text}
    </p>
  );
}

export function TemplatesPanel({
  conversationId,
  canManage,
}: {
  conversationId: string | null;
  /** Holds "Manage message templates": may write templates and shared saved replies. */
  canManage: boolean;
}) {
  const tx = useTx();
  const [templates, setTemplates] = useState<ChatTemplate[]>([]);
  const [replies, setReplies] = useState<ChatSavedReply[]>([]);
  const [tags, setTags] = useState<ChatTag[] | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const load = useCallback(async () => {
    const [list, saved, catalogue] = await Promise.all([
      apiGet<{ templates: ChatTemplate[] }>(`?op=templates${canManage ? '&archived=1' : ''}`),
      apiGet<{ replies: ChatSavedReply[] }>('?op=saved-replies'),
      apiGet<{ tags: ChatTag[] }>('?op=tags'),
    ]);
    if (!list.ok) {
      setError(list.message);
      setState(list.status === 403 || list.status === 401 ? 'denied' : 'error');
      return;
    }
    setTemplates(list.value.templates);
    setReplies(saved.ok ? saved.value.replies : []);
    setTags(catalogue.ok ? catalogue.value.tags : null);
    setState('ready');
  }, [canManage]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load, reload]);

  if (state === 'loading') {
    return (
      <div
        className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]"
        aria-label={tx('Loading the message library')}
      >
        <div className="nz-panel nz-shimmer h-80 rounded-2xl border" />
        <div className="nz-panel nz-shimmer h-80 rounded-2xl border" />
      </div>
    );
  }
  if (state === 'denied' || state === 'error') {
    return (
      <div
        role="alert"
        className="nz-panel grid justify-items-center gap-3 rounded-2xl border p-8 text-center text-sm"
      >
        <CircleAlert
          aria-hidden
          className={cn('size-5', state === 'denied' ? 'text-warning-ink' : 'text-danger-ink')}
        />
        <p className="max-w-md text-foreground">
          {state === 'denied'
            ? 'The message library is not available to this account.'
            : (error ?? 'The library could not be loaded.')}
        </p>
        {state === 'error' ? (
          <button
            type="button"
            onClick={() => setReload((value) => value + 1)}
            className={quietButton}
          >
            <RefreshCw aria-hidden className="size-3.5" />
            <AutoText>Try again</AutoText>
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <TemplateLibrary
        templates={templates}
        canManage={canManage}
        conversationId={conversationId}
        onChanged={() => setReload((value) => value + 1)}
      />
      <div className="grid gap-4">
        <SavedReplies
          replies={replies}
          canShare={canManage}
          onChanged={() => setReload((value) => value + 1)}
        />
        <TagLibrary tags={tags} onChanged={() => setReload((value) => value + 1)} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function TemplateLibrary({
  templates,
  canManage,
  conversationId,
  onChanged,
}: {
  templates: readonly ChatTemplate[];
  canManage: boolean;
  conversationId: string | null;
  onChanged: () => void;
}) {
  const tx = useTx();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ChatTemplate['category'] | ''>('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [preview, setPreview] = useState<{ id: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return templates.filter(
      (template) =>
        (category === '' || template.category === category) &&
        (needle === '' ||
          template.name.toLowerCase().includes(needle) ||
          template.body.toLowerCase().includes(needle)),
    );
  }, [category, query, templates]);

  const insertVariable = (variable: string) => {
    if (draft === null) return;
    const token = `{${variable}}`;
    const element = bodyRef.current;
    const start = element?.selectionStart ?? draft.body.length;
    const end = element?.selectionEnd ?? draft.body.length;
    const body = `${draft.body.slice(0, start)}${token}${draft.body.slice(end)}`;
    setDraft({ ...draft, body });
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const save = async () => {
    if (draft === null) return;
    setBusy(true);
    setNotice(null);
    const result = await apiPost<ChatTemplate>({
      op: 'template-save',
      ...(draft.id === undefined ? {} : { id: draft.id }),
      name: draft.name,
      category: draft.category,
      locale: draft.locale,
      body: draft.body,
      ...(draft.description.trim() === '' ? {} : { description: draft.description }),
      isActive: draft.isActive,
    });
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: 'danger', text: result.message });
      return;
    }
    setDraft(null);
    setNotice({ tone: 'success', text: 'Template saved.' });
    onChanged();
  };

  const archive = async (template: ChatTemplate) => {
    if (!window.confirm(`Archive “${template.name}”? Agents will no longer be offered it.`)) return;
    const result = await apiPost<null>({ op: 'template-archive', id: template.id });
    setNotice(
      result.ok
        ? { tone: 'success', text: 'Template archived.' }
        : { tone: 'danger', text: result.message },
    );
    if (result.ok) onChanged();
  };

  const showPreview = async (template: ChatTemplate) => {
    if (conversationId === null) return;
    const result = await apiPost<{ body: string }>({
      op: 'template-render',
      templateId: template.id,
      conversationId,
    });
    if (!result.ok) {
      setNotice({ tone: 'danger', text: result.message });
      return;
    }
    setPreview({ id: template.id, body: result.value.body });
  };

  return (
    <Panel
      title={tx('Approved templates')}
      icon={LibraryBig}
      actions={
        canManage ? (
          <button type="button" onClick={() => setDraft({ ...BLANK })} className={quietButton}>
            <Plus aria-hidden className="size-3.5" />
            <AutoText>New template</AutoText>
          </button>
        ) : null
      }
    >
      {draft === null ? null : (
        <form
          className="grid gap-3 rounded-xl border border-info-line bg-info-soft/40 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <p className="text-sm font-semibold text-foreground">
            {draft.id === undefined ? 'New template' : 'Edit template'}
          </p>
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Name
            <input
              required
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              maxLength={120}
              className={cn(field, 'h-9')}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Category
              <select
                value={draft.category}
                onChange={(event) =>
                  setDraft({ ...draft, category: event.target.value as Draft['category'] })
                }
                className={cn(field, 'h-9')}
              >
                {CHAT_TEMPLATE_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {CATEGORY_LABEL[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Language
              <select
                value={draft.locale}
                onChange={(event) =>
                  setDraft({ ...draft, locale: event.target.value as Draft['locale'] })
                }
                className={cn(field, 'h-9')}
              >
                {CHAT_TEMPLATE_LOCALES.map((value) => (
                  <option key={value} value={value}>
                    {LOCALE_LABEL[value]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Message
            <textarea
              ref={bodyRef}
              required
              value={draft.body}
              onChange={(event) => setDraft({ ...draft, body: event.target.value })}
              rows={5}
              maxLength={CHAT_TEMPLATE_BODY_MAX}
              className={cn(field, 'py-2')}
            />
          </label>
          <div className="grid gap-1.5">
            <p className="text-[11px] font-medium text-muted-foreground">
              <AutoText>Insert a value at the cursor</AutoText>
            </p>
            <div className="flex flex-wrap gap-1">
              {CHAT_TEMPLATE_VARIABLES.map((variable) => (
                <button
                  key={variable}
                  type="button"
                  onClick={() => insertVariable(variable)}
                  className="rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-foreground hover:bg-surface-muted"
                >
                  {VARIABLE_LABEL[variable]}
                </button>
              ))}
            </div>
          </div>
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Note for the team (optional)
            <input
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              maxLength={300}
              className={cn(field, 'h-9')}
            />
          </label>
          <label className="flex items-center gap-2 text-xs font-medium text-foreground">
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })}
              className="size-4 accent-primary"
            />
            <AutoText>Offer it to the team</AutoText>
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={primaryButton}>
              {busy ? (
                <LoaderCircle aria-hidden className="size-4 motion-safe:animate-spin" />
              ) : null}
              Save template
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className={cn(quietButton, 'h-9 px-4 text-sm')}
            >
              <AutoText>Cancel</AutoText>
            </button>
          </div>
        </form>
      )}

      <Notice notice={notice} />

      <div className="flex flex-wrap gap-2">
        <label className="relative min-w-48 flex-1">
          <span className="sr-only">
            <AutoText>Search templates</AutoText>
          </span>
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tx('Search templates')}
            className={cn(field, 'h-9 pl-8')}
          />
        </label>
        <select
          aria-label={tx('Category')}
          value={category}
          onChange={(event) => setCategory(event.target.value as ChatTemplate['category'] | '')}
          className={cn(field, 'h-9 w-auto')}
        >
          <option value="">
            <AutoText>Every category</AutoText>
          </option>
          {CHAT_TEMPLATE_CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {CATEGORY_LABEL[value]}
            </option>
          ))}
        </select>
      </div>

      {conversationId === null ? (
        <p className="text-[11px] text-muted-foreground">
          <AutoText>
            Open a conversation in the Inbox to preview a template with that customer’s real
            details.
          </AutoText>
        </p>
      ) : null}

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {templates.length === 0
            ? canManage
              ? 'No templates yet. Write the first one for the team.'
              : 'No approved templates yet.'
            : 'No template matches this search.'}
        </p>
      ) : (
        <ul className="grid gap-2">
          {visible.map((template) => (
            <li key={template.id} className="grid gap-2 rounded-xl border border-border p-3.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-sm font-semibold text-foreground">
                  <AutoText value={template.name} />
                </span>
                <Chip tone="primary" className="h-5 px-2 text-[10px]">
                  {CATEGORY_LABEL[template.category]}
                </Chip>
                <Chip tone="neutral" className="h-5 px-2 text-[10px]">
                  {LOCALE_LABEL[template.locale]}
                </Chip>
                {template.isActive ? null : (
                  <Chip tone="warning" className="h-5 px-2 text-[10px]">
                    <AutoText>Archived</AutoText>
                  </Chip>
                )}
                <span className="ml-auto text-[11px] text-muted-foreground">
                  Used {template.usageCount}×
                </span>
              </div>
              <p className="text-sm whitespace-pre-wrap text-body">
                <AutoText value={template.body} />
              </p>
              {template.description === null ? null : (
                <p className="text-[11px] text-muted-foreground">
                  <AutoText value={template.description} />
                </p>
              )}
              {preview?.id === template.id ? (
                <div className="rounded-lg border border-success-line bg-success-soft/50 px-3 py-2">
                  <p className="text-[11px] font-semibold text-success-ink">
                    <AutoText>The customer would read</AutoText>
                  </p>
                  <p className="mt-0.5 text-sm whitespace-pre-wrap text-foreground">
                    <AutoText value={preview.body} />
                  </p>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-1.5">
                {conversationId === null ? null : (
                  <button
                    type="button"
                    onClick={() => void showPreview(template)}
                    className={quietButton}
                  >
                    <Eye aria-hidden className="size-3.5" />
                    <AutoText>Preview</AutoText>
                  </button>
                )}
                {canManage ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setNotice(null);
                        setDraft({
                          id: template.id,
                          name: template.name,
                          category: template.category,
                          locale: template.locale,
                          body: template.body,
                          description: template.description ?? '',
                          isActive: template.isActive,
                        });
                      }}
                      className={quietButton}
                    >
                      <Pencil aria-hidden className="size-3.5" />
                      <AutoText>Edit</AutoText>
                    </button>
                    {template.isActive ? (
                      <button
                        type="button"
                        onClick={() => void archive(template)}
                        className={quietButton}
                      >
                        <Archive aria-hidden className="size-3.5" />
                        <AutoText>Archive</AutoText>
                      </button>
                    ) : null}
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Saved replies
// ---------------------------------------------------------------------------

interface ReplyDraft {
  id: string | undefined;
  visibility: ChatSavedReply['visibility'];
  title: string;
  shortcut: string;
  body: string;
}

function SavedReplies({
  replies,
  canShare,
  onChanged,
}: {
  replies: readonly ChatSavedReply[];
  canShare: boolean;
  onChanged: () => void;
}) {
  const tx = useTx();
  const [draft, setDraft] = useState<ReplyDraft | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (draft === null) return;
    setBusy(true);
    setNotice(null);
    const result = await apiPost<null>({
      op: 'saved-reply-save',
      ...(draft.id === undefined ? {} : { id: draft.id }),
      visibility: draft.visibility,
      title: draft.title,
      body: draft.body,
      ...(draft.shortcut.trim() === '' ? {} : { shortcut: draft.shortcut.trim() }),
    });
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: 'danger', text: result.message });
      return;
    }
    setDraft(null);
    setNotice({ tone: 'success', text: 'Saved reply stored.' });
    onChanged();
  };

  const remove = async (reply: ChatSavedReply) => {
    if (!window.confirm(`Delete the saved reply “${reply.title}”?`)) return;
    const result = await apiPost<null>({ op: 'saved-reply-delete', id: reply.id });
    setNotice(
      result.ok
        ? { tone: 'success', text: 'Saved reply deleted.' }
        : { tone: 'danger', text: result.message },
    );
    if (result.ok) onChanged();
  };

  return (
    <Panel
      title={tx('Saved replies')}
      icon={Zap}
      actions={
        draft === null ? (
          <button
            type="button"
            onClick={() =>
              setDraft({ id: undefined, visibility: 'personal', title: '', shortcut: '', body: '' })
            }
            className={quietButton}
          >
            <Plus aria-hidden className="size-3.5" />
            <AutoText>Add</AutoText>
          </button>
        ) : null
      }
    >
      {draft === null ? null : (
        <form
          className="grid gap-2.5 rounded-xl border border-info-line bg-info-soft/40 p-3.5"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_9rem]">
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Title
              <input
                required
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                maxLength={120}
                className={cn(field, 'h-9')}
              />
            </label>
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Shortcut
              <input
                value={draft.shortcut}
                onChange={(event) => setDraft({ ...draft, shortcut: event.target.value })}
                placeholder="/refund"
                pattern="^/[a-z0-9_-]{1,24}$"
                title={tx('A slash and up to 24 lowercase letters, digits, dashes or underscores')}
                className={cn(field, 'h-9')}
              />
            </label>
          </div>
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            What to send
            <textarea
              required
              value={draft.body}
              onChange={(event) => setDraft({ ...draft, body: event.target.value })}
              rows={3}
              maxLength={2000}
              className={cn(field, 'py-2')}
            />
          </label>
          {canShare ? (
            <label className="flex items-center gap-2 text-xs font-medium text-foreground">
              <input
                type="checkbox"
                checked={draft.visibility === 'shared'}
                onChange={(event) =>
                  setDraft({ ...draft, visibility: event.target.checked ? 'shared' : 'personal' })
                }
                className="size-4 accent-primary"
              />
              <AutoText>Share with the whole team</AutoText>
            </label>
          ) : null}
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={cn(primaryButton, 'h-8 px-3 text-xs')}>
              {busy ? (
                <LoaderCircle aria-hidden className="size-3.5 motion-safe:animate-spin" />
              ) : null}
              Save
            </button>
            <button type="button" onClick={() => setDraft(null)} className={quietButton}>
              <AutoText>Cancel</AutoText>
            </button>
          </div>
        </form>
      )}
      <Notice notice={notice} />
      {replies.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <AutoText>
            No saved replies yet. Save wording you type often and insert it from the reply box.
          </AutoText>
        </p>
      ) : (
        <ul className="grid gap-2">
          {replies.map((reply) => {
            const editable = reply.visibility === 'personal' || canShare;
            return (
              <li key={reply.id} className="grid gap-1 rounded-xl border border-border p-3">
                <div className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                    <AutoText value={reply.title} />
                  </span>
                  {reply.shortcut === null ? null : (
                    <code className="rounded bg-surface-muted px-1.5 py-0.5 text-[11px] text-foreground">
                      {reply.shortcut}
                    </code>
                  )}
                  <Chip
                    tone={reply.visibility === 'shared' ? 'violet' : 'neutral'}
                    className="h-5 px-2 text-[10px]"
                  >
                    {reply.visibility === 'shared' ? 'Shared' : 'Mine'}
                  </Chip>
                </div>
                <p className="line-clamp-3 text-xs whitespace-pre-wrap text-muted-foreground">
                  <AutoText value={reply.body} />
                </p>
                {editable ? (
                  <div className="mt-1 flex gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setDraft({
                          id: reply.id,
                          visibility: reply.visibility,
                          title: reply.title,
                          shortcut: reply.shortcut ?? '',
                          body: reply.body,
                        })
                      }
                      className={cn(quietButton, 'h-7')}
                    >
                      <Pencil aria-hidden className="size-3" />
                      <AutoText>Edit</AutoText>
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(reply)}
                      className={cn(quietButton, 'h-7 text-danger-ink hover:bg-danger-soft')}
                    >
                      <Trash2 aria-hidden className="size-3" />
                      <AutoText>Delete</AutoText>
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

function TagLibrary({
  tags,
  onChanged,
}: {
  tags: readonly ChatTag[] | null;
  onChanged: () => void;
}) {
  const tx = useTx();
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);

  const create = async () => {
    if (slug.length < 2) {
      setNotice({ tone: 'danger', text: 'Use at least two letters or digits.' });
      return;
    }
    setBusy(true);
    const result = await apiPost<null>({ op: 'tag-save', slug, label: label.trim() });
    setBusy(false);
    setNotice(
      result.ok
        ? { tone: 'success', text: 'Tag created.' }
        : { tone: 'danger', text: result.message },
    );
    if (result.ok) {
      setLabel('');
      onChanged();
    }
  };

  return (
    <Panel title={tx('Tags')} icon={Tag}>
      {tags === null ? (
        <p className="text-sm text-muted-foreground">
          <AutoText>Tags are not available to this account.</AutoText>
        </p>
      ) : (
        <>
          {tags.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No tags yet. Tags let the team mark threads, e.g. “Delivery delay” or “Refund”.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <li key={tag.id} title={tag.description ?? undefined}>
                  <Chip tone={tag.isActive ? 'violet' : 'neutral'} className="h-6">
                    {tag.label}
                    <span className="font-normal opacity-70">
                      <AutoText value={tag.conversationCount} />
                    </span>
                  </Chip>
                </li>
              ))}
            </ul>
          )}
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <label className="min-w-0 flex-1">
              <span className="sr-only">
                <AutoText>New tag</AutoText>
              </span>
              <input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                maxLength={40}
                placeholder={tx('New tag, e.g. Delivery delay')}
                className={cn(field, 'h-8 text-xs')}
              />
            </label>
            <button type="submit" disabled={busy || label.trim() === ''} className={quietButton}>
              {busy ? (
                <LoaderCircle aria-hidden className="size-3.5 motion-safe:animate-spin" />
              ) : (
                <Plus aria-hidden className="size-3.5" />
              )}
              Create
            </button>
          </form>
          <Notice notice={notice} />
        </>
      )}
    </Panel>
  );
}
