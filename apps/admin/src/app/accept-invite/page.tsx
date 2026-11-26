import { Card, CardContent, EmptyState } from '@nilzora/ui';
import { MailX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthFrame } from '@/components/auth/auth-frame';
import { AcceptInviteForm } from '@/components/invite/accept-invite-form';
import { AcceptStaffInvitationForm } from '@/components/invite/accept-staff-invitation-form';
import { single } from '@/components/admin-kit/href';
import { session } from '@/lib/session';
import { inviteTokenFrom } from '@/components/invite/invite-token';
import { AutoText } from '@/components/i18n/translate';

export const metadata: Metadata = {
  title: 'Accept your invitation',
  robots: { index: false, follow: false },
  // The address carries a one-time token, so a Referer never includes the path. Not
  // 'no-referrer': that also sends `Origin: null` on the form's own post, which fails
  // the same-origin check.
  referrer: 'strict-origin',
};

/**
 * Public: an invited team member chooses a password here, then signs in. No workspace
 * gate (they have no session yet) and nothing about the invitation is shown.
 */
export default async function AcceptInvitePage({ searchParams }: PageProps<'/accept-invite'>) {
  const params = await searchParams;
  const tokenHash = inviteTokenFrom(params);
  // The invitation link: the one-time token is looked up on the server, so an invalid, used,
  // revoked or expired link only ever shows the same neutral message.
  const invitationToken = single(params.invitation);
  const invitation =
    invitationToken && invitationToken.length >= 20 && invitationToken.length <= 200
      ? await (await session.api()).staffInvitationPreview(invitationToken).catch(() => null)
      : null;

  return (
    <AuthFrame>
      <div className="grid gap-1.5 text-center">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground"><AutoText>Join the Nilzora team</AutoText></h1>
        <p className="text-sm text-muted-foreground"><AutoText>Choose a password for your workspace account, then sign in with your email address.</AutoText></p>
      </div>
      <Card className="nz-panel-strong nz-panel-sheen rounded-2xl">
        <CardContent>
          {invitationToken && invitation ? (
            <AcceptStaffInvitationForm token={invitationToken} invitation={invitation} />
          ) : tokenHash ? (
            <AcceptInviteForm tokenHash={tokenHash} />
          ) : (
            <EmptyState
              icon={MailX}
              title="This invitation link is incomplete or invalid"
              description="Open the link from your invitation email again, or copy the whole address into your browser. If it has expired, ask the person who invited you for a new one."
              className="px-0 py-4"
            />
          )}
        </CardContent>
      </Card>
      <p className="text-center text-xs text-muted-foreground">
        Already set a password?{' '}
        <Link href="/login" className="font-medium text-link underline-offset-4 hover:underline"><AutoText>Sign in</AutoText></Link>
      </p>
    </AuthFrame>
  );
}
