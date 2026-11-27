'use client';

import type { Permission } from '@nilzora/contracts';
import { cn } from '@nilzora/ui';
import {
  ArrowRight,
  CornerDownLeft,
  Monitor,
  Moon,
  PanelLeft,
  Search,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from 'react';
import {
  visibleCreateActions,
  visibleNavGroups,
  workspaces,
  type Workspace,
} from '@/lib/navigation';
import { toggleSidebarMode } from './sidebar-toggle';
import { applyThemePreference } from './theme-switch';
import type { QuickSearchScope } from './quick-search';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/** Any control can open the palette by dispatching this event on `window`. */
export const OPEN_COMMAND_PALETTE = 'nz:open-command-palette';

export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE));
}

/** "⌘" on Apple devices, "Ctrl" elsewhere (and on the server, until hydration). */
export function useModifierLabel(): string {
  return useSyncExternalStore(
    () => () => undefined,
    () => (/Mac|iPhone|iPad/i.test(navigator.userAgent) ? '⌘' : 'Ctrl'),
    () => 'Ctrl',
  );
}

type CommandGroup = 'Search' | 'Go to' | 'Create' | 'Preferences';

interface Command {
  id: string;
  group: CommandGroup;
  label: string;
  hint?: string;
  icon: LucideIcon;
  /** Extra words that match it (labels, group names, synonyms). */
  terms: string;
  run: () => void;
}

const GROUP_ORDER: readonly CommandGroup[] = ['Search', 'Go to', 'Create', 'Preferences'];

/** Ranks a command for a query; null when it does not match every word of it. */
export function commandScore(label: string, terms: string, query: string): number | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 3;
  const name = label.toLowerCase();
  const haystack = `${name} ${terms.toLowerCase()}`;
  if (!words.every((word) => haystack.includes(word))) return null;
  const phrase = words.join(' ');
  if (name.startsWith(phrase)) return 0;
  if (name.includes(phrase)) return 1;
  return 2;
}

export interface CommandPaletteProps {
  workspace: Workspace;
  /** The verified account's permissions; they only decide what is offered. */
  permissions: readonly Permission[];
  /** The lists this account may search (the same scopes as the top bar's search). */
  scopes: readonly QuickSearchScope[];
}

/**
 * The command palette (Ctrl/⌘ + K): jump to any page this account may open, start a
 * create flow, search a list, or change the theme and rail. Everything it offers is a
 * page or setting that exists; access is still checked by each page and the API.
 *
 * A native modal <dialog> provides the focus trap, Escape and focus restoration. The
 * field is a combobox driving a listbox (arrow keys move, Enter opens).
 */
