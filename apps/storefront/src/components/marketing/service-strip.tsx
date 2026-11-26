'use client';

import type { PublicStoreProfile } from '@nilzora/contracts';
import { buttonClasses, cn, Dialog } from '@nilzora/ui';
import { MessageCircle, RotateCcw, ShieldCheck, Truck, type LucideIcon } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useState } from 'react';

interface Benefit {
  id: 'delivery' | 'checkout' | 'returns' | 'support';
  icon: LucideIcon;
  title: string;
  /** The one-word label a phone shows when the full title would not fit its column. */
  shortTitle?: string;
  /** What the dialog says: only what the store really does, never a time or a guarantee. */
  explanation: readonly string[];
  /** Where the benefit is delivered, when there is a page for it. */
  action?: { href: Route; label: string };
}

/*
 * Each benefit is a claim to customers, so each explanation says only what the project does:
 *
 * - Fast delivery: orders go to the address chosen at checkout, the delivery charge is shown
 *   before the order is placed, payment is cash on delivery, and the order's progress is
 *   visible in the account. No delivery time is promised: times are the store's to state.
 * - Secure checkout: sign-in and ordering use protected, same-origin forms and the server
 *   works out every price and total, so what is paid cannot be changed from the browser. Payment
 *   is cash on delivery, so no card details are asked for.
 * - Easy returns: a delivered order can be returned from the customer's account. No return
 *   period is promised: the window and conditions are the store's own settings.
 * - Customer support: the Help & support page always exists. Opening hours are shown only as the
 *   store itself publishes them; "24/7" is never claimed on the store's behalf.
 *
 * The old threshold-based free-shipping benefit is gone from this strip: checkout always adds
 * the delivery charge, so it was never true to claim it here.
 */
function benefits(profile: PublicStoreProfile | null): Benefit[] {
  const hours = profile?.businessHours?.trim() ?? '';
  return [
    {
      id: 'delivery',
      icon: Truck,
      title: 'Fast Delivery',
      explanation: [
        'Your order is delivered to the address you choose at checkout, and you pay in cash when it arrives.',
        'The delivery charge for your area is shown before you place the order, so there is no surprise at the door.',
        'Follow your order from confirmation to delivery in your account. Delivery times depend on your area and are not fixed in advance.',
      ],
      action: { href: '/account/orders', label: 'Track my orders' },
    },
    {
      id: 'checkout',
      icon: ShieldCheck,
      title: 'Secure Checkout',
      explanation: [
        'Sign-in and ordering are protected, and every price and total is worked out by our server, so what you pay cannot be changed from your browser.',
        'Payment is cash on delivery for now, so we never ask for card or mobile-banking details online.',
      ],
    },
    {
      id: 'returns',
      icon: RotateCcw,
      title: 'Easy Returns',
      explanation: [
        'Once an order has been delivered, you can request a return from your account and follow its progress there.',
        'The store reviews each request. The return period and conditions are set by the store, so check its returns policy before you order.',
      ],
      action: { href: '/account/returns', label: 'Request a return' },
    },
    {
      id: 'support',
      // The same MessageCircle the "Chat with us" launcher uses, for one support language.
      icon: MessageCircle,
      title: 'Customer Support',
      shortTitle: 'Support',
      explanation: [
        'Questions about an order, a delivery or a return? Chat with us or send a message from the Help & support page.',
        ...(hours === '' ? [] : [`Store hours: ${hours}`]),
      ],
      action: { href: '/contact', label: 'Help & support' },
    },
  ];
}

/**
 * The benefits panel: a compact, light glass card that floats over the bottom edge of the hero
 * stage. All four sit in one row at every width, each showing its icon and title; tapping one
 * opens a small sheet that explains it.
 */
export function ServiceStrip({
  profile = null,
  className,
}: {
  profile?: PublicStoreProfile | null;
  className?: string;
}) {
  const items = benefits(profile);
  const [openId, setOpenId] = useState<Benefit['id'] | null>(null);
  const current = items.find((item) => item.id === openId);
  return (
    <section
      aria-label="Shopping with Nilzora"
      className={cn(
        'relative z-10 mx-auto w-full max-w-6xl px-3 max-md:px-1.5 sm:px-6 lg:px-8',
        className,
      )}
    >
      <ul
        role="list"
        // Frosted glass: translucent enough that the navy banner shows through the top of the
        // panel, while the gradient keeps the labels legible over both navy and page white.
        className="relative grid auto-cols-fr grid-flow-col divide-x divide-white/45 overflow-hidden rounded-t-3xl rounded-b-xl border border-white/60 bg-linear-to-b from-white/70 via-white/85 to-white/70 shadow-lg shadow-brand-navy/8 backdrop-blur-xl backdrop-saturate-150 after:pointer-events-none after:absolute after:inset-x-10 after:bottom-0 after:h-px after:bg-linear-to-r after:from-transparent after:via-primary/40 after:to-transparent"
      >
        {items.map(({ id, icon: Icon, title, shortTitle }) => (
          <li key={id} className="min-w-0">
            <button
              type="button"
              aria-haspopup="dialog"
              aria-label={title}
              onClick={() => {
                setOpenId(id);
              }}
              className="group/benefit flex h-full min-h-[3.7rem] w-full cursor-pointer flex-col items-center justify-center gap-0.5 px-1 pt-1 pb-0.5 max-md:min-h-[2.75rem] max-md:gap-px max-md:px-0.5 max-md:pt-0.5 max-md:pb-0.5 transition-colors duration-200 hover:bg-white/70 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary sm:min-h-[3.55rem] sm:flex-row sm:gap-2 sm:px-3 sm:py-0.5"
            >
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-primary ring-[3px] ring-primary/5 max-md:size-5 max-md:ring-2 transition-transform duration-300 ease-soft group-hover/benefit:-translate-y-0.5 motion-reduce:transition-none sm:size-7">
                <Icon
                  aria-hidden="true"
                  className="size-3 max-md:size-2.5 sm:size-3.5"
                  strokeWidth={1.75}
                />
              </span>
              {/* One line on a phone, always: smaller type, no wrapping. */}
              <span
                aria-hidden="true"
                className="text-center text-[0.6875rem] leading-tight font-semibold whitespace-nowrap text-foreground max-md:text-[0.625rem] max-md:leading-none max-md:tracking-tight max-[359px]:text-[0.5625rem]! sm:text-left sm:text-[0.78125rem]"
              >
                {shortTitle === undefined ? (
                  title
                ) : (
                  <>
                    <span className="md:hidden">{shortTitle}</span>
                    <span className="max-md:hidden">{title}</span>
                  </>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Dialog
        open={current !== undefined}
        onOpenChange={(next) => {
          if (!next) setOpenId(null);
        }}
        title={current?.title ?? ''}
        side="bottom"
      >
        {current ? (
          <div className="grid gap-3 text-sm leading-relaxed text-muted-foreground">
            {current.explanation.map((line) => (
              <p key={line}>{line}</p>
            ))}
            {current.action ? (
              <div>
                <Link
                  href={current.action.href}
                  className={buttonClasses({ variant: 'outline', size: 'sm' })}
                  onClick={() => {
                    setOpenId(null);
                  }}
                >
                  {current.action.label}
                </Link>
              </div>
            ) : null}
          </div>
        ) : null}
      </Dialog>
    </section>
  );
}
