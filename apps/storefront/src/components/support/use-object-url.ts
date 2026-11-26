'use client';

import { useEffect, useMemo } from 'react';

/**
 * A local preview address for a chosen picture, released when the picture goes away.
 *
 * Guarded because a browser (or a test environment) without `URL.createObjectURL` simply shows no
 * thumbnail instead of throwing.
 */
export function useObjectUrl(file: File, enabled: boolean): string | null {
  const url = useMemo(() => {
    if (!enabled || typeof URL.createObjectURL !== 'function') return null;
    try {
      return URL.createObjectURL(file);
    } catch {
      return null;
    }
  }, [file, enabled]);
  useEffect(
    () => () => {
      if (url !== null && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
    },
    [url],
  );
  return url;
}
