import type {
  PermissionInfo,
  StaffInvitation,
  StaffListResponse,
  StaffMember,
} from '@nilzora/contracts';
import {
  cn,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@nilzora/ui';
import { KeyRound, Lock, ShieldCheck, UserCog, UserPlus, Users } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ActionFeedback } from '@/components/admin-kit/action-feedback';
import { Chip } from '@/components/admin-kit/chip';
import { DataTable, DataTableEmpty } from '@/components/admin-kit/data-table';
import { DetailList } from '@/components/admin-kit/detail-list';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { SectionCard } from '@/components/admin-kit/section-card';
import { NotFoundState, ReadState } from '@/components/admin-kit/states';
import { AccountStatusBadge, RoleBadge } from '@/components/admin-kit/status-badge';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { GlassTable } from '@/components/catalog/catalog-ui';
import { formatCount, formatDate } from '@/lib/format';
import { permissionLabel } from '@/lib/identity';
import { signInPath } from '@/lib/workspace-access';
import { uuidParam } from '@/components/customers/customer-query';
import {
  InviteForm,
  PermissionOverrideForm,
  ResendInvitationForm,
  RoleChange,
} from './staff-forms';
import {
  canResendInvitation,
  groupPermissions,
  invitableRoles,
  memberName,
  overrideCounts,
  overrideOf,
  permissionCellLock,
  permissionLock,
  roleChange,
  STAFF_PATH,
  type Actor,
} from './staff-rules';
import { AutoText } from '@/components/i18n/translate';
import { InvitationsSection } from './invitations-section';
import { DateTimeText } from '@/components/i18n/format-text';

export function memberHref(userId: string): Route {
  return `/admin/staff/${userId}` as Route;
}

function PendingBadge() {
  return (
    <Chip tone="warning" dot><AutoText>Invitation pending</AutoText></Chip>
  );
}

function YouBadge() {
  return <Chip tone="primary"><AutoText>You</AutoText></Chip>;
}

