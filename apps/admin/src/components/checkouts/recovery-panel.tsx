'use client';

import type {
  CheckoutDetail,
  CheckoutRecoveryChannel,
  CheckoutRecoveryState,
} from '@nilzora/contracts';
import { NativeSelect, Textarea } from '@nilzora/ui';
import { Copy, Link2, Unlink } from 'lucide-react';
import { useActionState, useState } from 'react';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { SubmitButton } from '@/components/admin-kit/submit-button';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { AutoText } from '@/components/i18n/translate';
import {
  createCheckoutRecoveryLinkAction,
  recordCheckoutAttemptAction,
  revokeCheckoutRecoveryLinkAction,
  setCheckoutRecoveryStateAction,
} from '@/lib/checkout-recovery-actions';

/*
 * The three things staff can actually do about an abandoned checkout.
 *
 * None of them sends a message: this project has no messaging integration, so a contact is
 * something a human did and then recorded. The recovery link is the only thing Nilzora
 * produces, and it is shown once, because only its hash is stored.
 */

const CHANNELS: { value: CheckoutRecoveryChannel; label: string }[] = [
  { value: 'call', label: 'Phone call' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'sms', label: 'SMS' },
  { value: 'email', label: 'Email' },
  { value: 'in_person', label: 'In person' },
  { value: 'other', label: 'Other' },
];

const STATES: { value: CheckoutRecoveryState; label: string }[] = [
  { value: 'open', label: 'Open again' },
  { value: 'contacted', label: 'Mark contacted' },
  { value: 'dismissed', label: 'Dismiss' },
];

interface Props {
  checkout: CheckoutDetail;
  csrf: CsrfInput;
  storefrontUrl: string;
  canAct: boolean;
}

function Hidden({ checkoutId, csrf }: { checkoutId: string; csrf: CsrfInput }) {
  return (
    <>
      <CsrfField csrf={csrf} />
      <input type="hidden" name="checkoutId" value={checkoutId} />
    </>
  );
}

/** The one-time link, with a copy button: it is never shown again after this render. */
function LinkOnce({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid gap-2 rounded-xl border border-link/40 bg-link/5 p-3">
      <p className="text-xs font-semibold text-foreground">
        <AutoText>Copy this link now. It is shown once and cannot be retrieved later.</AutoText>
      </p>
      <code className="break-all font-mono text-xs text-foreground">{url}</code>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-hairline px-3 text-xs font-semibold text-foreground"
          onClick={() => {
            void navigator.clipboard.writeText(url).then(() => {
              setCopied(true);
            });
          }}
        >
          <Copy aria-hidden="true" className="size-3.5" />
          <AutoText>{copied ? 'Copied' : 'Copy link'}</AutoText>
        </button>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-9 items-center rounded-lg border border-hairline px-3 text-xs font-semibold text-foreground"
        >
          <AutoText>Open to check</AutoText>
        </a>
      </div>
    </div>
  );
}

