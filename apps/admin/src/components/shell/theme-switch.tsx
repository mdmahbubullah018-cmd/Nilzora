'use client';

import { cn } from '@nilzora/ui';
import { Check, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useRef, useSyncExternalStore } from 'react';
import { useDetailsDismiss } from '@/components/admin-kit/use-details-dismiss';
import {
  parseThemePreference,
  resolveTheme,
  themeCookie,
  type ThemePreference,
} from '@/lib/theme';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

const OPTIONS: readonly { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

/** Re-reads the preference whenever <html data-theme-preference> changes (in this tab). */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme-preference'],
  });
  return () => observer.disconnect();
}

function currentPreference(): ThemePreference {
  return parseThemePreference(document.documentElement.dataset.themePreference);
}

/** The server cannot know the rendered preference here; the trigger icon follows CSS. */
function serverPreference(): ThemePreference | null {
  return null;
}

/** Applies a preference at once and remembers it in the cookie the root layout reads. */
export function applyThemePreference(preference: ThemePreference) {
  const root = document.documentElement;
  const deviceDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  root.dataset.themePreference = preference;
  root.dataset.theme = resolveTheme(preference, deviceDark);
  document.cookie = themeCookie(preference, { secure: window.location.protocol === 'https:' });
}

/**
 * The top bar's theme menu: Light, Dark or System (follow the device). A native
 * <details>, so it opens without JavaScript; the choice applies at once and is
 * remembered in the preference cookie, so the next page arrives in it with no flash.
 */
export function ThemeSwitch({ className }: { className?: string }) {
  const tx = useTx();
  const preference = useSyncExternalStore(subscribe, currentPreference, serverPreference);
  const ref = useRef<HTMLDetailsElement>(null);
  const { onToggle, close } = useDetailsDismiss(ref);

  return (
    <details ref={ref} className={cn('group relative', className)} onToggle={onToggle}>
      <summary
        aria-label={tx("Theme")}
        title={tx("Theme")}
        className="grid size-10 cursor-pointer list-none place-items-center rounded-xl text-muted-foreground transition-colors select-none hover:bg-surface-muted hover:text-foreground [&::-webkit-details-marker]:hidden"
      >
        {/* Driven by the dark: variant, so the right icon shows before hydration too. */}
        <Sun aria-hidden="true" className="size-[1.15rem] dark:hidden" strokeWidth={1.75} />
        <Moon aria-hidden="true" className="hidden size-[1.15rem] dark:block" strokeWidth={1.75} />
      </summary>
      <div
        role="group"
        aria-label={tx("Theme")}
        className="nz-glass absolute top-full right-0 z-40 mt-2 grid w-44 gap-0.5 rounded-2xl border p-1.5"
      >
        {OPTIONS.map(({ value, label, icon: Icon }) => {
          const selected = preference === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={preference === null ? undefined : selected}
              onClick={() => {
                applyThemePreference(value);
                close();
              }}
              className={cn(
                'flex h-9 items-center gap-2.5 rounded-xl px-2.5 text-sm font-medium transition-colors',
                selected
                  ? 'bg-info-soft text-foreground'
                  : 'text-body hover:bg-surface-muted hover:text-foreground',
              )}
            >
              <Icon aria-hidden="true" className="size-4" strokeWidth={1.75} />
              <span className="flex-1 text-left"><AutoText value={label} /></span>
              {selected ? <Check aria-hidden="true" className="size-4 text-primary" /> : null}
            </button>
          );
        })}
      </div>
    </details>
  );
}
