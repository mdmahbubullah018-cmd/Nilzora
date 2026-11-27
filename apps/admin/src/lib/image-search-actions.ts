'use server';

import { revalidatePath } from 'next/cache';
import { adminAct, formText, invalid, type ActionState } from '@/components/admin-kit/act';
import { IMAGE_SEARCH_PATH } from './image-search-path';

/*
 * Settings -> Image Search, write side (image_search.manage).
 *
 * Two actions only: save the settings, and start an indexing job. Both go through adminAct,
 * which refuses a form without this app's Origin and CSRF token before any API call, and both
 * revalidate the page so the statistics the operator sees afterwards are re-read rather than
 * remembered.
 *
 * A "use server" module may export async functions and nothing else, so the page's path lives
 * in image-search-path.ts: a constant exported here would drop every action in the file.
 */

const SAVE_MESSAGES = {
  forbidden: 'Changing image search needs the "Manage image search" permission.',
  bad_request: 'Some of the settings were refused. Check the threshold and the result cap.',
};

/** Saves enabled / threshold / max results. The model is the server's, never the form's. */
export async function saveImageSearchSettingsAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const enabled = formText(formData, 'enabled') === 'on';
  const thresholdText = formText(formData, 'similarityThreshold').trim();
  const maxResultsText = formText(formData, 'maxResults').trim();

  const threshold = Number(thresholdText);
  if (!Number.isFinite(threshold) || threshold < 0.3 || threshold > 0.99) {
    const message = 'Enter a threshold from 0.30 to 0.99 (a cosine similarity).';
    return invalid(
      message,
      { similarityThreshold: message },
      { similarityThreshold: thresholdText },
    );
  }
  const maxResults = Number(maxResultsText);
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 120) {
    const message = 'Enter a result cap from 1 to 120.';
    return invalid(message, { maxResults: message }, { maxResults: maxResultsText });
  }

  const result = await adminAct(
    formData,
    (api, token) =>
      api.adminSaveImageSearchSettings(token, {
        enabled,
        similarityThreshold: Math.round(threshold * 1000) / 1000,
        maxResults,
      }),
    { returnTo: IMAGE_SEARCH_PATH, label: 'image search settings change', messages: SAVE_MESSAGES },
  );
  if (!result.ok) {
    return {
      ...result.state,
      values: { similarityThreshold: thresholdText, maxResults: maxResultsText },
    };
  }

  revalidatePath(IMAGE_SEARCH_PATH);
  const saved = result.value;
  return {
    status: 'success',
    message: saved.enabled
      ? `Saved. Image search is on, matching from ${Math.round(saved.similarityThreshold * 100)}%.`
      : 'Saved. Image search is switched off for customers.',
  };
}

const JOB_MESSAGES = {
  forbidden: 'Starting an indexing job needs the "Manage image search" permission.',
  bad_request: 'That job kind was refused.',
};

/** Starts a backfill, a full reindex or a retry of the failed pictures. */
export async function startImageSearchJobAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const kind = formText(formData, 'kind');
  if (kind !== 'backfill' && kind !== 'reindex_all' && kind !== 'retry_failed') {
    return { status: 'error', message: 'Choose a job to start.' };
  }

  const result = await adminAct(
    formData,
    (api, token) => api.adminStartImageSearchJob(token, { kind }),
    { returnTo: IMAGE_SEARCH_PATH, label: 'image search job start', messages: JOB_MESSAGES },
  );
  if (!result.ok) return result.state;

  revalidatePath(IMAGE_SEARCH_PATH);
  const job = result.value;
  const label =
    kind === 'backfill' ? 'Backfill' : kind === 'reindex_all' ? 'Full reindex' : 'Retry failed';
  return {
    status: 'success',
    message: `${label} started: ${job.total} ${job.total === 1 ? 'picture' : 'pictures'} queued. Progress updates on this page.`,
  };
}
