import { CSRF_FIELD } from '@nilzora/web-session';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthCard, authLinkClasses } from '@/components/auth/auth-card';
import { AuthSeparator, GoogleButton } from '@/components/auth/google-button';
import { RegisterForm } from '@/components/auth/register-form';
import { googleSignInAction, registerAction } from '@/lib/auth-actions';
import { ACCOUNT_PATH } from '@/lib/auth-routes';
import { googleEnabled } from '@/lib/providers';
import { session } from '@/lib/session';

export const metadata: Metadata = {
  title: 'Create an account',
  robots: { index: false, follow: false },
};

export default async function RegisterPage() {
  // Guests only.
  const current = await session.getSession();
  if (current.status === 'signed_in') redirect(ACCOUNT_PATH);

  return (
    <AuthCard
      title="Create your account"
      description="Save your details for faster Cash on Delivery orders."
      footer={
        <p>
          Already have an account?{' '}
          <Link href="/login" className={authLinkClasses}>
            Sign in
          </Link>
        </p>
      }
    >
      <RegisterForm
        action={registerAction}
        csrf={{ name: CSRF_FIELD, token: await session.csrfToken() }}
      />

      {(await googleEnabled()) ? (
        <div className="mt-5 grid gap-5">
          <AuthSeparator />
          <GoogleButton
            action={googleSignInAction}
            csrf={{ name: CSRF_FIELD, token: await session.csrfToken() }}
            next={ACCOUNT_PATH}
          />
        </div>
      ) : null}
    </AuthCard>
  );
}
