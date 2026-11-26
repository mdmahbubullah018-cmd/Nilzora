'use client';

import { Button, buttonClasses, Card, EmptyState } from '@nilzora/ui';
import { RotateCw, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { CatalogPage } from './catalog-page';

/**
 * Error boundary content for catalog routes (their error.tsx files). Outages already
 * show a calm notice inside the page; this is for anything unexpected. It never shows
 * the error's message, which in development can contain server details.
 */
export function CatalogError({ retry }: { retry: () => void }) {
  return (
    <CatalogPage>
      <Card>
        <EmptyState
          icon={TriangleAlert}
          titleAs="h1"
          title="Something went wrong"
          description="This page could not be shown. Please try again, or go back to the home page."
          className="py-16"
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <Button variant="outline" onClick={() => retry()}>
                <RotateCw aria-hidden="true" />
                Try again
              </Button>
              <Link href="/" className={buttonClasses({ variant: 'ghost' })}>
                Back to the home page
              </Link>
            </div>
          }
        />
      </Card>
    </CatalogPage>
  );
}
