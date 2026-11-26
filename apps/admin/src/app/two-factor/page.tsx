import { Alert } from '@nilzora/ui';
import { CSRF_FIELD, safeRedirectPath } from '@nilzora/web-session';
import { ShieldCheck } from 'lucide-react';
import type { Metadata, Route } from 'next';
import { redirect } from 'next/navigation';
import { AuthFrame } from '@/components/auth/auth-frame';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { TwoFactorSetup, TwoFactorVerify } from '@/components/auth/two-factor-forms';
import { AutoText } from '@/components/i18n/translate';
import { session } from '@/lib/session';
import { WORKSPACE_PATHS } from '@/lib/workspace-access';

export const metadata: Metadata = {
  title: 'Two-factor authentication',
  robots: { index: false, follow: false },
};

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * The second sign-in step for owner accounts. The workspaces send a session here until it has
 * passed two-factor authentication; the API refuses every privileged request until then, so this
 * page is a convenience, not the protection.
 */
export default async function TwoFactorPage({ searchParams }: PageProps<'/two-factor'>) {
  const params = await searchParams;
  const next = safeRedirectPath(single(params.next), WORKSPACE_PATHS, '');
  const state = await session.getSession();
  if (state.status === 'signed_out') redirect('/login?next=/two-factor');
  const csrf = { name: CSRF_FIELD, token: await session.csrfToken() };

  if (state.status !== 'signed_in') {
    return (
      <AuthFrame>
        <Alert tone="warning">
          <AutoText>Nilzora could not be reached. Reload the page in a moment.</AutoText>
        </Alert>
      </AuthFrame>
    );
  }
  const twoFactor = state.user.twoFactor;
  // Nothing to do here: an account without 2FA, or a session that already passed it.
  if (!twoFactor?.required || twoFactor.verified) redirect((next || '/') as Route);

  const enrolled = twoFactor.enrolled;
  return (
    <AuthFrame>
      <div className="grid gap-1.5 text-center lg:text-left">
        <span className="mx-auto inline-flex size-11 items-center justify-center rounded-xl bg-primary-action/10 text-primary-action lg:mx-0">
          <ShieldCheck aria-hidden="true" className="size-6" />
        </span>
        <h1 className="font-display text-[1.75rem] leading-tight font-semibold tracking-tight text-foreground">
          <AutoText>{enrolled ? 'Two-factor verification' : 'Protect your owner account'}</AutoText>
        </h1>
        <p className="text-sm text-muted-foreground">
          <AutoText>
            {enrolled
              ? 'Enter the 6-digit code from your authenticator app to continue.'
              : 'Owner accounts must use two-factor authentication before the workspace opens.'}
          </AutoText>
        </p>
      </div>

      <div className="nz-panel-strong nz-panel-sheen rounded-2xl border p-6 sm:p-8">
        {enrolled ? (
          <TwoFactorVerify csrf={csrf} next={next} />
        ) : (
          <TwoFactorSetup csrf={csrf} next={next} />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>
          <AutoText>{`Signed in as ${state.user.email ?? 'this account'}`}</AutoText>
        </span>
        <SignOutButton csrf={csrf} variant="ghost" size="sm" />
      </div>
    </AuthFrame>
  );
}
