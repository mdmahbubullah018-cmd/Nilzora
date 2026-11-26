'use client';

import { useEffect, useState } from 'react';
import {
  MIN_SUGGEST_LENGTH,
  parseSuggestionResponse,
  type SearchSuggestion,
} from '@/lib/search-suggestions';

/** How long typing must pause before the search is asked. */
export const SUGGEST_DEBOUNCE_MS = 250;

export type SuggestionState =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | { status: 'ready'; query: string; items: SearchSuggestion[]; total: number }
  | { status: 'error'; query: string; reason: 'unavailable' | 'rate_limited' };

const IDLE: SuggestionState = { status: 'idle' };

/** The text a suggestion request is made for: trimmed, and blank when too short. */
export function suggestionQuery(text: string): string {
  const trimmed = text.trim().slice(0, 100);
  return Array.from(trimmed).length >= MIN_SUGGEST_LENGTH ? trimmed : '';
}

/**
 * Products matching `text`, asked for once typing pauses. Each new text cancels the request
 * for the previous one, and an answer is only ever shown for the text it was made for, so a
 * slow early answer can never replace a newer one.
 */
export function useSearchSuggestions(text: string): SuggestionState {
  const query = suggestionQuery(text);
  const [state, setState] = useState<SuggestionState>(IDLE);

  useEffect(() => {
    if (query === '') return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setState({ status: 'loading', query });
      fetch(`/api/search/suggestions?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      })
        .then(async (response) => {
          if (response.status === 429) {
            setState({ status: 'error', query, reason: 'rate_limited' });
            return;
          }
          const parsed = response.ok ? parseSuggestionResponse(await response.json()) : null;
          if (parsed === null || parsed.query !== query) {
            setState({ status: 'error', query, reason: 'unavailable' });
            return;
          }
          setState({ status: 'ready', query, items: parsed.items, total: parsed.total });
        })
        .catch((error: unknown) => {
          // A cancelled request belongs to text the visitor has already changed.
          if (controller.signal.aborted) return;
          void error;
          setState({ status: 'error', query, reason: 'unavailable' });
        });
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  // Only an answer for the text on screen counts; anything else is still on its way.
  if (query === '') return IDLE;
  if (state.status === 'idle' || state.query !== query) return { status: 'loading', query };
  return state;
}
