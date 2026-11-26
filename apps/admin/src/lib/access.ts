import 'server-only';
import { CSRF_FIELD, type SessionUser } from '@nilzora/web-session';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { session } from './session';
import { entryAccess, signInPath, workspaceAccess, type Workspace } from './workspace-access';

/** The outcomes that must not render workspace content. */
export type DeniedGate =
  | { access: 'forbidden'; user: SessionUser; csrf: CsrfInput }
  | { access: 'suspended'; csrf: CsrfInput }
  | { access: 'unavailable'; csrf: CsrfInput };

/** A workspace page's verdict for this request; signed-out visitors never get one. */
export type WorkspaceGate = { access: 'allowed'; user: SessionUser; csrf: CsrfInput } | DeniedGate;

/** The app root's and sign-in page's verdict: where this session may go, if anywhere. */
export type EntryGate =
  | { access: 'sign_in'; csrf: CsrfInput }
  | { access: 'allowed'; user: SessionUser; workspace: Workspace; csrf: CsrfInput }
  | DeniedGate;

/** For the sign-out (or sign-in) form on every outcome. Reads the cookie only. */
async function csrfInput(): Promise<CsrfInput> {
  return { name: CSRF_FIELD, token: await session.csrfToken() };
}

/**
 * The access check every workspace layout AND page runs before rendering anything.
 * Pages need their own call: layouts are not re-rendered on client navigation, and a
 * layout cannot stop the page beneath it from rendering into the response.
 *
 * Signed-out visitors are sent to sign in and brought back to `pagePath` (a fixed
 * path of the calling page, never request input). Everyone else gets a verdict, and
 * only `allowed` may render workspace content.
 */
/**
 * An owner session that has not passed two-factor authentication goes to the 2FA page first.
 * (The API refuses its privileged requests anyway; this sends it where it can continue.)
 */
function requireTwoFactor(
  state: Awaited<ReturnType<typeof session.getSession>>,
  next: string,
): void {
  if (state.status !== 'signed_in') return;
  const twoFactor = state.user.twoFactor;
  if (twoFactor?.required && !twoFactor.verified) {
    redirect(`/two-factor?next=${encodeURIComponent(next)}` as Route);
  }
}

export async function workspaceGate(workspace: Workspace, pagePath: Route): Promise<WorkspaceGate> {
  const state = await session.getSession();
  const access = workspaceAccess(state, workspace);
  if (access === 'sign_in') redirect(signInPath(pagePath));
  requireTwoFactor(state, pagePath);

  const csrf = await csrfInput();
  if (access === 'allowed' || access === 'forbidden') {
    // Both verdicts come only from a session the API verified.
    return state.status === 'signed_in'
      ? { access, user: state.user, csrf }
      : { access: 'unavailable', csrf };
  }
  return { access, csrf };
}

/** The verdict for pages that are not inside a workspace (the root and sign-in). */
export async function entryGate(): Promise<EntryGate> {
  const state = await session.getSession();
  const decision = entryAccess(state);
  if (decision.access === 'allowed') requireTwoFactor(state, '');
  const csrf = await csrfInput();

  if (decision.access === 'allowed' || decision.access === 'forbidden') {
    if (state.status !== 'signed_in') return { access: 'unavailable', csrf };
    return decision.access === 'allowed'
      ? { access: 'allowed', user: state.user, workspace: decision.workspace, csrf }
      : { access: 'forbidden', user: state.user, csrf };
  }
  return { access: decision.access, csrf };
}
