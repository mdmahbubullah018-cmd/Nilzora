import 'server-only';
import { createSupportGateway } from '@nilzora/web-session';
import { session } from '@/lib/session';

/**
 * The Communication Center's data access: chat read and written with this operator's session
 * cookies on the server. The API decides which threads an account may see, so the queue never
 * depends on what this app renders. Shared with the storefront: see `createSupportGateway`.
 */
export const support = createSupportGateway(session);
export type { SupportResult } from '@nilzora/web-session';
