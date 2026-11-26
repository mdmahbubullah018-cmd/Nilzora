import 'server-only';
import { createWebSession } from '@nilzora/web-session';

/** Server-side session access for the admin app (HttpOnly cookies hold the API tokens). */
export const session = createWebSession('admin');
