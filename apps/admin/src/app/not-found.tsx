import { buttonClasses } from '@nilzora/ui';
import { Compass } from 'lucide-react';
import Link from 'next/link';
import { AuthFrame } from '@/components/auth/auth-frame';
import { AutoText } from '@/components/i18n/translate';

/**
 * Not found (404). Shown without workspace chrome: whoever reaches it may not be signed
 * in, so it carries no account data. The root sends each visitor on to sign-in or to the
 * workspace they may use.
 */
export default function NotFound() {
  return (
    <AuthFrame>
      <div className="nz-panel-strong nz-panel-sheen grid justify-items-center gap-4 rounded-2xl border p-6 text-center sm:p-8">
        <span className="nz-float grid size-14 place-items-center rounded-full bg-info-soft text-info-ink shadow-glass ring-8 ring-info-soft">
          <Compass aria-hidden="true" className="size-6" strokeWidth={1.6} />
        </span>
        <p
          aria-hidden="true"
          className="bg-linear-to-br from-primary to-brand-violet bg-clip-text font-display text-6xl font-semibold tracking-tight text-transparent"
        >
          404
        </p>
        <div className="grid gap-1.5">
          <h1 className="font-display text-xl font-semibold tracking-tight text-foreground"><AutoText>Page not found</AutoText></h1>
          <p className="text-sm leading-relaxed text-muted-foreground"><AutoText>This page does not exist, or the link you followed is out of date.</AutoText></p>
        </div>
        <Link href="/" className={buttonClasses({ className: 'rounded-xl' })}><AutoText>Go to your workspace</AutoText></Link>
      </div>
    </AuthFrame>
  );
}
