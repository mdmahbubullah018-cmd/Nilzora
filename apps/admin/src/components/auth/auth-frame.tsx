import { Logo } from '@nilzora/ui';
import { Boxes, ShieldCheck, Truck } from 'lucide-react';
import type { ReactNode } from 'react';
import { AutoText } from '@/components/i18n/translate';

const HIGHLIGHTS = [
  {
    icon: Truck,
    title: 'Orders and cash on delivery',
    text: 'Confirm, ship and record collected cash from one queue.',
  },
  {
    icon: Boxes,
    title: 'Catalog, stock and storefront',
    text: 'Products, variants, banners and store details in one place.',
  },
  {
    icon: ShieldCheck,
    title: 'Access by permission',
    text: 'Every teammate sees only the work their role allows.',
  },
] as const;

/**
 * The brand side of the sign-in screens: navy glass with a slow aurora and a few floating
 * glass shapes (decorative, CSS only, still under reduced motion). Wide screens only;
 * phones get the logo above the form instead.
 */
function BrandPanel() {
  return (
    <aside
      aria-hidden="true"
      className="nz-auth-brand relative m-3 hidden overflow-hidden rounded-[1.75rem] p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-14"
    >
      <span className="nz-auth-aurora" />
      <span className="nz-auth-shape nz-auth-shape-a" />
      <span className="nz-auth-shape nz-auth-shape-b" />
      <span className="nz-auth-shape nz-auth-shape-c" />

      <div className="relative">
        <Logo size="md" tone="dark" />
      </div>

      <div className="relative grid max-w-md gap-8">
        <div className="grid gap-3">
          <p className="text-xs font-semibold tracking-[0.18em] text-sky-200/90 uppercase">
            <AutoText>Nilzora workspace</AutoText>
          </p>
          <p className="font-display text-4xl leading-[1.1] font-semibold tracking-tight text-balance xl:text-[2.75rem]">
            <AutoText>Run the store from one calm, focused workspace.</AutoText>
          </p>
        </div>
        <ul className="grid gap-3">
          {HIGHLIGHTS.map(({ icon: Icon, title, text }) => (
            <li
              key={title}
              className="flex gap-3.5 rounded-2xl border border-white/10 bg-white/6 p-4 backdrop-blur-md"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/10 text-sky-200 ring-1 ring-white/15">
                <Icon className="size-5" strokeWidth={1.75} />
              </span>
              <span className="grid gap-0.5">
                <span className="text-sm font-semibold text-white">
                  <AutoText value={title} />
                </span>
                <span className="text-sm text-slate-300">
                  <AutoText value={text} />
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p className="relative text-xs text-slate-400">
        <AutoText>For Nilzora staff and moderators only.</AutoText>
      </p>
    </aside>
  );
}

/**
 * Chrome-free frame for sign-in, password and access notices (no workspace navigation):
 * a brand panel on wide screens and the content on a soft glass canvas beside it.
 */
export function AuthFrame({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <main
      id="main"
      className="nz-app-canvas grid min-h-dvh lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]"
    >
      <BrandPanel />
      <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10 sm:px-8">
        <div className="nz-page-enter grid w-full max-w-md gap-6">
          <div className="flex justify-center lg:hidden">
            <Logo />
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}
