import { Card, CardContent, CardFooter, CardHeader } from '@nilzora/ui';
import type { ReactNode } from 'react';

interface AuthCardProps {
  title: ReactNode;
  description?: ReactNode;
  /** Links to the neighbouring pages, e.g. "Create an account". */
  footer?: ReactNode;
  children: ReactNode;
}

/** The card that holds each sign-in, registration and confirmation page. */
export function AuthCard({ title, description, footer, children }: AuthCardProps) {
  return (
    <Card className="overflow-hidden rounded-3xl border-border/70 shadow-xl shadow-brand-navy/5">
      {/* A hairline of the brand across the top: the one decorative colour on the card. */}
      <div
        aria-hidden="true"
        className="h-1 w-full bg-linear-to-r from-brand-sky via-primary to-brand-violet"
      />
      <CardHeader className="gap-1.5 pt-7 sm:px-8 sm:pt-8">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-balance text-foreground sm:text-[1.7rem]">
          {title}
        </h1>
        {description ? (
          <p className="text-sm leading-relaxed text-pretty text-muted-foreground">{description}</p>
        ) : null}
      </CardHeader>
      <CardContent className="sm:px-8">{children}</CardContent>
      {footer ? (
        <CardFooter className="flex-wrap justify-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          {footer}
        </CardFooter>
      ) : null}
    </Card>
  );
}

/** Inline link style for auth page footers and messages. */
export const authLinkClasses =
  'rounded-sm font-semibold text-link underline-offset-4 hover:underline';
