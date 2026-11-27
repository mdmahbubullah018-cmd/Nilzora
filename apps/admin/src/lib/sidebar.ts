/*
 * Sidebar width preference
 * ------------------------
 * The navigation rail has four preferences:
 *
 *   expanded   labels always visible
 *   collapsed  icons only, with hover/focus tooltips
 *   hover      icons at rest; the labels come out while the pointer (or the keyboard
 *              focus) is inside the rail, and it collapses again on the way out
 *   auto       follows the viewport, like Vercel's and MongoDB's rails: icons on laptop
 *              widths, labels once there is room (80rem and wider)
 *
 * Like the theme, the choice lives in a plain preference cookie: not HttpOnly (the
 * control writes it in the browser), SameSite=Lax, for the whole app, for a year. It is
 * not a credential and grants nothing; the root layout reads it on the server so the
 * first paint is already right, with no layout shift.
 *
 * Two attributes come out of it: `data-sidebar` is the preference and
 * `data-sidebar-effective` is what the rail is doing right now. CSS keys on the second,
 * so "auto" needs no duplicated rules. SIDEBAR_SCRIPT resolves auto before the first
 * paint; SidebarAutoSync re-resolves it when the window is resized, and
 * SidebarHoverSync opens and closes a "hover" rail.
 *
 * Kept free of Next.js and server-only imports: the layout and the client controls share it.
 */

export const SIDEBAR_MODES = ['expanded', 'collapsed', 'hover', 'auto'] as const;
export type SidebarMode = (typeof SIDEBAR_MODES)[number];

/** What the rail actually draws; the preference resolves to one of these. */
export type SidebarEffective = 'expanded' | 'collapsed';

export const DEFAULT_SIDEBAR: SidebarMode = 'expanded';

export const SIDEBAR_COOKIE = 'nza_sidebar';

/** One year, in seconds. */
export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Auto shows the labels from this width; narrower laptops and tablets keep the icon rail. */
export const SIDEBAR_AUTO_WIDE_QUERY = '(min-width: 80rem)';

/** A "hover" rail expands only for a pointer that can hover; touch screens keep the icons. */
export const SIDEBAR_HOVER_QUERY = '(hover: hover) and (pointer: fine)';

/** The preference a cookie value names; missing or unknown values are the default. */
export function parseSidebarMode(value: string | null | undefined): SidebarMode {
  return value === 'collapsed' || value === 'hover' || value === 'auto' ? value : DEFAULT_SIDEBAR;
}

/**
 * What the rail draws for a preference at a given width. "Hover" rests at the icon width:
 * it widens only while the pointer is inside, which the client follows separately.
 */
export function effectiveSidebar(preference: SidebarMode, wide: boolean): SidebarEffective {
  if (preference === 'collapsed' || preference === 'hover') return 'collapsed';
  if (preference === 'auto') return wide ? 'expanded' : 'collapsed';
  return 'expanded';
}

/** The preference after the "[" shortcut: expanded and collapsed swap; auto becomes concrete. */
export function toggledSidebar(
  preference: SidebarMode,
  effective: SidebarEffective = effectiveSidebar(preference, true),
): SidebarMode {
  return effective === 'collapsed' ? 'expanded' : 'collapsed';
}

/** The media query that decides an "Auto" rail; environments without it count as wide. */
export function isWideViewport(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia(SIDEBAR_AUTO_WIDE_QUERY).matches;
}

/** Whether this pointer can hover at all, so a "hover" rail can open. Unknown counts as yes. */
export function canHoverPointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia(SIDEBAR_HOVER_QUERY).matches;
}

/**
 * The `document.cookie` assignment that stores `preference`. `secure` adds the Secure
 * attribute (pass true on HTTPS pages).
 */
export function sidebarCookie(
  preference: SidebarMode,
  { secure = false }: { secure?: boolean } = {},
) {
  const attributes = [
    `${SIDEBAR_COOKIE}=${preference}`,
    'Path=/',
    `Max-Age=${String(SIDEBAR_COOKIE_MAX_AGE)}`,
    'SameSite=Lax',
  ];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

/**
 * Runs in <head>, before the first paint: mirrors the preference into
 * `data-sidebar-effective` so the rail is drawn at its real width immediately. A fixed
 * string with no user input; it only reads the attribute the server already set.
 */
export const SIDEBAR_SCRIPT = `(function(){try{var root=document.documentElement;var preference=root.getAttribute('data-sidebar');var wide=window.matchMedia('${SIDEBAR_AUTO_WIDE_QUERY}').matches;var effective=preference==='collapsed'||preference==='hover'?'collapsed':preference==='auto'?(wide?'expanded':'collapsed'):'expanded';root.setAttribute('data-sidebar-effective',effective);}catch(e){document.documentElement.setAttribute('data-sidebar-effective','expanded');}})();`;
