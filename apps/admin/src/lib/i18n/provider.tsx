'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { BN, type Phrase } from './messages';
import {
  DEFAULT_LANGUAGE,
  htmlLang,
  languageCookie,
  parseLanguage,
  type Language,
} from '@/lib/language';

/*
 * The language every screen reads.
 *
 * The root layout reads the preference cookie on the server and passes it here, so the first
 * paint is already in the visitor's language - no flash of English. Switching language updates
 * this provider's value: every component that calls `t()` re-renders in place, which keeps the
 * current route, scroll position, form values and open dialogs exactly as they were (a context
 * change never remounts the tree).
 *
 * Pages are server components, so their own copy is rendered on the server. After a switch the
 * provider refreshes the route (`router.refresh()`): that re-requests the page's server payload
 * *without* a full page load and without losing client state, so server-rendered text arrives in
 * the new language a moment after the client-rendered text. It is the smallest mechanism that
 * keeps both halves translated and keeps the promise that switching never reloads the page.
 */

interface LanguageContextValue {
  language: Language;
  /** Translates a phrase; `{name}` placeholders are filled from `params`. */
  t: (phrase: Phrase, params?: Record<string, string | number>) => string;
  /**
   * Translates text that arrives as data (a navigation label, an API code): known phrases are
   * translated, anything else is returned unchanged. This is the safe fallback.
   */
  tx: (text: string, params?: Record<string, string | number>) => string;
  /** Switches language at once and remembers it for the next visit. */
  setLanguage: (language: Language) => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function fill(text: string, params?: Record<string, string | number>): string {
  if (params === undefined) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

/** Applies a language to the document and remembers it in the cookie the root layout reads. */
export function applyLanguage(language: Language): void {
  document.cookie = languageCookie(language, {
    secure: window.location.protocol === 'https:',
  });
  document.documentElement.lang = htmlLang(language);
  document.documentElement.dataset.language = language;
}

export function LanguageProvider({
  initialLanguage,
  children,
}: {
  initialLanguage?: Language;
  children: ReactNode;
}) {
  const router = useRouter();
  const [language, setLanguageState] = useState<Language>(() =>
    parseLanguage(
      typeof document === 'undefined' ? initialLanguage : document.documentElement.dataset.language,
    ),
  );

  const setLanguage = useCallback(
    (next: Language) => {
      applyLanguage(next);
      setLanguageState(next);
      // Re-render the page's server components in the new language, in place.
      router.refresh();
    },
    [router],
  );

  const tx = useCallback(
    (text: string, params?: Record<string, string | number>) =>
      fill(language === 'bn' ? ((BN as Record<string, string>)[text] ?? text) : text, params),
    [language],
  );

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      t: (phrase: Phrase, params?: Record<string, string | number>) => tx(phrase, params),
      tx,
      setLanguage,
    }),
    [language, setLanguage, tx],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/**
 * The language and its translator. Safe outside the provider (a stray component, a test): it
 * falls back to English, so nothing crashes and nothing shows a translation key.
 */
export function useLanguage(): LanguageContextValue {
  const value = useContext(LanguageContext);
  if (value !== null) return value;
  return {
    language: DEFAULT_LANGUAGE,
    t: (phrase: Phrase, params?: Record<string, string | number>) => fill(phrase, params),
    tx: (text, params) => fill(text, params),
    setLanguage: () => undefined,
  };
}

/** The common case: just the translator. */
export function useT(): LanguageContextValue['t'] {
  return useLanguage().t;
}

/** The lenient translator, for text that arrives as data. */
export function useTx(): LanguageContextValue['tx'] {
  return useLanguage().tx;
}
