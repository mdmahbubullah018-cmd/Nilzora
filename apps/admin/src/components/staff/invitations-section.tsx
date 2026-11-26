import type { StaffInvitation, StaffInvitationStatus } from '@nilzora/contracts';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nilzora/ui';
import { MailCheck } from 'lucide-react';
import { Chip } from '@/components/admin-kit/chip';
import { DataTable, DataTableEmpty } from '@/components/admin-kit/data-table';
import { SectionCard } from '@/components/admin-kit/section-card';
import { RoleBadge } from '@/components/admin-kit/status-badge';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { AutoText } from '@/components/i18n/translate';
import { DateTimeText } from '@/components/i18n/format-text';
import { GlassTable } from '@/components/catalog/catalog-ui';
import { ResendInvitationByIdForm, RevokeInvitationForm } from './staff-forms';

/*
 * The invitations, kept apart from the team. An invitee is not a team member until they accept:
 * nothing here grants a role, and an accepted invitation is the only one that also appears in the
 * team list above. Only the owner can resend or revoke (the API and the database both check).
 */

const STATUS: Record<
  StaffInvitationStatus,
  { label: string; tone: 'warning' | 'success' | 'neutral' | 'danger' }
> = {
  pending: { label: 'Pending', tone: 'warning' },
  accepted: { label: 'Accepted', tone: 'success' },
  expired: { label: 'Expired', tone: 'neutral' },
  revoked: { label: 'Revoked', tone: 'danger' },
};

export function InvitationsSection({
  invitations,
  csrf,
  canManage,
}: {
  invitations: readonly StaffInvitation[];
  csrf: CsrfInput;
  canManage: boolean;
}) {
  const pending = invitations.filter((invitation) => invitation.status === 'pending').length;
  return (
    <SectionCard
      title="Invitations"
      icon={MailCheck}
      description={
        pending > 0
          ? `${String(pending)} waiting to be accepted. Nobody is a team member, and nothing is granted, until they accept.`
          : 'Nobody is a team member, and nothing is granted, until they accept their invitation.'
      }
      className="nz-panel-strong"
    >
      <GlassTable label="Invitations">
        <DataTable caption="Invitations" dense>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>
                <AutoText>Recipient</AutoText>
              </TableHead>
              <TableHead>
                <AutoText>Role</AutoText>
              </TableHead>
              <TableHead>
                <AutoText>Status</AutoText>
              </TableHead>
              <TableHead>
                <AutoText>Invited</AutoText>
              </TableHead>
              <TableHead>
                <AutoText>Expires</AutoText>
              </TableHead>
              <TableHead>
                <AutoText>Accepted</AutoText>
              </TableHead>
              {canManage ? (
                <TableHead className="text-right">
                  <AutoText>Actions</AutoText>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          {invitations.length > 0 ? (
            <TableBody>
              {invitations.map((invitation) => {
                const status = STATUS[invitation.status];
                const resendable =
                  invitation.status === 'pending' || invitation.status === 'expired';
                return (
                  <TableRow key={invitation.id}>
                    <TableCell>
                      <div className="grid">
                        <span className="max-w-64 truncate font-medium text-foreground">
                          {invitation.fullName ?? invitation.email}
                        </span>
                        {invitation.fullName ? (
                          <span className="max-w-64 truncate text-xs text-muted-foreground">
                            {invitation.email}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <RoleBadge role={invitation.role} />
                    </TableCell>
                    <TableCell>
                      <Chip tone={status.tone} dot>
                        <AutoText>{status.label}</AutoText>
                      </Chip>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      <DateTimeText value={invitation.createdAt} />
                      <span className="block text-xs">by {invitation.invitedBy}</span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      <DateTimeText value={invitation.expiresAt} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {invitation.acceptedAt ? <DateTimeText value={invitation.acceptedAt} /> : '—'}
                    </TableCell>
                    {canManage ? (
                      <TableCell>
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          {resendable ? (
                            <ResendInvitationByIdForm
                              invitationId={invitation.id}
                              email={invitation.email}
                              csrf={csrf}
                            />
                          ) : null}
                          {invitation.status === 'pending' ? (
                            <RevokeInvitationForm
                              invitationId={invitation.id}
                              email={invitation.email}
                              csrf={csrf}
                            />
                          ) : null}
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          ) : (
            <DataTableEmpty
              colSpan={canManage ? 7 : 6}
              title="No invitations yet"
              description="Invitations you send appear here until they are accepted."
            />
          )}
        </DataTable>
      </GlassTable>
    </SectionCard>
  );
}
