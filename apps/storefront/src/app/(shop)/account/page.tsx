import {
  Alert,
  Badge,
  buttonClasses,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
} from '@nilzora/ui';
import { CSRF_FIELD, type SessionUser } from '@nilzora/web-session';
import {
  ChevronRight,
  CloudOff,
  Heart,
  MapPin,
  MessageCircle,
  Pencil,
  Ticket,
  Package,
  RotateCw,
  type LucideIcon,
} from 'lucide-react';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AvatarForm } from '@/components/account/avatar-form';
import { ProfileForm } from '@/components/account/profile-form';
import { SignOutForm } from '@/components/account/sign-out-form';
import type { CsrfField } from '@/components/auth/form-kit';
import { signOutAction, updateProfileAction } from '@/lib/auth-actions';
import { formatBdPhone, formatLongDate } from '@/lib/format';
import { session } from '@/lib/session';
import type { ReviewableItem } from '@nilzora/contracts';
import { ReviewPrompt } from '@/components/product/review-prompt';
import { dismissReviewPromptAction } from '@/lib/review-actions';

export const metadata: Metadata = {
  title: 'Your account',
  robots: { index: false, follow: false },
};

function AccountFrame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      {children}
    </div>
  );
}

function Detail({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{term}</dt>
      <dd className="text-sm font-medium wrap-break-word text-foreground">{children}</dd>
    </div>
  );
}

function NotAdded() {
  return <span className="font-normal text-muted-foreground">Not added</span>;
}

