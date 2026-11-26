import { EmptyState } from '@nilzora/ui';
import { CSRF_FIELD } from '@nilzora/web-session';
import { MailX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthCard, authLinkClasses } from '@/components/auth/auth-card';
import { ConfirmEmailForm } from '@/components/auth/confirm-email-form';
import { confirmEmailAction } from '@/lib/auth-actions';
import { tokenHashFrom, type SearchParams } from '@/lib/auth-params';
import { session } from '@/lib/session';

export const metadata: Metadata = {
  title: 'Confirm your email',
  robots: { index: false, follow: false },
  // The URL carries a one-time token, so a Referer never includes the path. Not
  // 'no-referrer': that also sends `Origin: null` on the form's own POST before
  // hydration or without JavaScript, which fails the same-origin check.
  referrer: 'strict-origin',
};

export default async function ConfirmEmailPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const tokenHash = tokenHashFrom(await searchParams);
  const csrfToken = await session.csrfToken();

  const footer = (
    <>
      <Link href="/login" className={authLinkClasses}>
        Sign in
      </Link>
      <Link href="/register" className={authLinkClasses}>
        Create an account
      </Link>
    </>
  );

  if (!tokenHash) {
    return (
      <AuthCard title="Confirm your email" footer={footer}>
        <EmptyState
          icon={MailX}
          title="This confirmation link is incomplete"
          description="Open the link from your confirmation email again, or copy the whole address into your browser. If it has expired, register again to get a new one."
          className="px-0 py-4"
        />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Confirm your email"
      description="Confirm this address to finish setting up your Nilzora account, then sign in with your password."
      footer={footer}
    >
      <ConfirmEmailForm
        action={confirmEmailAction}
        csrf={{ name: CSRF_FIELD, token: csrfToken }}
        tokenHash={tokenHash}
      />
    </AuthCard>
  );
}
