'use client';

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/*
 * The chosen variant's picture, shared by the gallery and the options
 *
 * A product's gallery and its option buttons are separate components on the product page, but
 * they describe one choice: when a customer picks "Navy / M" and that combination has its own
 * picture, the big picture should become it. The selected value is therefore held here, above
 * both, rather than duplicated inside each. The gallery can hand control back (the customer
 * presses "Pictures" or a thumbnail), and the options set it again on the next choice — no
 * effect, so nothing flickers while the page settles.
 */

export interface VariantImage {
  url: string;
  /** Read aloud and shown beside the picture, e.g. "Navy / M". */
  label: string;
}

interface VariantImageHandle {
  image: VariantImage | null;
  setImage: (image: VariantImage | null) => void;
}

const VariantImageContext = createContext<VariantImageHandle | undefined>(undefined);

export function VariantImageProvider({
  children,
  initial = null,
}: {
  children: ReactNode;
  /** A product with exactly one variant already has its picture chosen for the customer. */
  initial?: VariantImage | null;
}) {
  const [image, setImage] = useState<VariantImage | null>(initial);
  const value = useMemo<VariantImageHandle>(() => ({ image, setImage }), [image]);
  return <VariantImageContext.Provider value={value}>{children}</VariantImageContext.Provider>;
}

/** The shared choice, or undefined when the page is rendered without a provider. */
export function useVariantImageHandle(): VariantImageHandle | undefined {
  return useContext(VariantImageContext);
}
