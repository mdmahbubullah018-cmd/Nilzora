import { CSRF_FIELD } from '@nilzora/web-session';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthCard, authLinkClasses } from '@/components/auth/auth-card';
import { AuthSeparator, GoogleButton } from '@/components/auth/google-button';
import { LoginForm } from '@/components/auth/login-form';
import { googleSignInAction, signInAction } from '@/lib/auth-actions';
import { loginNoticeFrom, type SearchParams } from '@/lib/auth-params';
import { returnPathFrom } from '@/lib/auth-routes';
import { session } from '@/lib/session';
import { googleEnabled } from '@/lib/providers';

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const next = returnPathFrom(params.next);

  // Guests only: someone already signed in goes straight on.
  const current = await session.getSession();
  if (current.status === 'signed_in') redirect(next);

  return (
    <AuthCard
      title="Sign in"
      description="Welcome back. Sign in to see your account."
      footer={
        <p>
          New to Nilzora?{' '}
          <Link href="/register" className={authLinkClasses}>
            Create an account
          </Link>
        </p>
      }
    >
      <LoginForm
        action={signInAction}
        csrf={{ name: CSRF_FIELD, token: await session.csrfToken() }}
        next={next}
        notice={loginNoticeFrom(params)}
      />

      {(await googleEnabled()) ? (
        <div className="mt-5 grid gap-5">
          <AuthSeparator />
          <GoogleButton
            action={googleSignInAction}
            csrf={{ name: CSRF_FIELD, token: await session.csrfToken() }}
            next={next}
          />
        </div>
      ) : null}
    </AuthCard>
  );
}
