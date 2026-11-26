'use client';

import { BROADCAST_BODY_MAX, BROADCAST_TITLE_MAX, type PushSettings } from '@nilzora/contracts';
import { Button, Field, Input, NativeSelect, Textarea } from '@nilzora/ui';
import { Send, Smartphone } from 'lucide-react';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { MediaKeyField } from '@/components/media/media-key-field';
import { savePushSettingsAction, sendBroadcastAction } from '@/lib/broadcast-actions';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

function SendButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      {pending ? null : <Send aria-hidden="true" />}
      Send broadcast
    </Button>
  );
}

/**
 * The composer with a live preview of the notification as a phone shows it. Nothing is sent
 * from the browser: the server queues the broadcast and the worker delivers it.
 */
export function BroadcastForm({
  csrf,
  products,
}: {
  csrf: CsrfInput;
  products: readonly { id: string; name: string }[];
}) {
  const tx = useTx();
  const [state, action] = useActionState(sendBroadcastAction, IDLE_STATE);
  const [title, setTitle] = useState(state.values?.title ?? '');
  const [body, setBody] = useState(state.values?.body ?? '');
  const errors = state.fieldErrors;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <form action={action} className="grid gap-4">
        <CsrfField csrf={csrf} />
        <Field
          id="broadcast-title"
          label={tx('Title')}
          hint={`${String(title.length)} of ${String(BROADCAST_TITLE_MAX)} characters`}
          error={errors?.title}
          required
        >
          {(control) => (
            <Input
              {...control}
              name="title"
              maxLength={BROADCAST_TITLE_MAX}
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
              placeholder={tx('e.g. Eid sale starts today')}
            />
          )}
        </Field>
        <Field
          id="broadcast-body"
          label={tx('Message')}
          hint={`${String(body.length)} of ${String(BROADCAST_BODY_MAX)} characters`}
          error={errors?.body}
          required
        >
          {(control) => (
            <Textarea
              {...control}
              name="body"
              rows={3}
              maxLength={BROADCAST_BODY_MAX}
              value={body}
              onChange={(event) => {
                setBody(event.target.value);
              }}
              placeholder={tx('e.g. Up to 30% off panjabi and sarees until Sunday.')}
            />
          )}
        </Field>
        <Field
          id="broadcast-product"
          label={tx('Opens (optional)')}
          hint={tx(
            'A product on sale that the app opens when the notification is tapped. Otherwise it opens the app.',
          )}
          error={errors?.productId}
        >
          {(control) => (
            <NativeSelect
              {...control}
              name="productId"
              defaultValue={state.values?.productId ?? ''}
            >
              <option value="">
                <AutoText>The app’s home screen</AutoText>
              </option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field
          id="broadcast-link"
          label={tx('Or open a page (optional)')}
          hint={tx(
            'A store page the app opens when tapped, instead of a product: /categories/fashion, /wishlist, /vouchers, /brands, /categories or /. A chosen product above wins.',
          )}
          error={errors?.linkPath}
        >
          {(control) => (
            <Input
              {...control}
              name="linkPath"
              spellCheck={false}
              maxLength={200}
              placeholder="/categories/fashion"
              defaultValue={state.values?.linkPath ?? ''}
            />
          )}
        </Field>
        <MediaKeyField
          name="imageKey"
          label={tx('Picture (optional)')}
          hint={tx('Shown large under the message on Android. Leave empty for text only.')}
          defaultValue={state.values?.imageKey || null}
          csrf={csrf}
        />
        <Field
          id="broadcast-schedule"
          label={tx('Send at (optional, Bangladesh time)')}
          hint={tx('Leave empty to send now. Up to 30 days ahead.')}
          error={errors?.scheduledFor}
        >
          {(control) => (
            <Input
              {...control}
              name="scheduledFor"
              type="datetime-local"
              defaultValue={state.values?.scheduledFor ?? ''}
            />
          )}
        </Field>
        <label className="flex items-start gap-3 rounded-xl border border-hairline bg-warning-soft/40 p-3">
          <input
            type="checkbox"
            name="confirm"
            className="mt-0.5 size-5 shrink-0 accent-primary-action"
          />
          <span className="grid gap-0.5 text-sm">
            <span className="font-medium text-foreground">
              <AutoText>Send to every customer who allowed promotional notifications</AutoText>
            </span>
            <span className="text-xs text-muted-foreground">
              <AutoText>
                It cannot be recalled once delivered. One broadcast per 10 minutes.
              </AutoText>
            </span>
            {errors?.confirm ? (
              <span className="text-xs font-medium text-danger-ink">
                <AutoText value={errors.confirm} />
              </span>
            ) : null}
          </span>
        </label>
        <div>
          <SendButton />
        </div>
        <ActionFeedback state={state} />
      </form>

      <div aria-label={tx('Preview')} className="grid content-start gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          <Smartphone aria-hidden="true" className="size-4" /> Preview
        </p>
        <div className="rounded-3xl bg-slate-900 p-4">
          <div className="rounded-2xl bg-white/95 p-3 shadow-lg">
            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              <span className="grid size-5 place-items-center rounded-md bg-sky-600 text-[10px] font-bold text-white">
                N
              </span>
              <AutoText>Nilzora · now</AutoText>
            </div>
            <p className="mt-1.5 text-sm font-semibold break-words text-slate-900">
              {title || 'Your title'}
            </p>
            <p className="text-sm break-words text-slate-700">
              {body || 'Your message appears here.'}
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          <AutoText>
            How it looks varies by phone; long messages are shortened by the system.
          </AutoText>
        </p>
      </div>
    </div>
  );
}

/**
 * Automatic announcements of newly published products. The announcement is queued by the database
 * when a product first goes on sale (never for a draft, a hidden product or an edit), and sent by
 * the background worker, so publishing is never slowed down.
 */
export function PushSettingsForm({ csrf, settings }: { csrf: CsrfInput; settings: PushSettings }) {
  const tx = useTx();
  const [state, action, pending] = useActionState(savePushSettingsAction, IDLE_STATE);
  const errors = state.fieldErrors;
  return (
    <form action={action} className="grid gap-4">
      <CsrfField csrf={csrf} />
      <label className="flex items-start gap-3 rounded-xl border border-hairline p-3">
        <input
          type="checkbox"
          name="autoAnnounceProducts"
          defaultChecked={settings.autoAnnounceProducts}
          className="mt-0.5 size-5 shrink-0 accent-primary-action"
        />
        <span className="grid gap-0.5 text-sm">
          <span className="font-medium text-foreground">
            <AutoText>Announce new products automatically</AutoText>
          </span>
          <span className="text-xs text-muted-foreground">
            <AutoText>
              Sent once, when a product first goes on sale, to customers who allowed promotional
              notifications. Never for drafts, hidden products or later edits.
            </AutoText>
          </span>
        </span>
      </label>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field
          id="push-title-template"
          label={tx('Title')}
          hint={tx('{name} becomes the product name. Up to 65 characters.')}
          error={errors?.productTitleTemplate}
        >
          {(control) => (
            <Input
              {...control}
              name="productTitleTemplate"
              maxLength={BROADCAST_TITLE_MAX}
              defaultValue={state.values?.productTitleTemplate ?? settings.productTitleTemplate}
            />
          )}
        </Field>
        <Field
          id="push-body-template"
          label={tx('Message')}
          hint={tx('{name} becomes the product name. Up to 240 characters.')}
          error={errors?.productBodyTemplate}
        >
          {(control) => (
            <Textarea
              {...control}
              name="productBodyTemplate"
              rows={2}
              maxLength={BROADCAST_BODY_MAX}
              defaultValue={state.values?.productBodyTemplate ?? settings.productBodyTemplate}
            />
          )}
        </Field>
      </div>
      <div>
        <Button type="submit" loading={pending}>
          Save settings
        </Button>
      </div>
      <ActionFeedback state={state} />
    </form>
  );
}