export function TeamTable({ staff, actor }: { staff: readonly StaffMember[]; actor: Actor }) {
  return (
    <GlassTable label="Team members">
      <DataTable caption="Team members" dense>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead><AutoText>Member</AutoText></TableHead>
            <TableHead><AutoText>Role</AutoText></TableHead>
            <TableHead><AutoText>Status</AutoText></TableHead>
            <TableHead className="text-right"><AutoText>Permissions</AutoText></TableHead>
            <TableHead><AutoText>Overrides</AutoText></TableHead>
            <TableHead><AutoText>Role since</AutoText></TableHead>
          </TableRow>
        </TableHeader>
        {staff.length > 0 ? (
          <TableBody>
            {staff.map((member) => {
              const { grants, denials } = overrideCounts(member);
              return (
                <TableRow key={member.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="grid">
                        <Link
                          href={memberHref(member.id)}
                          className="font-medium text-link underline-offset-4 hover:underline max-sm:inline-flex max-sm:min-h-11 max-sm:items-center"
                        >
                          {memberName(member)}
                        </Link>
                        {member.fullName ? (
                          <span className="max-w-64 truncate text-xs text-muted-foreground">
                            {member.email}
                          </span>
                        ) : null}
                      </div>
                      {member.id === actor.id ? <YouBadge /> : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <RoleBadge role={member.role} />
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1.5">
                      <AccountStatusBadge status={member.status} />
                      {member.invitationPending ? <PendingBadge /> : null}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCount(member.permissions.length)}
                  </TableCell>
                  <TableCell>
                    {grants + denials === 0 ? (
                      <span className="text-muted-foreground"><AutoText>Role defaults</AutoText></span>
                    ) : (
                      <span className="flex gap-1.5">
                        {grants > 0 ? <Chip tone="success">{grants} granted</Chip> : null}
                        {denials > 0 ? <Chip tone="danger">{denials} denied</Chip> : null}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <DateTimeText value={member.grantedAt} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        ) : (
          <DataTableEmpty
            colSpan={6}
            icon={Users}
            title="No team members yet"
            description="Invite the first team member with the form."
          />
        )}
      </DataTable>
    </GlassTable>
  );
}

/** The team list with the invitation form beside it. */
export function TeamView({
  data,
  invitations,
  actor,
  csrf,
}: {
  data: StaffListResponse;
  /** Absent for a viewer who may not see invitations. */
  invitations?: readonly StaffInvitation[] | undefined;
  actor: Actor;
  csrf: CsrfInput;
}) {
  const roles = invitableRoles(actor);
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="grid min-w-0 content-start gap-3">
        <TeamTable staff={data.staff} actor={actor} />
        <p className="text-xs text-muted-foreground">
          Owners first, then admins, staff and moderators. Open a member to change their role or
          permissions.
        </p>
        {invitations !== undefined ? (
          <InvitationsSection
            invitations={invitations}
            csrf={csrf}
            canManage={actor.role === 'super_admin'}
          />
        ) : null}
      </div>
      <SectionCard
        title="Invite a team member"
        icon={UserPlus}
        description="They get an email with a one-time link to choose a password."
        className="nz-panel-strong self-start"
      >
        {roles.length > 0 ? (
          <InviteForm roles={roles} csrf={csrf} />
        ) : (
          <p className="text-sm text-muted-foreground">
            {actor.permissions.includes('staff.invite')
              ? 'Only the store owner can add system users.'
              : 'Inviting team members needs the “Invite staff” permission.'}
          </p>
        )}
      </SectionCard>
    </div>
  );
}

export async function TeamResults({ actor, csrf }: { actor: Actor; csrf: CsrfInput }) {
  const result = await adminRead((api, token) => api.adminListStaff(token));
  if (result.kind === 'signed_out') redirect(signInPath(STAFF_PATH));
  if (result.kind !== 'ok') {
    return (
      <section className="nz-panel rounded-2xl border">
        <ReadState failure={result.kind} retryHref={STAFF_PATH} permission="staff.roles.assign" />
      </section>
    );
  }
  // Invitations are read separately and only for someone who may send them; a failed read leaves
  // the team itself on screen.
  const invitations = actor.permissions.includes('staff.invite')
    ? await adminRead((api, token) => api.adminStaffInvitations(token))
    : null;
  return (
    <TeamView
      data={result.value}
      invitations={invitations?.kind === 'ok' ? invitations.value.invitations : undefined}
      actor={actor}
      csrf={csrf}
    />
  );
}

function LockNote({ reason }: { reason: string }) {
  return (
    <p className="flex items-start gap-2 rounded-xl bg-neutral-soft px-3 py-2 text-sm text-muted-foreground">
      <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
      {reason}
    </p>
  );
}

export interface PermissionMatrixProps {
  member: StaffMember;
  catalog: readonly PermissionInfo[];
  actor: Actor;
  csrf: CsrfInput;
}

/** Every permission by area: whether the member holds it, and its override. */
export function PermissionMatrix({ member, catalog, actor, csrf }: PermissionMatrixProps) {
  const lock = permissionLock(actor, member);
  const held = new Set(member.permissions);

  return (
    <div className="grid gap-4">
      {lock.locked ? <LockNote reason={lock.reason} /> : null}
      <div className="grid gap-6">
        {groupPermissions(catalog).map((group) => (
          <section key={group.area} aria-labelledby={`area-${group.area}`} className="grid gap-2">
            <h3
              id={`area-${group.area}`}
              className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
            >
              {group.area}
            </h3>
            <ul className="divide-y divide-hairline overflow-hidden rounded-xl border border-hairline">
              {group.permissions.map((permission) => {
                const override = overrideOf(member, permission.name);
                const cell = lock.locked ? lock : permissionCellLock(actor, permission.name);
                const label = permissionLabel(permission.name);
                const holds = held.has(permission.name);
                return (
                  <li
                    key={permission.name}
                    className="flex flex-col gap-3 bg-panel px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="grid min-w-0 gap-0.5">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                        {label}
                        <Chip tone={holds ? 'success' : 'neutral'}>
                          {holds ? 'Holds' : 'Does not hold'}
                        </Chip>
                        {override ? (
                          <Chip tone={override === 'grant' ? 'success' : 'danger'} dot>
                            {override === 'grant' ? 'Granted' : 'Denied'}
                          </Chip>
                        ) : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {permission.description}{' '}
                        <code className="font-mono text-[11px]">{permission.name}</code>
                      </p>
                    </div>
                    {cell.locked ? (
                      <p
                        className={cn(
                          'flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground',
                          lock.locked && 'sr-only',
                        )}
                      >
                        <Lock aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
                        {lock.locked ? 'Locked' : 'Not yours to grant'}
                      </p>
                    ) : (
                      <PermissionOverrideForm
                        userId={member.id}
                        permission={permission.name}
                        label={label}
                        override={override}
                        csrf={csrf}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Default follows the role. A denial always wins over the role and over a grant. You can only
        grant or deny permissions you hold yourself; the server checks every change.
      </p>
    </div>
  );
}

export function MemberView({
  member,
  catalog,
  actor,
  csrf,
  notice,
}: {
  member: StaffMember;
  catalog: readonly PermissionInfo[];
  actor: Actor;
  csrf: CsrfInput;
  /** A confirmation chosen from STAFF_NOTICES after a change. */
  notice?: string | undefined;
}) {
  const name = memberName(member);
  const role = roleChange(actor, member);
  const { grants, denials } = overrideCounts(member);

  return (
    <div className="grid gap-6">
      <PageToolbar
        back={{ href: STAFF_PATH, label: 'Staff' }}
        icon={UserCog}
        eyebrow={
          <>
            <RoleBadge role={member.role} />
            <AccountStatusBadge status={member.status} />
            {member.invitationPending ? <PendingBadge /> : null}
            {member.id === actor.id ? <YouBadge /> : null}
          </>
        }
        title={name}
        meta={member.fullName ? <span><AutoText value={member.email} /></span> : undefined}
      />

      {notice ? <ActionFeedback state={{ status: 'success', message: notice }} /> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <SectionCard
          title="Permissions"
          icon={KeyRound}
          description={`${formatCount(member.permissions.length)} effective permissions · ${String(grants)} granted · ${String(denials)} denied`}
          className="nz-panel-strong min-w-0"
        >
          <PermissionMatrix member={member} catalog={catalog} actor={actor} csrf={csrf} />
        </SectionCard>

        <div className="grid min-w-0 content-start gap-6">
          <SectionCard title="Account" icon={ShieldCheck}>
            <DetailList
              columns={1}
              items={[
                { label: 'Name', value: member.fullName },
                { label: 'Email address', value: member.email },
                { label: 'Role', value: <RoleBadge role={member.role} /> },
                { label: 'Status', value: <AccountStatusBadge status={member.status} /> },
                { label: 'Role since', value: formatDate(member.grantedAt) },
                {
                  label: 'Invitation',
                  value: member.invitationPending ? 'Sent, not accepted yet' : 'Accepted',
                },
              ]}
            />
            {canResendInvitation(actor, member) ? (
              <div className="mt-4 grid gap-2 border-t border-hairline pt-4">
                <p className="text-sm text-muted-foreground">
                  They have not chosen a password yet. Send a new link if the first one expired or
                  went missing.
                </p>
                <ResendInvitationForm userId={member.id} email={member.email} csrf={csrf} />
              </div>
            ) : null}
          </SectionCard>
          <SectionCard title="Role" icon={UserCog}>
            {role.locked ? (
              <LockNote reason={role.reason} />
            ) : (
              <RoleChange
                userId={member.id}
                name={name}
                currentRole={member.role}
                roles={role.roles}
                csrf={csrf}
              />
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

/** There is no single-member read: the team list holds every member. */
export async function MemberContent({
  userId,
  actor,
  csrf,
  notice,
}: {
  userId: string;
  actor: Actor;
  csrf: CsrfInput;
  notice?: string | undefined;
}) {
  const id = uuidParam(userId);
  const notFound = (
    <section className="nz-panel rounded-2xl border">
      <NotFoundState
        title="Team member not found"
        description="This account is not on the team (customers are listed under Customers)."
        titleAs="h1"
      />
    </section>
  );
  if (!id) return notFound;
  const result = await adminRead((api, token) => api.adminListStaff(token));
  if (result.kind === 'signed_out') redirect(signInPath(STAFF_PATH));
  if (result.kind !== 'ok') {
    return (
      <section className="nz-panel rounded-2xl border">
        <ReadState
          failure={result.kind}
          retryHref={memberHref(id)}
          permission="staff.roles.assign"
          titleAs="h1"
        />
      </section>
    );
  }
  const member = result.value.staff.find((candidate) => candidate.id === id);
  if (!member) return notFound;
  return (
    <MemberView
      member={member}
      catalog={result.value.permissions}
      actor={actor}
      csrf={csrf}
      notice={notice}
    />
  );
}
