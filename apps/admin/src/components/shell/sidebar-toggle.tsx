'use client';

import { cn } from '@nilzora/ui';
import {
  Check,
  ChevronsRight,
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  Wand2,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useDetailsDismiss } from '@/components/admin-kit/use-details-dismiss';
import {
  canHoverPointer,
  effectiveSidebar,
  isWideViewport,
  parseSidebarMode,
  sidebarCookie,
  SIDEBAR_AUTO_WIDE_QUERY,
  SIDEBAR_HOVER_QUERY,
  SIDEBAR_MODES,
  toggledSidebar,
  type SidebarEffective,
  type SidebarMode,
} from '@/lib/sidebar';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/*
 * The rail's width control
 * -----------------------
 * Expanded, Collapsed, Expand on hover and Auto, in one small menu. Auto is resolved by
 * SIDEBAR_SCRIPT before the first paint, kept right on resize by <SidebarAutoSync /> and
 * opened on hover by <SidebarHoverSync />, so the rail never jumps between page loads.
 */

/** Re-reads the preference whenever <html data-sidebar> changes (in this tab). */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-sidebar', 'data-sidebar-effective'],
  });
  return () => observer.disconnect();
}

function currentPreference(): SidebarMode {
  return parseSidebarMode(document.documentElement.dataset.sidebar);
}

function currentEffective(): SidebarEffective {
  return document.documentElement.dataset.sidebarEffective === 'collapsed'
    ? 'collapsed'
    : 'expanded';
}

/** The server cannot know the rendered mode here; the icon follows CSS until hydration. */
function serverPreference(): SidebarMode | null {
  return null;
}

function isWide(): boolean {
  return isWideViewport();
}

/** Draws the rail at the width the preference asks for, now and whenever the window changes. */
export function applySidebarPreference(preference: SidebarMode) {
  const root = document.documentElement;
  root.dataset.sidebar = preference;
  root.dataset.sidebarEffective = effectiveSidebar(preference, isWide());
  document.cookie = sidebarCookie(preference, { secure: window.location.protocol === 'https:' });
}

/** The "[" shortcut: swap expanded and collapsed, making Auto concrete. */
export function toggleSidebarMode() {
  applySidebarPreference(toggledSidebar(currentPreference(), currentEffective()));
}

/**
 * Keeps an "Auto" rail in step with the viewport. Renders nothing. A media-query listener
 * rather than a resize handler, so it wakes only when the breakpoint is actually crossed.
 * A "hover" rail is left to <SidebarHoverSync />: its width is the pointer's business, not
 * the viewport's.
 */
export function SidebarAutoSync() {
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(SIDEBAR_AUTO_WIDE_QUERY);
    const sync = () => {
      const preference = currentPreference();
      if (preference === 'hover') return;
      const effective = effectiveSidebar(preference, query.matches);
      if (document.documentElement.dataset.sidebarEffective !== effective) {
        document.documentElement.dataset.sidebarEffective = effective;
      }
    };
    sync();
    if (typeof query.addEventListener !== 'function') return;
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  return null;
}

/** How long the pointer may sit outside the rail before a "hover" rail closes again. */
const HOVER_CLOSE_DELAY = 140;

/**
 * Opens and closes a "hover" rail: icons at rest, labels while the pointer or the keyboard
 * focus is inside it. It only writes `data-sidebar-effective`, the same attribute the
 * script and the stylesheet use, so nothing else has to know about the mode.
 *
 * Touch screens never expand on their own (a tap would otherwise open the rail with no way
 * to close it): there the preference behaves exactly like "collapsed", tooltips included.
 * A menu left open inside the rail keeps it open, so the item a click is aimed at cannot
 * disappear under the pointer.
 */
