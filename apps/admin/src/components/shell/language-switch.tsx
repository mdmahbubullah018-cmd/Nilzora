'use client';

import { cn } from '@nilzora/ui';
import { Check, Languages } from 'lucide-react';
import { useRef } from 'react';
import { useDetailsDismiss } from '@/components/admin-kit/use-details-dismiss';
import { useLanguage } from '@/lib/i18n/provider';
import { LANGUAGES, type Language } from '@/lib/language';

/** Each language named in its own script — the one label a translator never translates. */
const NAMES: Record<Language, string> = { en: 'English', bn: 'বাংলা' };

/**
 * The top bar's language menu: English or বাংলা.
 *
 * Choosing one applies it immediately — the provider re-renders the screen in place and the
 * page's server text is refreshed without a reload, so the open form, the scroll position and
 * any dialog stay exactly as they were — and stores it in the preference cookie the root layout
 * reads, so the next visit arrives in that language with no flash of English.
 *
 * A native <details>, like the theme menu, so it opens without JavaScript.
 */
export function LanguageSwitch({ className }: { className?: string }) {
  const { language, setLanguage, t } = useLanguage();
  const ref = useRef<HTMLDetailsElement>(null);
  const { onToggle, close } = useDetailsDismiss(ref);

  return (
    <details ref={ref} className={cn('group relative', className)} onToggle={onToggle}>
      <summary
        aria-label={t('Change language')}
        title={t('Change language')}
        data-language-switch=""
        className="flex h-10 cursor-pointer list-none items-center gap-1.5 rounded-xl px-2 text-muted-foreground transition-colors select-none hover:bg-surface-muted hover:text-foreground [&::-webkit-details-marker]:hidden"
      >
        <Languages aria-hidden="true" className="size-[1.15rem]" strokeWidth={1.75} />
        {/* The current language, abbreviated, so the control says what it is before opening. */}
        <span aria-hidden="true" className="text-xs font-semibold tracking-wide uppercase">
          {language}
        </span>
      </summary>
      <div
        role="group"
        aria-label={t('Change language')}
        className="nz-glass absolute top-full right-0 z-40 mt-2 grid w-44 gap-0.5 rounded-2xl border p-1.5"
      >
        {LANGUAGES.map((value) => {
          const selected = language === value;
          return (
            <button
              key={value}
              type="button"
              lang={value === 'bn' ? 'bn' : 'en'}
              aria-pressed={selected}
              onClick={() => {
                setLanguage(value);
                close();
              }}
              className={cn(
                'flex h-9 items-center gap-2.5 rounded-xl px-2.5 text-sm font-medium transition-colors',
                selected
                  ? 'bg-info-soft text-foreground'
                  : 'text-body hover:bg-surface-muted hover:text-foreground',
              )}
            >
              <span className="flex-1 text-left">{NAMES[value]}</span>
              {selected ? <Check aria-hidden="true" className="size-4 text-primary" /> : null}
            </button>
          );
        })}
      </div>
    </details>
  );
}
