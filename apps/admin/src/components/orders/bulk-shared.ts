import type { Route } from 'next';
import type { CsrfInput } from '@/components/auth/csrf-field';

/*
 * Small helpers the bulk toolbar's client components share. The Server Actions they call
 * check the CSRF field before any API call, exactly like a submitted form.
 */

/** A FormData carrying this browser's CSRF field and the given fields (arrays repeat the name). */
export function actionForm(
  csrf: CsrfInput,
  fields: Readonly<Record<string, string | readonly string[] | undefined>>,
): FormData {
  const body = new FormData();
  body.set(csrf.name, csrf.token);
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (typeof value === 'string') body.set(name, value);
    else for (const item of value) body.append(name, item);
  }
  return body;
}

export function orderPageHref(orderNumber: string): Route {
  return `/admin/orders/${encodeURIComponent(orderNumber)}` as Route;
}

/** U+FEFF: tells spreadsheet apps the file is UTF-8. */
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

/**
 * Saves text as a file in the browser (a temporary object URL, released straight after).
 * A UTF-8 byte-order mark lets spreadsheet apps read Bangla names correctly.
 */
export function downloadTextFile(text: string, fileName: string, type = 'text/csv'): void {
  const blob = new Blob([BYTE_ORDER_MARK, text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
