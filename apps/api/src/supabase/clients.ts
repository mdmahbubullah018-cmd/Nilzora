import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SupabaseConfig } from '../config/env';
import type { Database } from './database.types';

export type NilzoraSupabaseClient = SupabaseClient<Database>;

/** The API never persists or refreshes sessions itself; clients hold their own tokens. */
const SERVER_AUTH = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
} as const;

export interface SupabaseClients {
  /**
   * Service-role client. Bypasses Row Level Security, so it is used only for
   * trusted server operations (session revocation, privileged role changes).
   * Never expose it, its key or its results wholesale to callers.
   */
  readonly admin: NilzoraSupabaseClient;
  /**
   * New publishable-key client for one sign-up, sign-in or refresh call. A fresh
   * instance per call keeps one user's session from ever leaking into another
   * request.
   */
  public(): NilzoraSupabaseClient;
  /**
   * Publishable-key client acting as the signed-in user: PostgREST verifies the
   * access token itself and Row Level Security applies to every query.
   */
  asUser(accessToken: string): NilzoraSupabaseClient;
}

export function createSupabaseClients(config: SupabaseConfig): SupabaseClients {
  const admin = createClient<Database>(config.url, config.secretKey, { auth: SERVER_AUTH });

  return {
    admin,
    public: () => createClient<Database>(config.url, config.publishableKey, { auth: SERVER_AUTH }),
    asUser: (accessToken) =>
      createClient<Database>(config.url, config.publishableKey, {
        auth: SERVER_AUTH,
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
      }),
  };
}