export function SidebarHoverSync() {
  useEffect(() => {
    const rail = document.querySelector('[data-nav-rail]');
    if (!(rail instanceof HTMLElement) || typeof window.matchMedia !== 'function') return;
    const hoverable = window.matchMedia(SIDEBAR_HOVER_QUERY);
    const root = document.documentElement;
    let timer = 0;

    const setEffective = (effective: SidebarEffective) => {
      if (root.dataset.sidebarEffective !== effective) root.dataset.sidebarEffective = effective;
    };
    const active = () => root.dataset.sidebar === 'hover' && hoverable.matches;
    /**
     * Focus only holds the rail open when it came from the keyboard (`:focus-visible`).
     * A click leaves focus behind on the menu's summary, and that must not pin the rail
     * open after the pointer has gone.
     */
    const keyboardFocusInside = () => {
      const focused = document.activeElement;
      return (
        focused instanceof Element && rail.contains(focused) && focused.matches(':focus-visible')
      );
    };
    const busy = () =>
      rail.matches(':hover') ||
      keyboardFocusInside() ||
      rail.querySelector('details[open]') !== null;

    const open = () => {
      window.clearTimeout(timer);
      if (active()) setEffective('expanded');
    };
    const close = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (active() && !busy()) setEffective('collapsed');
      }, HOVER_CLOSE_DELAY);
    };
    const onFocusIn = () => {
      if (keyboardFocusInside()) open();
    };

    rail.addEventListener('pointerenter', open);
    rail.addEventListener('pointerleave', close);
    rail.addEventListener('focusin', onFocusIn);
    rail.addEventListener('focusout', close);
    // A closed menu no longer keeps the rail open (the pointer is usually elsewhere by then).
    rail.addEventListener('toggle', close, true);

    // Switching to "hover" from the menu starts from the resting width, or opens straight
    // away when the pointer is already on the rail.
    const observer = new MutationObserver(() => {
      if (root.dataset.sidebar !== 'hover') return;
      if (rail.matches(':hover')) open();
      else setEffective('collapsed');
    });
    observer.observe(root, { attributes: true, attributeFilter: ['data-sidebar'] });

    return () => {
      window.clearTimeout(timer);
      rail.removeEventListener('pointerenter', open);
      rail.removeEventListener('pointerleave', close);
      rail.removeEventListener('focusin', onFocusIn);
      rail.removeEventListener('focusout', close);
      rail.removeEventListener('toggle', close, true);
      observer.disconnect();
    };
  }, []);
  return null;
}

/** Whether a key press happened while typing, where "[" must stay a character. */
function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

const OPTIONS: readonly { value: SidebarMode; label: string; hint: string; icon: LucideIcon }[] = [
  { value: 'expanded', label: 'Expanded', hint: 'Labels beside every icon', icon: PanelLeftOpen },
  {
    value: 'collapsed',
    label: 'Collapsed',
    hint: 'Icons only, with tooltips',
    icon: PanelLeftClose,
  },
  {
    value: 'hover',
    label: 'Expand on hover',
    hint: 'Icons at rest, labels while the pointer is inside; touch screens keep the icons',
    icon: ChevronsRight,
  },
  { value: 'auto', label: 'Auto', hint: 'Icons on laptops, labels when wide', icon: Wand2 },
];

/** The short form of a mode, for the chip on the summary row. */
const SHORT_LABELS: Record<SidebarMode, string> = {
  expanded: 'Expanded',
  collapsed: 'Collapsed',
  hover: 'Hover',
  auto: 'Auto',
};

/** The rail's own name for a mode, used where a sentence needs it. */
const MODE_NAMES: Record<SidebarMode, string> = {
  expanded: 'expanded',
  collapsed: 'collapsed',
  hover: 'opens on hover',
  auto: 'automatic',
};

/** The icon that stands for a mode, drawn by the rail's summary row. */
export function SidebarModeIcon({ mode }: { mode: SidebarMode | null }) {
  if (mode === 'collapsed') {
    return (
      <PanelLeftClose aria-hidden="true" className="size-[1.15rem] shrink-0" strokeWidth={1.75} />
    );
  }
  if (mode === 'hover') {
    return (
      <ChevronsRight aria-hidden="true" className="size-[1.15rem] shrink-0" strokeWidth={1.75} />
    );
  }
  if (mode === 'auto') {
    return <Wand2 aria-hidden="true" className="size-[1.15rem] shrink-0" strokeWidth={1.75} />;
  }
  return (
    <PanelLeftOpen aria-hidden="true" className="size-[1.15rem] shrink-0" strokeWidth={1.75} />
  );
}

