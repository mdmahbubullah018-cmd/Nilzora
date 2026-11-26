import type { Href } from 'expo-router';

/**
 * The customer's support inbox. The generated typed routes list the file app/support/index.tsx
 * as "/support/index" while the screen's URL is "/support", so the string is typed once here.
 */
export const SUPPORT_HREF = '/support' as Href;

/**
 * One conversation. The id is the only thing this route says; the API decides whether this
 * account may read it (a thread it may not see is answered exactly like a missing one).
 */
export function conversationHref(conversationId: string): Href {
  return `/support/${conversationId}` as Href;
}
