import { describe, expect, it } from 'vitest';
import {
  canHoverPointer,
  DEFAULT_SIDEBAR,
  effectiveSidebar,
  parseSidebarMode,
  SIDEBAR_AUTO_WIDE_QUERY,
  SIDEBAR_COOKIE,
  SIDEBAR_COOKIE_MAX_AGE,
  SIDEBAR_HOVER_QUERY,
  SIDEBAR_MODES,
  SIDEBAR_SCRIPT,
  sidebarCookie,
  toggledSidebar,
} from './sidebar';

describe('parseSidebarMode', () => {
  it('reads the four preferences and defaults everything else to expanded', () => {
    expect(parseSidebarMode('collapsed')).toBe('collapsed');
    expect(parseSidebarMode('expanded')).toBe('expanded');
    expect(parseSidebarMode('hover')).toBe('hover');
    expect(parseSidebarMode('auto')).toBe('auto');
    for (const value of [undefined, null, '', 'COLLAPSED', 'Automatic', 'narrow', '0']) {
      expect(parseSidebarMode(value)).toBe(DEFAULT_SIDEBAR);
    }
    expect(DEFAULT_SIDEBAR).toBe('expanded');
  });
});

describe('effectiveSidebar', () => {
  it('resolves auto by viewport width and leaves fixed choices alone', () => {
    expect(effectiveSidebar('expanded', false)).toBe('expanded');
    expect(effectiveSidebar('collapsed', true)).toBe('collapsed');
    expect(effectiveSidebar('auto', true)).toBe('expanded');
    expect(effectiveSidebar('auto', false)).toBe('collapsed');
  });

  it('rests a hover rail at the icon width, whatever the viewport', () => {
    expect(effectiveSidebar('hover', true)).toBe('collapsed');
    expect(effectiveSidebar('hover', false)).toBe('collapsed');
  });
});

describe('canHoverPointer', () => {
  it('assumes a hovering pointer where matchMedia is missing', () => {
    expect(canHoverPointer()).toBe(true);
  });
});

describe('toggledSidebar', () => {
  it('switches between the two widths', () => {
    expect(toggledSidebar('expanded')).toBe('collapsed');
    expect(toggledSidebar('collapsed')).toBe('expanded');
  });

  it('makes auto concrete, using what the rail is currently drawing', () => {
    expect(toggledSidebar('auto')).toBe('collapsed');
    expect(toggledSidebar('auto', 'collapsed')).toBe('expanded');
    expect(toggledSidebar('auto', 'expanded')).toBe('collapsed');
  });
});

describe('sidebarCookie', () => {
  it('stores the preference for a year across the whole app', () => {
    const cookie = sidebarCookie('collapsed');
    expect(cookie.startsWith(`${SIDEBAR_COOKIE}=collapsed;`)).toBe(true);
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain(`Max-Age=${String(SIDEBAR_COOKIE_MAX_AGE)}`);
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('Secure');
    // A preference, never a credential: nothing HttpOnly or secret is set here.
    expect(cookie).not.toContain('HttpOnly');
  });

  it('remembers auto like any other preference', () => {
    expect(sidebarCookie('auto').startsWith(`${SIDEBAR_COOKIE}=auto;`)).toBe(true);
  });

  it('adds Secure only when asked (HTTPS pages)', () => {
    expect(sidebarCookie('expanded', { secure: true })).toContain('; Secure');
  });
});

describe('SIDEBAR_SCRIPT', () => {
  it('resolves auto from the same breakpoint the stylesheet documents', () => {
    expect(SIDEBAR_SCRIPT).toContain(SIDEBAR_AUTO_WIDE_QUERY);
    expect(SIDEBAR_SCRIPT).toContain('data-sidebar-effective');
    // A fixed string: no interpolation or user input can reach it.
    expect(SIDEBAR_SCRIPT).not.toContain('${');
  });

  it('starts a hover rail at the icon width, before the first paint', () => {
    expect(SIDEBAR_SCRIPT).toContain("preference==='hover'");
  });
});

describe('SIDEBAR_MODES', () => {
  it('offers all four preferences, each of which round-trips through the cookie parser', () => {
    expect([...SIDEBAR_MODES]).toEqual(['expanded', 'collapsed', 'hover', 'auto']);
    for (const mode of SIDEBAR_MODES) expect(parseSidebarMode(mode)).toBe(mode);
  });
});

describe('SIDEBAR_HOVER_QUERY', () => {
  it('asks for a pointer that can actually hover', () => {
    expect(SIDEBAR_HOVER_QUERY).toContain('hover: hover');
    expect(SIDEBAR_HOVER_QUERY).toContain('pointer: fine');
  });
});
