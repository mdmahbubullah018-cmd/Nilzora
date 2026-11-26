/*
 * The staff invitation email
 * --------------------------
 * Sent when the owner invites someone to the Nilzora workspace. It names the role they would
 * hold, who invited them and when the link stops working, and it says plainly that nothing is
 * granted until they accept. The link carries a one-time token; the plain-text part repeats the
 * address in full for clients that do not render the button. No address, phone number or
 * business claim is written here, and the logo is only the official artwork when
 * `EMAIL_LOGO_URL` is configured (otherwise the wordmark is text), as for every Nilzora email.
 */

import {
  BRAND,
  FONT,
  button,
  escapeHtml,
  greeting,
  keyValueRows,
  layout,
  notice,
  paragraph,
  type EmailBranding,
  type RenderedEmail,
} from './design';

export type InvitableRole = 'staff' | 'moderator' | 'admin';

const ROLE_LABEL: Record<InvitableRole, string> = {
  staff: 'Staff',
  moderator: 'Moderator',
  admin: 'Admin',
};

/** What the role is for, in one honest sentence. */
const ROLE_ABOUT: Record<InvitableRole, string> = {
  staff: 'work with orders, products and customers, within the permissions the owner gives you',
  moderator: 'review product content and customer reviews assigned to you',
  admin: 'manage the store and its team, within the permissions the owner gives you',
};

export interface StaffInvitationEmailInput {
  /** The invitee's name, when the owner entered one. */
  inviteeName: string | null;
  role: InvitableRole;
  inviterName: string;
  /** The full acceptance address, including the one-time token. */
  acceptUrl: string;
  expiresAt: Date;
}

/**
 * The acceptance address, or undefined when it is not an http(s) URL. Kept exactly as given: the
 * shared `safeUrl` appends a path to a base address, which would corrupt a token in the query.
 */
function linkOf(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

const EXPIRY = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'Asia/Dhaka',
});

export function staffInvitationEmail(
  input: StaffInvitationEmailInput,
  branding: EmailBranding = {},
): RenderedEmail {
  const role = ROLE_LABEL[input.role];
  const link = linkOf(input.acceptUrl);
  const expires = `${EXPIRY.format(input.expiresAt)} (Bangladesh time)`;
  const subject = `You are invited to join Nilzora as ${role}`;

  const body = [
    paragraph(escapeHtml(greeting(input.inviteeName))),
    paragraph(
      `${escapeHtml(input.inviterName)} has invited you to join the Nilzora team as <strong>${escapeHtml(role)}</strong>. You will ${escapeHtml(ROLE_ABOUT[input.role])}.`,
    ),
    keyValueRows([
      { label: 'Role', value: escapeHtml(role), strong: true },
      { label: 'Invited by', value: escapeHtml(input.inviterName) },
      { label: 'Link expires', value: escapeHtml(expires) },
    ]),
    `<div style="height:14px;line-height:14px;font-size:0;">&nbsp;</div>`,
    button('Accept invitation', link),
    link === undefined
      ? ''
      : paragraph(
          `If the button does not work, copy this address into your browser:<br /><span style="word-break:break-all;color:${BRAND.primary};font-family:${FONT};font-size:13px;">${escapeHtml(link)}</span>`,
          '0 0 16px 0',
        ),
    notice(
      'Nothing is granted yet',
      'The role is only given to your account after you accept. If you were not expecting this invitation, ignore this email and nothing will change.',
    ),
  ].join('\n');

  const text = [
    greeting(input.inviteeName),
    '',
    `${input.inviterName} has invited you to join the Nilzora team as ${role}. You will ${ROLE_ABOUT[input.role]}.`,
    '',
    `Role: ${role}`,
    `Invited by: ${input.inviterName}`,
    `Link expires: ${expires}`,
    '',
    link === undefined
      ? 'Open the Nilzora admin workspace to accept.'
      : `Accept the invitation: ${link}`,
    '',
    'Nothing is granted until you accept. If you were not expecting this invitation, ignore this email and nothing will change.',
  ].join('\n');

  return {
    subject,
    text,
    html: layout(branding, {
      heading: 'You are invited to join Nilzora',
      preheader: `${input.inviterName} invited you to join as ${role}.`,
      body,
      reason:
        'You received this email because the Nilzora owner invited this address to join the team.',
    }),
  };
}