export function CommandPalette({ workspace, permissions, scopes }: CommandPaletteProps) {
  const tx = useTx();
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${String(index)}`;

  const show = useCallback(() => {
    setQuery('');
    setActive(0);
    setOpen(true);
  }, []);

  // Ctrl/⌘ + K toggles it from anywhere; other controls open it through the event.
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey) || event.altKey) {
        return;
      }
      event.preventDefault();
      setOpen((current) => {
        if (!current) {
          setQuery('');
          setActive(0);
        }
        return !current;
      });
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener(OPEN_COMMAND_PALETTE, show);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener(OPEN_COMMAND_PALETTE, show);
    };
  }, [show]);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      field.current?.focus();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const go = (href: Route) => () => router.push(href);
    const list: Command[] = [];
    const config = workspaces[workspace];
    for (const group of visibleNavGroups(config.groups, permissions)) {
      for (const item of group.items) {
        list.push({
          id: `go:${item.href}`,
          group: 'Go to',
          label: item.label,
          hint: group.label,
          icon: item.icon,
          terms: [group.label ?? '', ...(item.keywords ?? [])].join(' '),
          run: go(item.href),
        });
      }
    }
    if (workspace === 'admin') {
      for (const action of visibleCreateActions(permissions)) {
        list.push({
          id: `create:${action.href}`,
          group: 'Create',
          label: `New ${action.label.toLowerCase()}`,
          hint: action.hint,
          icon: action.icon,
          terms: `create add new ${action.label}`,
          run: go(action.href),
        });
      }
    }
    list.push(
      {
        id: 'theme:light',
        group: 'Preferences',
        label: 'Light theme',
        icon: Sun,
        terms: 'appearance theme mode',
        run: () => applyThemePreference('light'),
      },
      {
        id: 'theme:dark',
        group: 'Preferences',
        label: 'Dark theme',
        icon: Moon,
        terms: 'appearance theme mode night',
        run: () => applyThemePreference('dark'),
      },
      {
        id: 'theme:system',
        group: 'Preferences',
        label: 'Use the system theme',
        icon: Monitor,
        terms: 'appearance theme mode auto device',
        run: () => applyThemePreference('system'),
      },
      {
        id: 'rail:toggle',
        group: 'Preferences',
        label: 'Collapse or expand the sidebar',
        hint: '[',
        icon: PanelLeft,
        terms: 'navigation rail menu sidebar',
        run: toggleSidebarMode,
      },
    );
    return list;
  }, [permissions, router, workspace]);

  const results = useMemo(() => {
    const term = query.trim();
    const searches: Command[] =
      term === ''
        ? []
        : scopes.map((scope) => ({
            id: `search:${scope.value}`,
            group: 'Search' as const,
            label: `Search ${scope.label.toLowerCase()} for “${term}”`,
            icon: Search,
            terms: '',
            run: () => router.push(`${scope.href}?q=${encodeURIComponent(term)}` as Route),
          }));
    const ranked = commands
      .map((command) => ({ command, score: commandScore(command.label, command.terms, term) }))
      .filter((entry): entry is { command: Command; score: number } => entry.score !== null)
      .sort((a, b) => a.score - b.score)
      .map((entry) => entry.command);
    const all = [...searches, ...ranked];
    // Keep the groups in a fixed order; the ranking applies inside each group.
    return GROUP_ORDER.flatMap((group) => all.filter((command) => command.group === group));
  }, [commands, query, router, scopes]);

  const current = Math.min(active, Math.max(results.length - 1, 0));

  function runAt(index: number) {
    const command = results[index];
    if (!command) return;
    setOpen(false);
    command.run();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const last = results.length - 1;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(current >= last ? 0 : current + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(current <= 0 ? last : current - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActive(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActive(last);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      runAt(current);
    }
  }

  // Keep the highlighted option in view while moving through a long list.
  useEffect(() => {
    if (!open) return;
    const option = document.getElementById(`${listId}-option-${String(current)}`);
    if (typeof option?.scrollIntoView === 'function') option.scrollIntoView({ block: 'nearest' });
  }, [current, listId, open]);

  let index = -1;

  return (
    <dialog
      ref={dialog}
      aria-label={tx('Command palette')}
      onCancel={(event) => {
        event.preventDefault();
        setOpen(false);
      }}
      onClose={() => setOpen(false)}
      onClick={(event) => {
        if (event.target === dialog.current) setOpen(false);
      }}
      className="nz-dialog m-auto mt-[12vh] w-[calc(100%-2rem)] max-w-xl overflow-visible bg-transparent p-0 text-body open:flex"
    >
      <div className="nz-dialog-panel flex max-h-[70vh] w-full flex-col overflow-hidden rounded-2xl">
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
          <input
            ref={field}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results.length > 0 ? optionId(current) : undefined}
            aria-autocomplete="list"
            aria-label={tx('Search pages and actions')}
            placeholder={tx('Search pages, actions, or type to search a list…')}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            className="h-14 w-full min-w-0 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden rounded-md border border-border px-1.5 py-0.5 font-sans text-[11px] font-semibold text-muted-foreground sm:block">
            <AutoText>Esc</AutoText>
          </kbd>
        </div>

        <div
          id={listId}
          role="listbox"
          aria-label={tx('Results')}
          className="nz-scroll overflow-y-auto p-2"
        >
          {results.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">
              Nothing matches “{query.trim()}”.
            </p>
          ) : (
            GROUP_ORDER.map((group) => {
              const items = results.filter((command) => command.group === group);
              if (items.length === 0) return null;
              return (
                <div key={group} role="group" aria-label={group} className="grid gap-0.5 pb-2">
                  <p
                    aria-hidden="true"
                    className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase"
                  >
                    {group}
                  </p>
                  {items.map((command) => {
                    index += 1;
                    const position = index;
                    const selected = position === current;
                    const Icon = command.icon;
                    return (
                      <div
                        key={command.id}
                        id={optionId(position)}
                        role="option"
                        aria-selected={selected}
                        onPointerMove={() => setActive(position)}
                        onClick={() => runAt(position)}
                        className={cn(
                          'flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-sm transition-colors',
                          selected ? 'bg-info-soft text-foreground' : 'text-body',
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            'grid size-8 shrink-0 place-items-center rounded-lg ring-1',
                            selected
                              ? 'bg-panel text-primary ring-info-line'
                              : 'bg-surface-muted text-muted-foreground ring-hairline',
                          )}
                        >
                          <Icon className="size-4" strokeWidth={1.75} />
                        </span>
                        <span className="min-w-0 flex-1 truncate font-medium">
                          <AutoText value={command.label} />
                        </span>
                        {command.hint ? (
                          <span className="hidden truncate text-xs text-muted-foreground sm:block">
                            {command.hint}
                          </span>
                        ) : null}
                        {selected ? (
                          <ArrowRight aria-hidden="true" className="size-4 text-primary" />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-4 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <kbd className="rounded border border-border px-1 font-sans">↑</kbd>
            <kbd className="rounded border border-border px-1 font-sans">↓</kbd>
            <AutoText>to move</AutoText>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CornerDownLeft aria-hidden="true" className="size-3.5" />
            <AutoText>to open</AutoText>
          </span>
          <span className="ml-auto hidden sm:inline">{workspaces[workspace].name} workspace</span>
        </div>
      </div>
    </dialog>
  );
}
