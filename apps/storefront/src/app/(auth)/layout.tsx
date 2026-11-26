import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AuthIllustration, AuthIllustrationStrip } from '@/components/auth/auth-illustration';
import { NilzoraLogo } from '@/components/brand/nilzora-logo';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Sign-in, registration and the other account-access pages: a focused split screen without the
 * shop header. The form is always the primary column; the shopping illustration sits beside it
 * from `lg` and shrinks to a slim decorative band above the form on phones and tablets.
 *
 * Both sides are light: a white form column on the soft page, and a pale blue panel carrying the
 * illustration beside it. The navy that used to fill the aside is now only in the words, so the
 * page reads as one bright, premium surface — the same direction the native sign-in screens
 * follow, which is what keeps the two platforms one product.
 */
export default function AuthLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="grid min-h-dvh bg-surface-muted lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="relative flex min-h-dvh flex-col overflow-hidden bg-surface">
        {/* One soft sky bloom behind the form: light, and never a coloured panel. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-56 left-1/2 size-136 -translate-x-1/2 rounded-full bg-brand-sky/10 blur-3xl"
        />

        {/* Phones and tablets: the brand above the form, on a pale blue band that fades into the page. */}
        <header className="relative border-b border-brand-sky/25 bg-linear-to-b from-[#EFF8FF] to-surface px-4 pt-8 pb-10 lg:hidden">
          <div className="relative grid justify-items-center gap-5">
            <Link href="/" aria-label="Nilzora home" className="rounded-md">
              <NilzoraLogo decorative priority className="h-9" />
            </Link>
            <AuthIllustrationStrip />
          </div>
        </header>

        {/* Desktop: the logo above the form. */}
        <header className="relative hidden px-10 pt-10 lg:block xl:px-16">
          <Link href="/" aria-label="Nilzora home" className="inline-block rounded-md">
            <NilzoraLogo decorative priority className="h-9" />
          </Link>
        </header>

        <main
          id="main"
          className="relative -mt-6 flex flex-1 items-start justify-center px-4 pb-10 lg:mt-0 lg:items-center lg:py-10"
        >
          <div className="w-full max-w-md motion-safe:animate-settle">{children}</div>
        </main>
      </div>

      <aside className="relative hidden overflow-hidden border-l border-brand-sky/40 bg-linear-to-b from-[#E8F4FF] via-[#DFF0FF] to-[#D3E9FD] lg:flex lg:flex-col lg:items-center lg:justify-center lg:gap-10 lg:p-12 xl:p-16">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(var(--nz-color-sky)_1px,transparent_1px)] bg-size-[22px_22px] opacity-35"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-32 -left-24 size-104 rounded-full bg-white/75 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-32 -bottom-40 size-120 rounded-full bg-brand-violet/12 blur-3xl motion-safe:animate-drift motion-safe:[animation-delay:-11s]"
        />
        <AuthIllustration className="relative motion-safe:animate-rise motion-safe:[animation-delay:120ms]" />
        <div className="relative grid max-w-md gap-3 text-center motion-safe:animate-settle motion-safe:[animation-delay:200ms]">
          <p className="font-display text-3xl leading-tight font-semibold tracking-tight text-balance text-brand-navy xl:text-4xl">
            Shop with ease, <span className="text-primary">pay on delivery.</span>
          </p>
          <p className="text-sm leading-relaxed text-pretty text-body">
            Sign in to follow your orders, request returns and check out with your saved addresses.
          </p>
        </div>
      </aside>
    </div>
  );
}
