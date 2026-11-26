import { CSRF_FIELD } from '@nilzora/web-session';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthCard, authLinkClasses } from '@/components/auth/auth-card';
import { VerifyOtpForm } from '@/components/auth/verify-otp-form';
import { resendOtpAction, verifyOtpAction } from '@/lib/auth-actions';
import { emailFrom, type SearchParams } from '@/lib/auth-params';
import { returnPathFrom } from '@/lib/auth-routes';
import { session } from '@/lib/session';

export const metadata: Metadata = {
  title: 'Verify your email',
  robots: { index: false, follow: false },
};

export default async function VerifyOtpPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const email = emailFrom(params.email);
  // The code belongs to an address, so there is nothing to verify without one.
  if (!email) redirect('/register');

  const current = await session.getSession();
  if (current.status === 'signed_in') redirect(returnPathFrom(params.next));

  return (
    <AuthCard
      title="Verify your email"
      description="Enter the six-digit code we emailed you to finish creating your account."
      footer={
        <p>
          Already verified?{' '}
          <Link href="/login" className={authLinkClasses}>
            Sign in
          </Link>
        </p>
      }
    >
      <VerifyOtpForm
        action={verifyOtpAction}
        resendAction={resendOtpAction}
        csrf={{ name: CSRF_FIELD, token: await session.csrfToken() }}
        email={email}
        next={returnPathFrom(params.next)}
      />
    </AuthCard>
  );
}
