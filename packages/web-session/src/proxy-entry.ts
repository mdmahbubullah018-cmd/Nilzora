import type { NextRequest, NextResponse } from 'next/server';
import { apiClientFor } from './api';
import { getWebSessionConfig, type WebApp } from './config';
import { syncSessionCookies } from './proxy';

export { getWebSessionConfig, type WebApp } from './config';

/** The `proxy` export for an app's proxy.ts. See syncSessionCookies for what it does. */
export function createSessionProxy(app: WebApp): (request: NextRequest) => Promise<NextResponse> {
  return (request) => {
    const config = getWebSessionConfig(app);
    return syncSessionCookies(request, config, apiClientFor(config, request.headers));
  };
}
