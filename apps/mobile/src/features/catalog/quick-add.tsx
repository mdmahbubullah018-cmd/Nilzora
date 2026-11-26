import type { ProductDetail } from '@nilzora/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useApi } from '@/api/api-context';
import { ApiNotConfiguredError } from '@/lib/errors';
import { queryKeys } from '@/query/query-keys';
import { QuickAddSheet, type QuickAddContent } from './quick-add-sheet';

/** How long an already-read product answers a press without asking the API again. */
const FRESH_MS = 30_000;

export interface QuickAddTarget {
  id: string;
  slug: string;
  name: string;
}

export interface QuickAdd {
  /** The quick-add press: resolves the product's variants, then adds or opens the sheet. */
  press: () => void;
  /** Variants are being resolved; the press target should not fire twice. */
  checking: boolean;
  /** Render once, anywhere in the tree: the options sheet (renders nothing until needed). */
  sheet: ReactElement;
}

/**
 * Quick add from a card or a list row. A list entry does not say whether the product has
 * variants, so a press first reads the product (the very query the product screen uses, so it
 * shares that cache). Then:
 *   - no variants: `addDirect` runs, exactly the one-tap add the card always had;
 *   - any variants (even one): the options sheet opens, and only a chosen variant is added;
 *   - cannot tell (offline, API error): the sheet opens on a retry / "View product" state and
 *     nothing is added. A product is never assumed to be variant-free.
 */
export function useQuickAdd(target: QuickAddTarget, addDirect: () => void): QuickAdd {
  const api = useApi();
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(false);
  const [visible, setVisible] = useState(false);
  const [content, setContent] = useState<QuickAddContent>({ status: 'loading' });
  const mounted = useRef(true);
  // The latest add, so a press that resolves after a re-render still runs the current one.
  const direct = useRef(addDirect);
  useEffect(() => {
    direct.current = addDirect;
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const read = useCallback(
    async (staleTime: number): Promise<QuickAddContent | 'direct'> => {
      try {
        const product: ProductDetail = await queryClient.fetchQuery({
          queryKey: queryKeys.catalog.product(target.slug),
          queryFn: async ({ signal }) => {
            if (api === null) throw new ApiNotConfiguredError();
            return (await api.getProduct(target.slug, { signal })).product;
          },
          staleTime,
        });
        // An answer about another product proves nothing about this one.
        if (product.id.toLowerCase() !== target.id.toLowerCase()) return { status: 'error' };
        return product.variants.length === 0 ? 'direct' : { status: 'ready', product };
      } catch {
        return { status: 'error' };
      }
    },
    [api, queryClient, target.id, target.slug],
  );

  const press = useCallback(() => {
    if (checking) return;
    setChecking(true);
    void read(FRESH_MS).then((result) => {
      if (!mounted.current) return;
      setChecking(false);
      if (result === 'direct') {
        direct.current();
        return;
      }
      setContent(result);
      setVisible(true);
    });
  }, [checking, read]);

  const retry = useCallback(() => {
    setContent({ status: 'loading' });
    void read(0).then((result) => {
      if (!mounted.current) return;
      // No variants after all: nothing to choose, so the plain add is the right one.
      if (result === 'direct') {
        setVisible(false);
        direct.current();
        return;
      }
      setContent(result);
    });
  }, [read]);

  const sheet = (
    <QuickAddSheet
      visible={visible}
      onClose={() => {
        setVisible(false);
      }}
      content={content}
      productName={target.name}
      productSlug={target.slug}
      onRetry={retry}
    />
  );

  return { press, checking, sheet };
}
