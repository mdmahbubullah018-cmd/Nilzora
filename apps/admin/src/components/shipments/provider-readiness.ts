import type { CourierProvider } from '@nilzora/contracts';
import { formatDateTime } from '@/lib/format';

/*
 * Pure helpers shared by the server-rendered provider cards and the client credential form.
 * They live in a plain module on purpose: anything exported from a 'use client' file is only
 * a client reference on the server, so a server component cannot call it.
 */

/** A credential field name as words: "apiKey" → "API key", "clientId" → "Client ID". */
export function credentialLabel(field: string): string {
  const words = field
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((word) => (word === 'api' ? 'API' : word === 'id' ? 'ID' : word === 'url' ? 'URL' : word));
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A label inside a sentence: "Secret key" → "secret key", "API key" stays. */
export function inSentence(label: string): string {
  return /^[A-Z]{2}/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1);
}

/** Where a credential comes from, in words (never its value). */
export function credentialStatus(
  provider: Pick<CourierProvider, 'credentials'>,
  field: string,
): { text: string; stored: boolean } {
  const entry = provider.credentials.find((credential) => credential.field === field);
  if (!entry) return { text: 'Not set', stored: false };
  if (entry.source === 'environment') return { text: 'From server environment', stored: false };
  return {
    text: entry.setAt
      ? `Stored encrypted · set ${formatDateTime(entry.setAt)}`
      : 'Stored encrypted',
    stored: true,
  };
}
