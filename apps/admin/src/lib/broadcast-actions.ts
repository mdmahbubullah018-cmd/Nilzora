'use server';

import {
  BROADCAST_BODY_MAX,
  BROADCAST_TITLE_MAX,
  bannerHrefSchema,
  mediaKeySchema,
  savePushSettingsSchema,
} from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { revalidatePath } from 'next/cache';
import { adminAct, formText, invalid, type ActionState } from '@/components/admin-kit/act';

/*
 * Sending a push broadcast. adminAct() checks this app's Origin and CSRF token first; the API
 * checks notifications.broadcast, and the database checks it again, holds the store to one
 * broadcast per 10 minutes and audits it. Only fixed messages return to the browser.
 */

export async function sendBroadcastAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const title = formText(formData, 'title').trim();
  const body = formText(formData, 'body').trim();
  const productText = formText(formData, 'productId').trim();
  const imageKey = formText(formData, 'imageKey').trim();
  const linkPath = formText(formData, 'linkPath').trim();
  const scheduleText = formText(formData, 'scheduledFor').trim();
  const values = {
    title,
    body,
    productId: productText,
    imageKey,
    linkPath,
    scheduledFor: scheduleText,
  };
  const errors: Record<string, string> = {};
  if (title.length < 1 || title.length > BROADCAST_TITLE_MAX) {
    errors.title = `Write a title of up to ${String(BROADCAST_TITLE_MAX)} characters.`;
  }
  if (body.length < 1 || body.length > BROADCAST_BODY_MAX) {
    errors.body = `Write a message of up to ${String(BROADCAST_BODY_MAX)} characters.`;
  }
  const product = productText === '' ? null : uuidSchema.safeParse(productText);
  if (product !== null && !product.success) errors.productId = 'Choose a product from the list.';
  if (imageKey !== '' && !mediaKeySchema.safeParse(imageKey).success) {
    errors.imageKey = 'Choose a picture from the library.';
  }
  if (linkPath !== '' && !bannerHrefSchema.safeParse(linkPath).success) {
    errors.linkPath = 'Use a page inside the store, such as /categories/fashion.';
  }
  // A datetime-local value is read as Bangladesh time (UTC+6), like every schedule in this admin.
  let scheduledFor: string | undefined;
  if (scheduleText !== '') {
    const parsed = new Date(`${scheduleText}:00+06:00`);
    if (Number.isNaN(parsed.getTime())) errors.scheduledFor = 'Enter a valid date and time.';
    else if (parsed.getTime() < Date.now() - 60_000)
      errors.scheduledFor = 'Choose a time in the future.';
    else if (parsed.getTime() > Date.now() + 30 * 24 * 60 * 60 * 1000) {
      errors.scheduledFor = 'Schedule within the next 30 days.';
    } else scheduledFor = parsed.toISOString();
  }
  if (formData.get('confirm') !== 'on') {
    errors.confirm =
      'Confirm that this goes to every customer who allowed promotional notifications.';
  }
  if (Object.keys(errors).length > 0)
    return invalid('Check the highlighted fields.', errors, values);

  const result = await adminAct(
    formData,
    (api, token) =>
      api.adminCreateBroadcast(token, {
        title,
        body,
        ...(product?.success ? { productId: product.data } : {}),
        ...(imageKey === '' ? {} : { imageKey }),
        ...(linkPath === '' ? {} : { linkPath }),
        ...(scheduledFor === undefined ? {} : { scheduledFor }),
      }),
    {
      returnTo: '/admin/broadcasts',
      label: 'push broadcast',
      messages: {
        in_use: 'Another broadcast went out less than 10 minutes ago. Wait, then send again.',
        bad_request: 'Check the title, the message and the linked product (it must be on sale).',
        forbidden: 'Sending broadcasts needs the “Send push broadcasts” permission.',
        rate_limited: 'Too many changes in a short time. Wait a moment, then try again.',
      },
    },
  );
  if (!result.ok) return { ...result.state, values };
  revalidatePath('/admin/broadcasts');
  const count = result.value.recipients;
  return {
    status: 'success',
    message:
      scheduledFor !== undefined
        ? `Scheduled for ${String(count)} ${count === 1 ? 'customer' : 'customers'}. It is delivered from the time you chose.`
        : count === 0
          ? 'Queued, but no customer has allowed promotional notifications on a signed-in device yet, so nobody will receive it.'
          : `Queued for ${String(count)} ${count === 1 ? 'customer' : 'customers'}. Delivery runs in the background.`,
  };
}

/** Saves the switch and the words for automatic announcements of newly published products. */
export async function savePushSettingsAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = {
    productTitleTemplate: formText(formData, 'productTitleTemplate').trim(),
    productBodyTemplate: formText(formData, 'productBodyTemplate').trim(),
  };
  const parsed = savePushSettingsSchema.safeParse({
    autoAnnounceProducts: formData.get('autoAnnounceProducts') === 'on',
    ...values,
  });
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) errors[String(issue.path[0] ?? '')] ??= issue.message;
    return invalid('Check the highlighted fields.', errors, values);
  }
  const result = await adminAct(
    formData,
    (api, token) => api.adminSavePushSettings(token, parsed.data),
    {
      returnTo: '/admin/broadcasts',
      label: 'push settings',
      messages: {
        bad_request: 'Check the title and the message.',
        forbidden: 'Changing push settings needs the “Send push broadcasts” permission.',
      },
    },
  );
  if (!result.ok) return { ...result.state, values };
  revalidatePath('/admin/broadcasts');
  return {
    status: 'success',
    message: parsed.data.autoAnnounceProducts
      ? 'Saved. New products are announced automatically.'
      : 'Saved. New products are not announced automatically.',
  };
}
