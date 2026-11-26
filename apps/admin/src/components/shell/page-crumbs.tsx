'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Crumb } from './shell-breadcrumb';
import { AutoText } from '@/components/i18n/translate';

/*
 * The breadcrumb levels a page adds below its navigation item ("NZ100042" on an order).
 * The header lives in the workspace layout and stays mounted across navigation, so the page
 * hands its trail up through this context instead of rendering the header itself.
 */

interface CrumbState {
  trail: readonly Crumb[];
  setTrail: (trail: readonly Crumb[]) => void;
}

const CrumbContext = createContext<CrumbState | null>(null);

export function CrumbProvider({ children }: { children: ReactNode }) {
  const [trail, setTrail] = useState<readonly Crumb[]>([]);
  return <CrumbContext value={{ trail, setTrail }}><AutoText value={children} /></CrumbContext>;
}

/** The current page's trail (empty outside a provider). */
export function useCrumbTrail(): readonly Crumb[] {
  return useContext(CrumbContext)?.trail ?? [];
}

/** Rendered by a page: publishes its trail while it is on screen. */
export function PageCrumbs({ trail }: { trail: readonly Crumb[] }) {
  const context = useContext(CrumbContext);
  const setTrail = context?.setTrail;
  const key = JSON.stringify(trail);
  useEffect(() => {
    if (!setTrail) return undefined;
    setTrail(JSON.parse(key) as Crumb[]);
    return () => {
      setTrail([]);
    };
  }, [setTrail, key]);
  return null;
}
