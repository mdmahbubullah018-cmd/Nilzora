'use client';

import type { Permission } from '@nilzora/contracts';
import { cn } from '@nilzora/ui';
import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  isActivePath,
  visibleNavGroups,
  workspaces,
  type NavBadge,
  type NavGroup,
  type NavItem,
  type Workspace,
} from '@/lib/navigation';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

const tones = {
  /** On the navy (or slate, for moderation) glass rail. */
  dark: {
    group: 'text-sidebar-muted hover:text-sidebar-foreground',
    link: 'text-sidebar-muted hover:bg-white/7 hover:text-sidebar-foreground',
    active: 'nz-rail-active text-sidebar-foreground',
    badge: 'bg-workspace-accent/20 text-sidebar-foreground ring-1 ring-workspace-accent/40',
  },
  /** On the phone drawer's glass sheet. */
  light: {
    group: 'text-muted-foreground hover:text-foreground',
    link: 'text-body hover:bg-surface-muted hover:text-foreground',
    active: 'bg-info-soft text-foreground ring-1 ring-info-line',
    badge: 'bg-info-soft text-info-ink ring-1 ring-info-line',
  },
} as const;

const itemClasses =
  'nz-rail-item relative flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors';

/** Groups the visitor closed, remembered in this browser (a display preference only). */
const COLLAPSED_GROUPS_KEY = 'nza_nav_collapsed';

/** Fired in this tab when the stored choice changes (other tabs get a storage event). */
const COLLAPSED_GROUPS_EVENT = 'nz:nav-collapsed';

/** Re-reads whether the rail is currently drawing icons, when <html> changes. */
function subscribeRail(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-sidebar-effective'],
  });
  return () => observer.disconnect();
}

function railCollapsedNow(): boolean {
  return document.documentElement.dataset.sidebarEffective === 'collapsed';
}

/** The server draws labels; hydration corrects it. */
function railCollapsedServer(): false {
  return false;
}

/** The rail's fixed tooltip: which label and where, or null when none is showing. */
interface RailTip {
  text: string;
  top: number;
}

/** The stored choice as raw text (a stable snapshot for useSyncExternalStore). */
function storedCollapsed(): string {
  try {
    return window.localStorage.getItem(COLLAPSED_GROUPS_KEY) ?? '';
  } catch {
    return '';
  }
}

/** The server cannot know the visitor's choice: every group starts open. */
function serverCollapsed(): string {
  return '';
}

function subscribeCollapsed(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  window.addEventListener(COLLAPSED_GROUPS_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(COLLAPSED_GROUPS_EVENT, onChange);
  };
}

export function parseCollapsedGroups(raw: string): Set<string> {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(
      Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [],
    );
  } catch {
    return new Set();
  }
}

function writeCollapsed(ids: Set<string>) {
  try {
    window.localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify([...ids]));
  } catch {
    // Private windows may refuse storage; the menu simply forgets.
  }
  window.dispatchEvent(new Event(COLLAPSED_GROUPS_EVENT));
}

export interface SidebarNavProps {
  workspace: Workspace;
  /** The verified account's permissions; they only decide which links are listed. */
  permissions: readonly Permission[];
  tone?: keyof typeof tones;
  onNavigate?: () => void;
  /** Counts the shell read for this request, shown beside their destinations. */
  badges?: Partial<Record<NavBadge, ReactNode>>;
}