export interface SidebarToggleProps {
  /** Names the rail in the control's label, e.g. "Admin". */
  workspaceName: string;
  className?: string;
}

/**
 * The rail's width menu: Expanded, Collapsed, Expand on hover or Auto, remembered in the
 * preference cookie the root layout reads (no layout shift on the next page). It also
 * keeps the "[" shortcut (outside text fields).
 *
 * The summary shows the current mode when the rail is expanded; collapsed, it is the
 * mode's icon alone, with the same label as a tooltip like every other rail control.
 */
export function SidebarToggle({ workspaceName, className }: SidebarToggleProps) {
  const tx = useTx();
  const preference = useSyncExternalStore(subscribe, currentPreference, serverPreference);
  const ref = useRef<HTMLDetailsElement>(null);
  const { onToggle, close } = useDetailsDismiss(ref);
  const label = preference ? SHORT_LABELS[preference] : 'Expanded';
  const modeName = preference ? MODE_NAMES[preference] : 'expanded';
  // A preference that cannot work on this pointer says so, rather than looking broken.
  const touchOnly = preference === 'hover' && !canHoverPointer();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== '[' || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target)) return;
      event.preventDefault();
      toggleSidebarMode();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <details ref={ref} onToggle={onToggle} className={cn('group nz-rail-item relative', className)}>
      <summary
        aria-label={`Navigation width: ${label} (change)`}
        aria-keyshortcuts="["
        title={`The ${workspaceName} navigation ${modeName} ( [ )`}
        className="flex h-10 w-full cursor-pointer list-none items-center gap-3 rounded-xl px-3 text-sm font-medium text-sidebar-muted transition-colors select-none hover:bg-white/7 hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden"
      >
        <SidebarModeIcon mode={preference} />
        <span className="nz-rail-label min-w-0 flex-1 truncate text-left">
          <AutoText>Menu width</AutoText>
        </span>
        <span className="nz-rail-wide rounded-md border border-white/12 px-1.5 py-0.5 text-[10px] font-semibold text-sidebar-muted group-open:border-white/20 group-open:text-sidebar-foreground">
          <AutoText value={label} />
        </span>
      </summary>

      <div className="nz-panel-strong absolute top-full left-0 z-50 mt-1.5 grid w-64 gap-1 rounded-2xl border p-1.5 text-body">
        <p className="px-2.5 pt-1 pb-1 text-[10px] font-bold tracking-wider text-muted-foreground uppercase">
          <AutoText>Navigation width</AutoText>
        </p>
        {OPTIONS.map((option) => {
          const OptionIcon = option.icon;
          const active = preference === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => {
                applySidebarPreference(option.value);
                close();
              }}
              className={cn(
                'flex items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                active
                  ? 'bg-info-soft text-foreground ring-1 ring-info-line'
                  : 'hover:bg-surface-muted',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg ring-1 ring-inset',
                  active
                    ? 'bg-surface text-info-ink ring-info-line'
                    : 'bg-surface-muted text-muted-foreground ring-border',
                )}
              >
                <OptionIcon aria-hidden="true" className="size-4" strokeWidth={1.75} />
              </span>
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  {tx(option.label)}
                  {active ? <Check aria-hidden="true" className="size-3.5 text-info-ink" /> : null}
                </span>
                <span className="text-[11px] leading-snug text-muted-foreground">
                  {tx(option.hint)}
                </span>
              </span>
            </button>
          );
        })}
        <p className="flex items-center gap-1.5 px-2.5 pt-1 pb-0.5 text-[10px] text-muted-foreground">
          <PanelLeft aria-hidden="true" className="size-3" />
          <AutoText>Press [ to switch between expanded and collapsed</AutoText>
        </p>
        {touchOnly ? (
          <p className="px-2.5 pb-1 text-[10px] leading-snug text-muted-foreground">
            <AutoText>
              This device has no hovering pointer, so the rail stays icons-only here.
            </AutoText>
          </p>
        ) : null}
      </div>
    </details>
  );
}

export { SIDEBAR_MODES };
