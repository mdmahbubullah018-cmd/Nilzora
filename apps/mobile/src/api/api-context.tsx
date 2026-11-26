import type { ApiClient } from '@nilzora/api-client';
import { createContext, useContext, type ReactNode } from 'react';
import { getMobileApi } from '@/auth/api';

/** `null` = the app has no valid API address; `undefined` = no provider above (a programming error). */
const ApiContext = createContext<ApiClient | null | undefined>(undefined);

function sharedApi(): ApiClient | null {
  const mobileApi = getMobileApi();
  return mobileApi.ok ? mobileApi.api : null;
}

export interface ApiProviderProps {
  children: ReactNode;
  /** Tests inject a fake client (or `null` for an unconfigured build). */
  api?: ApiClient | null;
}

/**
 * Provides the app's single API client, the same instance the session manager uses
 * (see getMobileApi). The client holds no session and no tokens: authenticated calls go
 * through `useAuthorizedApi()`, which supplies a valid access token per call.
 */
export function ApiProvider({ children, api }: ApiProviderProps) {
  return (
    <ApiContext.Provider value={api === undefined ? sharedApi() : api}>
      {children}
    </ApiContext.Provider>
  );
}

/**
 * The API client, or `null` when this build has no valid API address. Screens must handle
 * `null` with a clear "not configured" state instead of crashing or showing a spinner forever.
 */
export function useApi(): ApiClient | null {
  const api = useContext(ApiContext);
  if (api === undefined) throw new Error('useApi() must be used inside <ApiProvider>');
  return api;
}
