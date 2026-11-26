import { CSRF_FIELD } from '@nilzora/web-session';
import type { Metadata } from 'next';
import { AuthCard } from '@/components/auth/auth-card';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';
import { forgotPasswordAction } from '@/lib/auth-actions';
import { emailFrom, type SearchParams } from '@/lib/auth-params';
import { session } from '@/lib/session';

export const metadata: Metadata = {
  title: 'Forgot your password',
  robots: { index: false, follow: false },
};

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  return (
    <AuthCard
      title="Forgot your password?"
      description="Enter your email address and we will send you a six-digit code to choose a new password."
    >
      <ForgotPasswordForm
        action={forgotPasswordAction}
        csrf={{ name: CSRF_FIELD, token: await session.csrfToken() }}
        email={emailFrom(params.email)}
      />
    </AuthCard>
  );
}
