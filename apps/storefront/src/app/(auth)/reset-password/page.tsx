import { CSRF_FIELD } from '@nilzora/web-session';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth/auth-card';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { resetPasswordAction } from '@/lib/auth-actions';
import { emailFrom, type SearchParams } from '@/lib/auth-params';
import { session } from '@/lib/session';

export const metadata: Metadata = {
  title: 'Choose a new password',
  robots: { index: false, follow: false },
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const email = emailFrom(params.email);
  // The reset code belongs to an address: ask for it first.
  if (!email) redirect('/forgot-password');

  return (
    <AuthCard
      title="Choose a new password"
      description="Enter the code we emailed you and pick a new password. Signing in again afterwards ends any other session."
    >
      <ResetPasswordForm
        action={resetPasswordAction}
        csrf={{ name: CSRF_FIELD, token: await session.csrfToken() }}
        email={email}
      />
    </AuthCard>
  );
}
