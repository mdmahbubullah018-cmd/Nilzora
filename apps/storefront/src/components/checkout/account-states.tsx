import { Alert, buttonClasses, Card, CardContent, EmptyState } from '@nilzora/ui';
import { CloudOff, RotateCw } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';

/*
 * The states an account or checkout page shows when it cannot show its content: the
 * API could not be reached, or the account is suspended.
 */

export function UnavailableState<T extends string>({
  title,
  retryHref,
}: {
  /** e.g. "We could not load your orders". */
  title: string;
  /** Generic like Link's href, so it accepts paths of dynamic routes too. */
  retryHref: Route<T>;
}) {
  return (
    <Card>
      <EmptyState
        icon={CloudOff}
        title={title}
        description="Nilzora could not be reached. Please try again in a moment."
        className="py-14"
        action={
          <Link href={retryHref} className={buttonClasses({ variant: 'outline' })}>
            <RotateCw aria-hidden="true" />
            Try again
          </Link>
        }
      />
    </Card>
  );
}

export function SuspendedState() {
  return (
    <Card>
      <CardContent>
        <Alert tone="warning" title="This account is suspended">
          You cannot shop or change your details while the account is suspended. Contact Nilzora
          support for help.
        </Alert>
      </CardContent>
    </Card>
  );
}
