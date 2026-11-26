import { Card, CardContent } from '@nilzora/ui';
import { CSRF_FIELD } from '@nilzora/web-session';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthFrame } from '@/components/auth/auth-frame';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { session } from '@/lib/session';
import { AutoText } from '@/components/i18n/translate';

export const metadata: Metadata = {
  title: 'Choose a new password',
  robots: { index: false, follow: false },
};

/** The reset code belongs to an address, so a link without a valid one asks for it first. */
function emailFrom(value: string | string[] | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const candidate = value.trim().toLowerCase();
  return candidate.length >= 3 &&
    candidate.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)
    ? candidate
    : undefined;
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const email = emailFrom(params.email);
  if (!email) redirect('/forgot-password');

  return (
    <AuthFrame>
      <div className="grid gap-1.5 text-center">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground"><AutoText>Choose a new password</AutoText></h1>
        <p className="text-sm text-muted-foreground"><AutoText>Every other session for this account ends once the password changes.</AutoText></p>
      </div>

      <Card className="nz-panel-strong nz-panel-sheen rounded-2xl">
        <CardContent>
          <ResetPasswordForm
            csrf={{ name: CSRF_FIELD, token: await session.csrfToken() }}
            email={email}
          />
        </CardContent>
      </Card>
    </AuthFrame>
  );
}