function NavLink({
  item,
  active,
  tone,
  badge,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  tone: keyof typeof tones;
  badge?: ReactNode;
  onNavigate?: (() => void) | undefined;
}) {
  const toneStyles = tones[tone];
  const tr = useTx();
  const { label, icon: Icon, href } = item;
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      onClick={onNavigate}
      className={cn(itemClasses, active ? toneStyles.active : toneStyles.link)}
    >
      {active ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-2 left-0 w-0.75 rounded-r-full bg-workspace-accent shadow-[0_0_12px_var(--nz-workspace-accent)]"
        />
      ) : null}
      <Icon aria-hidden="true" className="size-[1.15rem] shrink-0" strokeWidth={1.75} />
      <span className="nz-rail-label min-w-0 flex-1 truncate">
        <AutoText value={tr(label)} />
      </span>
      {badge ? (
        <span
          className={cn(
            'nz-rail-badge grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1.5 text-[11px] leading-none font-semibold tabular-nums empty:hidden',
            toneStyles.badge,
          )}
        >
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

/**
 * The workspace navigation: grouped destinations the account may open, each group
 * collapsible (remembered in this browser; the group holding the current page always
 * stays open). In the desktop icon rail the labels become tooltips, and a closed group
 * becomes its icon with a flyout of its destinations.
 */
export function SidebarNav({
  workspace,
  permissions,
  tone = 'dark',
  onNavigate,
  badges = {},
}: SidebarNavProps) {
  const pathname = usePathname();
  const config = workspaces[workspace];
  const groups = visibleNavGroups(config.groups, permissions);
  const toneStyles = tones[tone];
  const tr = useTx();
  // Everything starts open on the server; the stored choice applies on hydration.
  const raw = useSyncExternalStore(subscribeCollapsed, storedCollapsed, serverCollapsed);
  const collapsed = useMemo(() => parseCollapsedGroups(raw), [raw]);
  // In the icon rail every destination is shown as an icon, without its group heading.
  const railCollapsed = useSyncExternalStore(subscribeRail, railCollapsedNow, railCollapsedServer);
  const [tip, setTip] = useState<RailTip | null>(null);

  // The tooltip follows the pointer and the keyboard, and vanishes with either.
  const showTip = (target: EventTarget | null) => {
    // The pointer usually lands on the icon, which is an SVG element, not an HTMLElement.
    if (!railCollapsed || !(target instanceof Element)) return;
    const item = target.closest('.nz-rail-item');
    if (!(item instanceof HTMLElement) || !item.closest('nav')) return;
    const text = item.querySelector('.nz-rail-label')?.textContent?.trim();
    if (!text) return;
    const rect = item.getBoundingClientRect();
    setTip({ text, top: rect.top + rect.height / 2 });
  };
  const hideTip = () => setTip(null);
  // Switching back to labels hides a tooltip that was showing; no effect needed.
  const visibleTip = railCollapsed ? tip : null;

  function toggle(id: string) {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    writeCollapsed(next);
  }

  const isActive = (item: NavItem) => isActivePath(pathname, item.href, config.home);

  return (
    <nav
      aria-label={`${config.name} navigation`}
      className="grid gap-4"
      onPointerOver={(event) => showTip(event.target)}
      onPointerLeave={hideTip}
      onFocus={(event) => showTip(event.target)}
      onBlur={hideTip}
      onScroll={hideTip}
    >
      {visibleTip ? (
        <div role="tooltip" className="nz-rail-tooltip" style={{ top: visibleTip.top }}>
          {tr(visibleTip.text)}
        </div>
      ) : null}
      {groups.map((group: NavGroup, index) => {
        const holdsCurrent = group.items.some(isActive);
        // The icon rail has no group headings, so every destination is listed.
        const open = !group.label || holdsCurrent || railCollapsed || !collapsed.has(group.id);
        const listId = `nav-group-${workspace}-${group.id}`;
        return (
          <div key={group.id} className="grid gap-1">
            {index > 0 ? (
              <span aria-hidden="true" className="nz-rail-divider mx-3 h-px bg-white/8" />
            ) : null}
            {group.label ? (
              <button
                type="button"
                aria-expanded={open}
                aria-controls={listId}
                onClick={() => toggle(group.id)}
                disabled={holdsCurrent}
                className={cn(
                  'nz-rail-group flex h-7 items-center justify-between rounded-md px-3 text-[11px] font-semibold tracking-[0.08em] uppercase transition-colors disabled:cursor-default',
                  toneStyles.group,
                )}
              >
                {tr(group.label)}
                {holdsCurrent ? null : (
                  <ChevronDown
                    aria-hidden="true"
                    className={cn('size-3.5 transition-transform', !open && '-rotate-90')}
                  />
                )}
              </button>
            ) : null}

            {open ? (
              <ul id={listId} className="grid gap-0.5">
                {group.items.map((item) => (
                  <li key={item.href}>
                    <NavLink
                      item={item}
                      active={isActive(item)}
                      tone={tone}
                      badge={item.badge ? badges[item.badge] : undefined}
                      onNavigate={onNavigate}
                    />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
