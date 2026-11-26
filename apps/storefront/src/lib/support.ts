import 'server-only';
import { createSupportGateway } from '@nilzora/web-session';
import { session } from '@/lib/session';

/**
 * The support chat, read and written with this browser's session cookies on the server.
 * Shared with the admin workspace: see `createSupportGateway` in @nilzora/web-session.
 */
export const support = createSupportGateway(session);
export type { SupportResult } from '@nilzora/web-session';
