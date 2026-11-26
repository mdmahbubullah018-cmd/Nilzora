import { Alert } from '@nilzora/ui';
import { safeRedirectPath } from '@nilzora/web-session';
import type { Metadata, Route } from 'next';
import { redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import { AuthFrame } from '@/components/auth/auth-frame';
import { LoginForm } from '@/components/auth/login-form';
import { entryGate } from '@/lib/access';
import { landingPath, signInPath, WORKSPACE_PATHS } from '@/lib/workspace-access';
import { AutoText } from '@/components/i18n/translate';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false, follow: false } };

/** Repeated query parameters are refused rather than guessed between. */
function single(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Staff and moderator sign-in. Guest-only: a session that may enter a workspace goes
 * straight there. There is no registration here; staff accounts are created by the
 * store's owners and admins.
 */
export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const params = await searchParams;
  // Only a path inside the workspaces survives; anything else is dropped.
  const next = safeRedirectPath(single(params.next), WORKSPACE_PATHS, '');

  const gate = await entryGate();
  if (gate.access === 'allowed') redirect((landingPath(gate.user, next) ?? '/') as Route);
  if (gate.access !== 'sign_in') {
    return <AccessGate {...gate} retryHref={next ? signInPath(next) : '/login'} />;
  }

  // Fixed messages chosen by flag; query values are never shown.
  const signedOut = single(params.signedOut) === '1';
  const expired = !signedOut && single(params.session) === 'expired';
  const reset = !signedOut && !expired && single(params.reset) === '1';

  return (
    <AuthFrame>
      <div className="grid gap-1.5 text-center lg:text-left">
        <h1 className="font-display text-[1.75rem] leading-tight font-semibold tracking-tight text-foreground"><AutoText>Welcome back</AutoText></h1>
        <p className="text-sm text-muted-foreground"><AutoText>Sign in to the Nilzora workspaces with the account the store owner set up for you.</AutoText></p>
      </div>

      {signedOut ? <Alert tone="success"><AutoText>You have been signed out.</AutoText></Alert> : null}
      {expired ? (
        <Alert tone="warning"><AutoText>Your session has ended. Sign in again to continue.</AutoText></Alert>
      ) : null}
      {reset ? (
        <Alert tone="success"><AutoText>Your password has been changed. Sign in with the new one.</AutoText></Alert>
      ) : null}

      <div className="nz-panel-strong nz-panel-sheen rounded-2xl border p-6 sm:p-8">
        <LoginForm csrf={gate.csrf} next={next} />
      </div>

      <p className="text-center text-xs text-muted-foreground lg:text-left">
        <AutoText>Shopping with Nilzora?</AutoText>{' '}
        <AutoText>Customer accounts sign in on the storefront.</AutoText>
      </p>
    </AuthFrame>
  );
}
