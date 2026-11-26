import { Card, CardContent } from '@nilzora/ui';
import { CSRF_FIELD } from '@nilzora/web-session';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthFrame } from '@/components/auth/auth-frame';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';
import { session } from '@/lib/session';
import { AutoText } from '@/components/i18n/translate';

export const metadata: Metadata = {
  title: 'Forgot your password',
  robots: { index: false, follow: false },
};

/** Staff and moderator password recovery: a six-digit code, then a new password. */
export default async function ForgotPasswordPage() {
  return (
    <AuthFrame>
      <div className="grid gap-1.5 text-center">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground"><AutoText>Reset your password</AutoText></h1>
        <p className="text-sm text-muted-foreground"><AutoText>We will email a six-digit code to the address on your Nilzora staff account.</AutoText></p>
      </div>

      <Card className="nz-panel-strong nz-panel-sheen rounded-2xl">
        <CardContent>
          <ForgotPasswordForm csrf={{ name: CSRF_FIELD, token: await session.csrfToken() }} />
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        <Link href="/login" className="underline-offset-4 hover:underline"><AutoText>Back to sign in</AutoText></Link>
      </p>
    </AuthFrame>
  );
}