export function CheckoutRecoveryPanel({ checkout, csrf, storefrontUrl, canAct }: Props) {
  const [attemptState, attempt] = useActionState(recordCheckoutAttemptAction, IDLE_STATE);
  const [stateState, setState] = useActionState(setCheckoutRecoveryStateAction, IDLE_STATE);
  const [linkState, makeLink] = useActionState(createCheckoutRecoveryLinkAction, IDLE_STATE);
  const [revokeState, revokeLink] = useActionState(revokeCheckoutRecoveryLinkAction, IDLE_STATE);

  const converted = checkout.status === 'converted';
  // The server decided whether the link is usable; the browser only checks that it exists and
  // that it has not been used or replaced, so no clock is read during render.
  const linkUsable =
    checkout.link !== null && checkout.link.usedAt === null && checkout.link.revokedAt === null;

  if (!canAct) {
    return (
      <p className="text-sm text-muted-foreground">
        <AutoText>
          Contacting customers and creating recovery links needs the “Recover checkouts” permission.
        </AutoText>
      </p>
    );
  }

  return (
    <div className="grid gap-5">
      <form action={attempt} className="grid gap-3">
        <Hidden checkoutId={checkout.id} csrf={csrf} />
        <label className="grid gap-1 text-sm font-semibold text-foreground" htmlFor="channel">
          <AutoText>How the customer was contacted</AutoText>
          <NativeSelect id="channel" name="channel" defaultValue="call">
            {CHANNELS.map((channel) => (
              <option key={channel.value} value={channel.value}>
                {channel.label}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="grid gap-1 text-sm font-semibold text-foreground" htmlFor="note">
          <AutoText>What was said (optional)</AutoText>
          <Textarea
            id="note"
            name="note"
            rows={2}
            maxLength={500}
            placeholder="Left a voicemail; will try again after 6pm."
          />
        </label>
        <SubmitButton size="sm" className="w-fit" pendingLabel="Recording…">
          <AutoText>Record contact attempt</AutoText>
        </SubmitButton>
        <ActionFeedback state={attemptState} inline />
      </form>

      <div className="grid gap-2 border-t border-hairline pt-4">
        <p className="text-sm font-semibold text-foreground">
          <AutoText>Recovery status</AutoText>
        </p>
        <div className="flex flex-wrap gap-2">
          {STATES.map((option) => (
            <form action={setState} key={option.value}>
              <Hidden checkoutId={checkout.id} csrf={csrf} />
              <input type="hidden" name="state" value={option.value} />
              <SubmitButton
                variant="outline"
                size="sm"
                pendingLabel="Saving…"
                disabled={
                  (converted && option.value === 'dismissed') ||
                  checkout.recoveryState === option.value
                }
              >
                <AutoText>{option.label}</AutoText>
              </SubmitButton>
            </form>
          ))}
        </div>
        <ActionFeedback state={stateState} inline />
      </div>

      <div className="grid gap-2 border-t border-hairline pt-4">
        <p className="text-sm font-semibold text-foreground">
          <AutoText>Recovery link</AutoText>
        </p>
        <p className="text-xs text-muted-foreground">
          {converted ? (
            <AutoText>This checkout became an order, so there is nothing left to recover.</AutoText>
          ) : linkUsable ? (
            <>
              <AutoText>An unused link is live until</AutoText>{' '}
              {new Date(checkout.link?.expiresAt ?? '').toLocaleString()}.{' '}
              <AutoText>It restores this customer’s cart, and only for this customer.</AutoText>
            </>
          ) : (
            <AutoText>
              A link restores this customer’s cart for 72 hours. Only the customer who owns this
              checkout can use it, and it works once.
            </AutoText>
          )}
        </p>
        {converted ? null : (
          <div className="flex flex-wrap gap-2">
            <form action={makeLink}>
              <Hidden checkoutId={checkout.id} csrf={csrf} />
              <input type="hidden" name="storefrontUrl" value={storefrontUrl} />
              <SubmitButton size="sm" pendingLabel="Creating…">
                <Link2 aria-hidden="true" />
                <AutoText>{linkUsable ? 'Replace the link' : 'Create a link'}</AutoText>
              </SubmitButton>
            </form>
            {linkUsable ? (
              <form action={revokeLink}>
                <Hidden checkoutId={checkout.id} csrf={csrf} />
                <SubmitButton variant="outline" size="sm" pendingLabel="Revoking…">
                  <Unlink aria-hidden="true" />
                  <AutoText>Revoke</AutoText>
                </SubmitButton>
              </form>
            ) : null}
          </div>
        )}
        <ActionFeedback state={linkState} inline />
        {linkState.status === 'success' ? <LinkOnce url={linkState.message ?? ''} /> : null}
        <ActionFeedback state={revokeState} inline />
      </div>

      <div className="grid gap-2 border-t border-hairline pt-4">
        <p className="text-sm font-semibold text-foreground">
          <AutoText>Contact history</AutoText>
        </p>
        {checkout.attempts.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            <AutoText>Nobody has recorded a contact attempt yet.</AutoText>
          </p>
        ) : (
          <ol className="grid gap-2">
            {checkout.attempts.map((attempt) => (
              <li key={attempt.id} className="rounded-lg border border-hairline p-2.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-foreground">
                    {CHANNELS.find((channel) => channel.value === attempt.channel)?.label ??
                      attempt.channel}
                  </span>
                  <span className="text-muted-foreground">
                    {new Date(attempt.createdAt).toLocaleString()}
                  </span>
                </div>
                {attempt.note ? <p className="mt-1 text-foreground">{attempt.note}</p> : null}
                {attempt.adminName ? (
                  <p className="mt-1 text-muted-foreground">
                    <AutoText>by</AutoText> {attempt.adminName}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
