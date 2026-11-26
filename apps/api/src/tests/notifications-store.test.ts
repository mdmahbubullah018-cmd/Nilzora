import { describe, expect, it } from 'vitest';
import { createSupabaseNotificationStore } from '../modules/notifications/store';
import type { SupabaseClients } from '../supabase/clients';

/** What supabase-js resolves for a failed rpc call. */
interface RpcOutcome {
  data: null;
  error: { message: string; code?: string };
  status: number;
}

function storeAnswering(outcome: RpcOutcome) {
  const clients = { admin: { rpc: () => Promise.resolve(outcome) } } as unknown as SupabaseClients;
  return createSupabaseNotificationStore(clients);
}

/** Records the rpc name and arguments, and answers with `outcome`. */
function storeCalling(outcome: { data: unknown; error: unknown; status: number }) {
  const calls: { name: string; args: unknown }[] = [];
  const clients = {
    admin: {
      rpc: (name: string, args: unknown) => {
        calls.push({ name, args });
        return Promise.resolve(outcome);
      },
    },
  } as unknown as SupabaseClients;
  return { store: createSupabaseNotificationStore(clients), calls };
}

describe('the sender’s preference question', () => {
  it('asks the database function instead of reading the closed table', async () => {
    const { store, calls } = storeCalling({ data: true, error: null, status: 200 });
    const account = 'de000000-0000-4000-8000-000000000002';

    await expect(store.notificationAllowed(account)).resolves.toBe(true);

    expect(calls).toStrictEqual([{ name: 'notification_allowed', args: { p_user_id: account } }]);
  });

  it('believes a plain "no" from the database', async () => {
    const { store } = storeCalling({ data: false, error: null, status: 200 });
    await expect(store.notificationAllowed('de000000-0000-4000-8000-000000000003')).resolves.toBe(
      false,
    );
  });

  it('never treats an unreadable answer as consent', async () => {
    // A refused question (denied, unreachable, or a changed signature) must throw so the
    // worker retries; a swallowed error here would notify an account that opted out.
    const denied = storeCalling({
      data: null,
      error: { message: 'permission denied for function notification_allowed', code: '42501' },
      status: 403,
    });
    await expect(
      denied.store.notificationAllowed('de000000-0000-4000-8000-000000000004'),
    ).rejects.toMatchObject({ message: 'notification_allowed failed (42501)' });

    const nonsense = storeCalling({ data: 'yes', error: null, status: 200 });
    await expect(
      nonsense.store.notificationAllowed('de000000-0000-4000-8000-000000000005'),
    ).rejects.toMatchObject({ message: 'notification_allowed returned an unexpected answer' });
  });
});

describe('notification store failures', () => {
  it('reports a rejected API key by its HTTP status, not as a network failure', async () => {
    const store = storeAnswering({
      data: null,
      error: { message: 'Invalid API key' },
      status: 401,
    });
    await expect(store.claim(10, 60)).rejects.toMatchObject({
      message: 'claim_notifications failed (http 401)',
    });
  });

  it('keeps the SQLSTATE when the database gave one', async () => {
    const store = storeAnswering({
      data: null,
      error: { message: 'limit must be 1-100', code: 'NZ412' },
      status: 400,
    });
    await expect(store.claim(10, 60)).rejects.toMatchObject({
      message: 'claim_notifications failed (NZ412)',
    });
  });

  it('calls it a network failure only when there was no response', async () => {
    const store = storeAnswering({
      data: null,
      error: { message: 'TypeError: fetch failed' },
      status: 0,
    });
    await expect(
      store.invalidateDevices(['de000000-0000-4000-8000-000000000001']),
    ).rejects.toMatchObject({
      message: 'invalidate_device_tokens failed (network)',
    });
  });

  it('never puts the server message in the error', async () => {
    const store = storeAnswering({
      data: null,
      error: { message: 'token fcm-token-SECRET quoted by the database' },
      status: 500,
    });
    const failure = await store
      .finish('de000000-0000-4000-8000-000000000001', 'sent')
      .catch((e: Error) => e);
    expect(failure).toMatchObject({ message: 'finish_notification failed (http 500)' });
    expect((failure as Error).message).not.toContain('SECRET');
  });
});
