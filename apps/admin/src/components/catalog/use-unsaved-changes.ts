'use client';

import { useEffect } from 'react';

export const LEAVE_MESSAGE = 'You have unsaved changes. Leave this page and lose them?';

/** Whether a click on this link would leave the page inside the app (same tab, same origin). */
function leavesPage(anchor: HTMLAnchorElement, event: MouseEvent): boolean {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (anchor.target && anchor.target !== '_self') return false;
  if (anchor.hasAttribute('download')) return false;
  const href = anchor.getAttribute('href');
  if (!href || href.startsWith('#')) return false;
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return false;
  // A link to this very page (e.g. a hash) does not lose what was typed.
  return url.pathname !== window.location.pathname || url.search !== window.location.search;
}

/**
 * Warns before unsaved changes are lost: the browser's own prompt when the tab is closed
 * or reloaded, and a confirmation before an in-app link navigates away. The listener runs
 * in the capture phase on the document, before the app's router sees the click, so a
 * declined confirmation stops the navigation entirely.
 */
export function useUnsavedChanges(dirty: boolean, message = LEAVE_MESSAGE): void {
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers show the prompt only when returnValue is set.
      event.returnValue = '';
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a');
      if (!anchor || !leavesPage(anchor, event)) return;
      if (window.confirm(message)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, message]);
}
