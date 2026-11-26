import type { Permission } from '@nilzora/contracts';
import { buttonClasses, cn } from '@nilzora/ui';
import { CircleAlert, CloudOff, Hourglass, SearchX, ShieldX, type LucideIcon } from 'lucide-react';
import type { Route } from 'next';
import type { ReactNode } from 'react';
import { permissionLabel } from '@/lib/identity';
import { AutoText } from '@/components/i18n/translate';

/* Icon wells: a soft tinted glass circle with a wider halo, in the admin's status tones. */
const tones = {
  danger: 'bg-danger-soft text-danger-ink ring-danger-soft',
  warning: 'bg-warning-soft text-warning-ink ring-warning-soft',
  neutral: 'bg-neutral-soft text-neutral-ink ring-neutral-soft',
} as const;

export interface StateMessageProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** Smaller padding, for a state inside a SectionCard rather than a whole page. */
  compact?: boolean;
  /** The title's element: a heading when the state is the page's only content. */
  titleAs?: 'p' | 'h1' | 'h2';
  className?: string;
}

interface StateFrameProps extends StateMessageProps {
  icon: LucideIcon;
  tone: keyof typeof tones;
  role?: 'alert' | 'status';
}

function StateFrame({
  icon: Icon,
  tone,
  role,
  title,
  description,
  action,
  compact = false,
  titleAs: Title = 'p',
  className,
}: StateFrameProps) {
  return (
    <div
      role={role}
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 text-center',
        compact ? 'py-8' : 'py-14',
        className,
      )}
    >
      <span
        className={cn(
          'nz-float grid size-14 place-items-center rounded-full shadow-glass ring-8',
          tones[tone],
        )}
      >
        <Icon aria-hidden="true" className="size-6" strokeWidth={1.6} />
      </span>
      <div className="grid max-w-md gap-1">
        <Title className="text-sm font-semibold text-foreground"><AutoText value={title} /></Title>
        {description ? (
          <p className="text-sm leading-relaxed text-muted-foreground"><AutoText value={description} /></p>
        ) : null}
      </div>
      {action ? <div className="mt-1 flex flex-wrap justify-center gap-2"><AutoText value={action} /></div> : null}
    </div>
  );
}

/** Something went wrong that retrying will not fix by itself (e.g. a refused request). */
export function ErrorState({
  title = 'Something went wrong',
  description = 'This could not be shown. Try again, and if it keeps happening, let an admin know.',
  ...props
}: Partial<StateMessageProps>) {
  return (
    <StateFrame
      icon={CircleAlert}
      tone="danger"
      role="alert"
      title={title}
      description={description}
      {...props}
    />
  );
}

export interface UnavailableStateProps extends Partial<StateMessageProps> {
  /** The page to reload; a full reload repeats every check from scratch. */
  retryHref?: Route;
}

/** The API could not be reached or failed: nothing is shown rather than stale or made-up data. */
export function UnavailableState({
  title = 'This information is unavailable right now',
  description = 'Nilzora could not be reached. Check your connection and try again in a moment.',
  retryHref,
  action,
  ...props
}: UnavailableStateProps) {
  const retry = retryHref ? (
    <a href={retryHref} className={buttonClasses({ variant: 'outline', size: 'sm' })}><AutoText>Try again</AutoText></a>
  ) : undefined;
  return (
    <StateFrame
      icon={CloudOff}
      tone="neutral"
      role="status"
      title={title}
      description={description}
      action={action ?? retry}
      {...props}
    />
  );
}

export interface ForbiddenStateProps extends Partial<StateMessageProps> {
  /** The permission the content needs, named in the explanation. */
  permission?: Permission;
}

/** The account may use the workspace but not this content; the API refused or would refuse it. */
export function ForbiddenState({
  title = 'You do not have access to this',
  permission,
  description,
  ...props
}: ForbiddenStateProps) {
  const explanation = permission
    ? `This needs the “${permissionLabel(permission)}” permission. Ask the store owner or an admin if you need it.`
    : 'Your account does not hold the permission this needs. Ask the store owner or an admin if you need it.';
  return (
    <StateFrame
      icon={ShieldX}
      tone="warning"
      role="status"
      title={title}
      description={description ?? explanation}
      {...props}
    />
  );
}

/** A record that does not exist, or that this account may not see (the API answers the same). */
export function NotFoundState({
  title = 'Not found',
  description = 'This record does not exist or is no longer available.',
  ...props
}: Partial<StateMessageProps>) {
  return (
    <StateFrame icon={SearchX} tone="neutral" title={title} description={description} {...props} />
  );
}

export interface RateLimitedStateProps extends Partial<StateMessageProps> {
  /** The page to reload once the limit has passed. */
  retryHref?: Route;
}

/** The API refused the request because too many were made (429); waiting fixes it. */
export function RateLimitedState({
  title = 'Too many requests',
  description = 'Too many requests were made in a short time. Wait a moment, then try again.',
  retryHref,
  action,
  ...props
}: RateLimitedStateProps) {
  const retry = retryHref ? (
    <a href={retryHref} className={buttonClasses({ variant: 'outline', size: 'sm' })}><AutoText>Try again</AutoText></a>
  ) : undefined;
  return (
    <StateFrame
      icon={Hourglass}
      tone="warning"
      role="status"
      title={title}
      description={description}
      action={action ?? retry}
      {...props}
    />
  );
}

/** Why a read produced nothing to show (AdminRead's kinds other than ok and signed_out). */
export type ReadFailure = 'unavailable' | 'rate_limited' | 'forbidden' | 'not_found' | 'invalid';

export interface ReadStateProps {
  failure: ReadFailure;
  /** For `unavailable` and `rate_limited`: the page to reload. */
  retryHref?: Route;
  /** For `forbidden`: the permission the content needs. */
  permission?: Permission;
  /** For `invalid`: the address without the refused filters. */
  resetHref?: Route;
  compact?: boolean;
  titleAs?: StateMessageProps['titleAs'];
  className?: string;
}

/** The state for a failed adminRead(), so every page explains failures the same way. */
export function ReadState({
  failure,
  retryHref,
  permission,
  resetHref,
  compact,
  titleAs,
  className,
}: ReadStateProps) {
  const shared = { compact, titleAs, className };
  switch (failure) {
    case 'unavailable':
      return <UnavailableState retryHref={retryHref} {...shared} />;
    case 'rate_limited':
      return <RateLimitedState retryHref={retryHref} {...shared} />;
    case 'forbidden':
      return <ForbiddenState permission={permission} {...shared} />;
    case 'not_found':
      return <NotFoundState {...shared} />;
    case 'invalid':
      return (
        <ErrorState
          title="These filters could not be applied"
          description="Some of the options in the address are not valid. Clear them and try again."
          action={
            resetHref ? (
              <a href={resetHref} className={buttonClasses({ variant: 'outline', size: 'sm' })}><AutoText>Clear filters</AutoText></a>
            ) : undefined
          }
          {...shared}
        />
      );
  }
}
