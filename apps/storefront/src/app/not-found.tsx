import { buttonClasses, EmptyState, Logo } from '@nilzora/ui';
import { Compass } from 'lucide-react';
import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-surface-muted px-4">
      <div className="grid justify-items-center gap-4">
        <Logo />
        <EmptyState
          icon={Compass}
          title="Page not found"
          description="The page you are looking for does not exist or has moved."
          action={
            <Link href="/" className={buttonClasses()}>
              Back to the home page
            </Link>
          }
        />
      </div>
    </main>
  );
}