/** A compact tile to another part of the account: icon, name, and why it is worth opening. */
function AccountLink({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: Route;
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3.5 rounded-2xl border border-border/80 bg-surface p-4 transition-colors duration-200 hover:border-primary/45 hover:bg-[#F4FAFF] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/8 text-primary ring-1 ring-primary/15 transition-colors duration-200 group-hover:bg-primary/12 motion-reduce:transition-none">
        <Icon aria-hidden="true" className="size-5" strokeWidth={1.75} />
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">
          {description}
        </span>
      </span>
      <ChevronRight
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-primary motion-reduce:transition-none"
      />
    </Link>
  );
}

/** A heading over one group of account tiles. */
function GroupHeading({ children }: { children: string }) {
  return (
    <h2 className="px-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
      {children}
    </h2>
  );
}

/** Up to two initials from the name (or the email address), for an account without a picture. */
function initialsOf(user: SessionUser): string {
  return (user.profile.fullName ?? user.email ?? 'N')
    .split(/[s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function wishlistDescription(count: number | null): string {
  if (count === null) return 'Products you save for later appear here.';
  if (count === 0) return 'Nothing saved yet — tap the heart on any product.';
  return `${String(count)} ${count === 1 ? 'product' : 'products'} saved for later.`;
}

function SignedInAccount({
  user,
  csrf,
  wishlistCount,
  reviewPrompt,
}: {
  user: SessionUser;
  csrf: CsrfField;
  /** The saved count read on the server, or null when it could not be read. */
  wishlistCount: number | null;
  /** One delivered product to ask about, as the server chose it; null for none. */
  reviewPrompt: ReviewableItem | null;
}) {
  const { profile } = user;
  return (
    <AccountFrame>
      {reviewPrompt === null ? null : (
        <ReviewPrompt item={reviewPrompt} csrf={csrf} dismissAction={dismissReviewPromptAction} />
      )}
      {/*
        The profile header: a pale blue card rather than the navy panel it used to be. It keeps
        the avatar, the name and the two facts a customer usually looks for, and adds the way to
        change them — the navy is left to the words, which is what keeps the account bright.
      */}
      <section
        aria-labelledby="account-heading"
        className="relative isolate overflow-hidden rounded-3xl border border-brand-sky/35 bg-linear-to-br from-[#F4FAFF] via-[#EAF5FF] to-[#DFF0FF] px-5 py-6 shadow-sm shadow-brand-navy/5 sm:px-8 sm:py-8"
      >
        <div className="flex flex-wrap items-center gap-4 sm:gap-5">
          <span
            aria-hidden="true"
            className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-full bg-surface font-display text-lg font-semibold text-primary-action ring-2 ring-primary/25 sm:size-20 sm:text-xl"
          >
            {/* An upload wins; otherwise the picture Google supplied; otherwise the initials. */}
            {profile.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element -- already-optimised WebP from the media service
              <img src={profile.avatar.thumbUrl} alt="" className="size-full object-cover" />
            ) : profile.googleAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element -- Google's own picture host
              <img src={profile.googleAvatar} alt="" className="size-full object-cover" />
            ) : (
              initialsOf(user)
            )}
          </span>
          <div className="grid min-w-0 flex-1 gap-1">
            {/* Display only: the API decides what any account may do. */}
            {user.role === 'customer' ? null : (
              <Badge tone="violet" className="justify-self-start">
                Staff account
              </Badge>
            )}
            <h1
              id="account-heading"
              className="font-display text-xl font-semibold tracking-tight wrap-break-word text-brand-navy sm:text-2xl"
            >
              {profile.fullName ?? 'Your account'}
            </h1>
            <p className="truncate text-sm text-body">{user.email ?? 'Your Nilzora account.'}</p>
          </div>
          <a
            href="#edit-profile"
            className="order-last inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full border border-brand-sky/60 bg-surface px-4 text-sm font-semibold text-link transition-colors hover:border-primary/60 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none sm:order-0 sm:w-auto"
          >
            <Pencil aria-hidden="true" className="size-4" />
            Edit profile
          </a>
        </div>
        {/* The two facts a customer is usually looking for, without opening the profile card. */}
        <dl className="mt-5 flex flex-wrap gap-x-10 gap-y-3 border-t border-brand-sky/30 pt-4">
          {profile.phone ? (
            <div className="grid gap-0.5">
              <dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                Phone
              </dt>
              <dd className="text-sm font-medium text-foreground tabular-nums">
                {formatBdPhone(profile.phone)}
              </dd>
            </div>
          ) : null}
          <div className="grid gap-0.5">
            <dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              Member since
            </dt>
            <dd className="text-sm font-medium text-foreground">
              <time dateTime={profile.createdAt}>{formatLongDate(profile.createdAt)}</time>
            </dd>
          </div>
        </dl>
      </section>

      {/*
        The account's own navigation, in one landmark: the group heading names the block for a
        reader, and the tiles stay grouped by what a shopper actually does here.
      */}
      <nav aria-label="Shopping" className="grid gap-3">
        <GroupHeading>Your shopping</GroupHeading>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <AccountLink
            href="/account/orders"
            icon={Package}
            title="Your orders"
            description="Follow deliveries and view receipts."
          />
          <AccountLink
            href="/wishlist"
            icon={Heart}
            title="My wishlist"
            description={wishlistDescription(wishlistCount)}
          />
          <AccountLink
            href="/account/addresses"
            icon={MapPin}
            title="Addresses"
            description="Manage where we deliver your orders."
          />
          <AccountLink
            href="/account/vouchers"
            icon={Ticket}
            title="My Vouchers"
            description="Vouchers you collected, ready to use at checkout."
          />
          <AccountLink
            href="/account/returns"
            icon={RotateCw}
            title="Returns"
            description="Send something back and follow the refund."
          />
          <AccountLink
            href="/account/support"
            icon={MessageCircle}
            title="Support"
            description="Your conversations with our team."
          />
        </div>
      </nav>

      <div
        aria-labelledby="account-details-heading"
        className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start"
      >
        <Card>
          <CardHeader>
            <CardTitle as="h2" id="account-details-heading">
              Profile
            </CardTitle>
            <CardDescription>Your saved details.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4">
              <Detail term="Name">{profile.fullName ?? <NotAdded />}</Detail>
              <Detail term="Email">{user.email ?? <NotAdded />}</Detail>
              <Detail term="Mobile phone">
                {profile.phone ? formatBdPhone(profile.phone) : <NotAdded />}
              </Detail>
              <Detail term="Member since">
                <time dateTime={profile.createdAt}>{formatLongDate(profile.createdAt)}</time>
              </Detail>
            </dl>
          </CardContent>
        </Card>

        <Card id="edit-profile" className="scroll-mt-20">
          <CardHeader>
            <CardTitle as="h2">Edit profile</CardTitle>
            <CardDescription>
              We use your name and number for deliveries. Your email address cannot be changed here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProfileForm
              action={updateProfileAction}
              csrf={csrf}
              initial={{
                fullName: profile.fullName ?? '',
                phone: profile.phone ? formatBdPhone(profile.phone) : '',
              }}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Profile picture</CardTitle>
          <CardDescription>Shown on your account. Only you can change it.</CardDescription>
        </CardHeader>
        <CardContent>
          <AvatarForm
            csrf={csrf}
            avatarUrl={profile.avatar?.thumbUrl ?? null}
            googleAvatarUrl={profile.googleAvatar}
            initials={initialsOf(user)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="grid gap-1">
            <h2 className="text-base font-semibold text-foreground">Sign out</h2>
            <p className="text-sm text-muted-foreground">
              End your session on this device. You can sign in again at any time.
            </p>
          </div>
          <SignOutForm action={signOutAction} csrf={csrf} />
        </CardContent>
      </Card>
    </AccountFrame>
  );
}

export default async function AccountPage() {
  // Checked here, not in a layout: layouts do not re-run on client navigation.
  const current = await session.getSession();
  if (current.status === 'signed_out') redirect('/login?next=/account');

  const [csrfToken, wishlist, prompt] = await Promise.all([
    session.csrfToken(),
    current.status === 'signed_in'
      ? session.read((api, accessToken) => api.myWishlist(accessToken))
      : null,
    // The review prompt is an extra: any failure simply shows none.
    current.status === 'signed_in'
      ? session.read((api, accessToken) => api.reviewPrompt(accessToken)).catch(() => null)
      : null,
  ]);
  const csrf: CsrfField = { name: CSRF_FIELD, token: csrfToken };

  if (current.status === 'signed_in') {
    return (
      <SignedInAccount
        user={current.user}
        csrf={csrf}
        wishlistCount={wishlist?.kind === 'ok' ? wishlist.value.items.length : null}
        reviewPrompt={prompt?.kind === 'ok' ? (prompt.value.item ?? null) : null}
      />
    );
  }

  if (current.status === 'suspended') {
    return (
      <AccountFrame>
        <PageHeader title="Your account" />
        <Card>
          <CardContent className="grid gap-5">
            <Alert tone="warning" title="This account is suspended">
              You cannot shop or change your details while the account is suspended. Contact Nilzora
              support for help.
            </Alert>
            <SignOutForm action={signOutAction} csrf={csrf} />
          </CardContent>
        </Card>
      </AccountFrame>
    );
  }

  // The API could not be reached: the visitor is neither confirmed nor refused.
  return (
    <AccountFrame>
      <PageHeader title="Your account" />
      <Card>
        <EmptyState
          icon={CloudOff}
          title="We could not load your account"
          description="Nilzora could not be reached. Please try again in a moment."
          className="py-14"
          action={
            <Link href="/account" className={buttonClasses({ variant: 'outline' })}>
              <RotateCw aria-hidden="true" />
              Try again
            </Link>
          }
        />
      </Card>
      <Card>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            On a shared device? You can still sign out: this device forgets the session either way.
          </p>
          <SignOutForm action={signOutAction} csrf={csrf} />
        </CardContent>
      </Card>
    </AccountFrame>
  );
}
