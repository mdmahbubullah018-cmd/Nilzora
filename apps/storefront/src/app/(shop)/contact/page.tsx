import type { PublicStoreProfile } from '@nilzora/contracts';
import { Card } from '@nilzora/ui';
import {
  ArrowRight,
  Clock,
  Mail,
  MapPin,
  MessageCircle,
  Package,
  Phone,
  RotateCcw,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { BrandGlyph } from '@/components/brand/social-icons';
import { PageFrame } from '@/components/checkout/page-parts';
import { socialProfiles, whatsappUrl } from '@/lib/contact-links';
import { formatBdPhone } from '@/lib/format';
import { storeProfile } from '@/lib/seo';

export const metadata: Metadata = {
  // The root layout's template appends the store name, so this reads "Help & support · Nilzora".
  title: 'Help & support',
  description: 'How to get help with an order, a return or a refund at Nilzora.',
};

/** Self-service pages that answer most questions without writing to the store. */
const QUICK_HELP: readonly { href: Route; icon: LucideIcon; title: string; detail: string }[] = [
  {
    href: '/account/orders',
    icon: Package,
    title: 'Track your order',
    detail: 'See where each order is and cancel one that is still pending.',
  },
  {
    href: '/account/returns',
    icon: RotateCcw,
    title: 'Returns and refunds',
    detail: 'Request a return for a delivered order and follow its refund.',
  },
  {
    href: '/account',
    icon: UserRound,
    title: 'Your account',
    detail: 'Update your profile and the addresses you deliver to.',
  },
];

function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

function Channel({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-4 rounded-2xl border border-border/80 bg-surface/80 p-4 sm:p-5">
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
        <Icon aria-hidden="true" className="size-5" strokeWidth={1.75} />
      </span>
      <div className="grid min-w-0 content-center gap-0.5">
        <p className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          {label}
        </p>
        <div className="text-sm font-medium wrap-break-word text-foreground">{children}</div>
      </div>
    </li>
  );
}

function SupportChannels({ profile }: { profile: PublicStoreProfile }) {
  const address = [profile.addressLine, profile.addressArea, profile.addressDistrict]
    .filter((part): part is string => part !== null && part !== '')
    .join(', ');
  const email = profile.supportEmail ?? profile.contactEmail ?? null;
  const phone = profile.supportPhone ?? profile.contactPhone ?? null;
  const social = socialProfiles(profile);
  const whatsapp = whatsappUrl(profile.whatsappNumber);
  const hasChannels =
    email !== null ||
    phone !== null ||
    whatsapp !== null ||
    address !== '' ||
    profile.businessHours !== null;

  if (!hasChannels && social.length === 0) {
    return (
      <p className="text-sm leading-relaxed text-muted-foreground">
        The store has not published contact details yet. Your order confirmations and your account
        pages remain the record of what you bought.
      </p>
    );
  }

  const linkClass = 'underline-offset-4 hover:text-primary hover:underline';
  return (
    <div className="grid gap-4">
      {hasChannels ? (
        <ul role="list" className="grid gap-3 sm:grid-cols-2">
          {phone === null ? null : (
            <Channel icon={Phone} label="Phone">
              <a href={telHref(phone)} className={linkClass}>
                {phone}
              </a>
            </Channel>
          )}
          {whatsapp === null || !profile.whatsappNumber ? null : (
            <Channel icon={MessageCircle} label="WhatsApp">
              <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={linkClass}>
                {formatBdPhone(profile.whatsappNumber)}
                <span className="sr-only"> (opens WhatsApp in a new tab)</span>
              </a>
            </Channel>
          )}
          {email === null ? null : (
            <Channel icon={Mail} label="Email">
              <a href={`mailto:${email}`} className={linkClass}>
                {email}
              </a>
            </Channel>
          )}
          {address === '' ? null : (
            <Channel icon={MapPin} label="Address">
              {address}
            </Channel>
          )}
          {profile.businessHours === null ? null : (
            <Channel icon={Clock} label="Hours">
              {profile.businessHours}
            </Channel>
          )}
        </ul>
      ) : null}
      {social.length > 0 ? (
        <ul role="list" aria-label="The store on social media" className="flex flex-wrap gap-2">
          {social.map(({ glyph, label, href }) => (
            <li key={glyph}>
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm font-medium text-foreground transition-colors hover:border-border-strong hover:bg-surface-muted"
              >
                <BrandGlyph name={glyph} className="size-4" />
                {label}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Help & support. Self-service links first, then the ways to reach the store, taken from the
 * store profile. Nothing is invented: a channel the store has not filled in is simply not shown,
 * and a profile with no contact details at all says so instead of publishing a placeholder.
 */
export default async function ContactPage() {
  const profile = await storeProfile();
  const storeName = profile?.displayName ?? 'Nilzora';

  return (
    <PageFrame>
      <header className="grid gap-3">
        <span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
          <MessageCircle aria-hidden="true" className="size-6" strokeWidth={1.75} />
        </span>
        <h1 className="font-display text-[clamp(1.75rem,1.4rem+1.4vw,2.375rem)] leading-tight font-semibold tracking-tight text-foreground">
          Help & support
        </h1>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground sm:text-base">
          Questions about an order, a return or a refund? Most answers are a click away in your
          account, and here is how to reach {storeName}.
        </p>
      </header>

      <section aria-labelledby="quick-help" className="grid gap-4">
        <h2 id="quick-help" className="font-display text-lg font-semibold text-foreground">
          Quick help
        </h2>
        <ul role="list" className="grid gap-3 sm:grid-cols-3">
          {QUICK_HELP.map(({ href, icon: Icon, title, detail }) => (
            <li key={href}>
              <Link
                href={href}
                className="group grid h-full content-start gap-3 rounded-2xl border border-border/80 bg-surface p-5 shadow-xs transition-[box-shadow,border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                <span className="grid size-10 place-items-center rounded-xl bg-surface-muted text-primary">
                  <Icon aria-hidden="true" className="size-5" strokeWidth={1.75} />
                </span>
                <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  {title}
                  <ArrowRight
                    aria-hidden="true"
                    className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                  />
                </span>
                <span className="text-sm leading-relaxed text-muted-foreground">{detail}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="contact-store" className="grid gap-4">
        <h2 id="contact-store" className="font-display text-lg font-semibold text-foreground">
          Contact {storeName}
        </h2>
        {profile === null ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            The store&apos;s contact details could not be loaded right now. Order and return pages
            in your account stay available, and you can try again in a moment.
          </p>
        ) : (
          <>
            {profile.description === null ? null : (
              <p className="max-w-prose text-sm leading-relaxed text-body">{profile.description}</p>
            )}
            <SupportChannels profile={profile} />
          </>
        )}
      </section>

      <Card className="border-border/80 bg-surface/80 p-5 sm:p-6">
        <h2 className="text-base font-semibold text-foreground">Before you write</h2>
        <ul className="mt-3 grid list-disc gap-2 pl-5 text-sm leading-relaxed text-body marker:text-primary">
          <li>
            An order can be cancelled while it is still waiting for confirmation, from the order
            page in your account.
          </li>
          <li>
            A delivered order can be returned from its page; the request is reviewed before anything
            is sent back.
          </li>
          <li>
            Cash-on-Delivery refunds are handed back by hand, and a refund only counts as paid once
            the store records its reference.
          </li>
        </ul>
      </Card>
    </PageFrame>
  );
}
