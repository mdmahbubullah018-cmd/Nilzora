import { session } from '@/lib/session';

/**
 * Whether Google sign-in can be offered, asked of the API once per render. A failure to
 * ask (outage, misconfiguration) hides the button rather than showing one that leads
 * nowhere: the password form keeps working either way.
 */
export async function googleEnabled(): Promise<boolean> {
  try {
    const providers = await (await session.api()).authProviders();
    return providers.google;
  } catch {
    return false;
  }
}
