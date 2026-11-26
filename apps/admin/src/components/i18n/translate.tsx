'use client';

import type { ReactNode } from 'react';
import { useT, useTx } from '@/lib/i18n/provider';
import type { Phrase } from '@/lib/i18n/messages';

/**
 * A translated phrase, for places that cannot call a hook — server components, mostly.
 *
 * `<Translate phrase="Skip to content" />` renders the phrase in the reader's language. Client
 * components should call `useT()` directly; this exists so server-rendered chrome does not have
 * to become a client component just to say one sentence.
 */
export function Translate({
  phrase,
  params,
}: {
  phrase: Phrase;
  params?: Record<string, string | number>;
}) {
  const t = useT();
  return <>{t(phrase, params)}</>;
}

/**
 * Translates a string and leaves anything richer alone — a node that already contains markup, a
 * badge or an icon keeps rendering as written. This is what lets one shared panel translate the
 * text of every page that uses it.
 *
 * It renders a bare string, never an element, so it is valid inside `<option>`, `<th>` and any
 * other place that only accepts text.
 */
export function AutoText({ value, children }: { value?: ReactNode; children?: ReactNode }) {
  const tx = useTx();
  const text = value ?? children;
  if (typeof text !== 'string') return <>{text}</>;
  return <>{tx(text)}</>;
}
