import { buttonClasses, Card, CardContent, cn } from '@nilzora/ui';
import type { SessionUser } from '@nilzora/web-session';
import { CloudOff, ShieldX, UserX, type LucideIcon } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AuthFrame } from '@/components/auth/auth-frame';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { displayName, roleLabel } from '@/lib/identity';
import { workspaces } from '@/lib/navigation';
import { permittedWorkspaces, WORKSPACE_HOME, type Workspace } from '@/lib/workspace-access';
import { AutoText } from '@/components/i18n/translate';

export type AccessGateProps = {
  /** The workspace that was refused; omitted where no particular workspace was asked for. */
  workspace?: Workspace;
  /** The page to reload when the API could not be reached. */
  retryHref: Route;
  csrf: CsrfInput;
} & (
  | { access: 'forbidden'; user: Pick<SessionUser, 'email' | 'profile' | 'role' | 'permissions'> }
  | { access: 'suspended' }
  | { access: 'unavailable' }
);

const icons = {
  forbidden: {
    icon: ShieldX,
    tone: 'bg-red-50 text-red-700 ring-red-50/60 dark:bg-red-400/10 dark:text-red-300 dark:ring-red-400/5',
  },
  suspended: {
    icon: UserX,
    tone: 'bg-amber-50 text-amber-700 ring-amber-50/60 dark:bg-amber-400/10 dark:text-amber-300 dark:ring-amber-400/5',
  },
  unavailable: {
    icon: CloudOff,
    tone: 'bg-surface-muted text-muted-foreground ring-surface-muted/60',
  },
} satisfies Record<AccessGateProps['access'], { icon: LucideIcon; tone: string }>;

/**
 * What a visitor sees instead of a workspace they may not use: an explanation, a way
 * to a workspace they can use (if any) and sign-out. It renders no workspace chrome,
 * navigation or data.
 */
export function AccessGate(props: AccessGateProps) {
  const { access, workspace, retryHref, csrf } = props;
  const { icon: Icon, tone } = icons[access];
  const signOut = <SignOutButton csrf={csrf} variant="outline" />;

  let title: string;
  let description: string;
  let identity: ReactNode = null;
  let primary: ReactNode = null;

  if (props.access === 'forbidden') {
    const { user } = props;
    const alternative = permittedWorkspaces(user).find((other) => other !== workspace);
    title = workspace
      ? `You do not have access to the ${workspaces[workspace].name} workspace`
      : 'No workspace access';
    description = workspace
      ? 'Your account is signed in, but it does not hold the permission this workspace requires. If you need it, ask the store owner or an admin.'
      : 'This account does not have access to the Nilzora workspaces. Sign out and sign in with a staff or moderator account.';
    identity = (
      <p className="text-xs text-muted-foreground">
        Signed in as{' '}
        <span className="font-medium text-foreground">
          <AutoText value={displayName(user)} />
        </span>{' '}
        ({roleLabel(user.role)})
      </p>
    );
    if (alternative) {
      primary = (
        <Link href={WORKSPACE_HOME[alternative]} className={buttonClasses()}>
          Go to the {workspaces[alternative].name} workspace
        </Link>
      );
    }
  } else if (access === 'suspended') {
    title = 'This account is suspended';
    description =
      'Suspended accounts cannot use the Nilzora workspaces. Contact the store owner if you think this is a mistake.';
  } else {
    title = 'We could not confirm your access';
    description =
      'Nilzora could not be reached, so this page is not shown. Check your connection and try again in a moment.';
    // A full reload re-runs every check from scratch.
    primary = (
      <a href={retryHref} className={buttonClasses()}>
        <AutoText>Try again</AutoText>
      </a>
    );
  }

  return (
    <AuthFrame>
      <Card className="nz-panel-strong nz-panel-sheen rounded-2xl">
        <CardContent className="grid justify-items-center gap-4 text-center">
          <span className={cn('grid size-12 place-items-center rounded-full ring-8', tone)}>
            <Icon aria-hidden="true" className="size-5" />
          </span>
          <div className="grid gap-1.5">
            <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
              {title}
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              <AutoText value={description} />
            </p>
          </div>
          {identity}
          <div className="flex flex-wrap items-start justify-center gap-2">
            {primary}
            {signOut}
          </div>
        </CardContent>
      </Card>
    </AuthFrame>
  );
}
