import {
  authorizationCodeGrant,
  buildAuthorizationUrl,
  discovery,
  type Configuration,
} from 'openid-client';
import type { GoogleSettings } from './config';
import type { GoogleIdentity, OidcAdapter } from './oauth';

const GOOGLE_ISSUER = 'https://accounts.google.com';

/**
 * The network half of Google sign-in: discovery, the authorization URL, and the code
 * exchange with nonce and PKCE checks done by `openid-client`. Kept behind `OidcAdapter`
 * so the policy around it (state signing, account linking) is testable without Google.
 *
 * Only used when GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI are set;
 * until then the routes answer 503 oauth_unavailable.
 */
export function createGoogleAdapter(settings: GoogleSettings): OidcAdapter {
  let configuration: Promise<Configuration> | undefined;

  function config(): Promise<Configuration> {
    configuration ??= discovery(new URL(GOOGLE_ISSUER), settings.clientId, settings.clientSecret);
    return configuration;
  }

  return {
    async authorizationUrl({ state, nonce, codeChallenge, redirectUri }) {
      const url = buildAuthorizationUrl(await config(), {
        redirect_uri: redirectUri,
        scope: 'openid email profile',
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        prompt: 'select_account',
      });
      return url.href;
    },

    async exchange({ currentUrl, state, nonce, codeVerifier }): Promise<GoogleIdentity> {
      const tokens = await authorizationCodeGrant(await config(), new URL(currentUrl), {
        // Both mismatches fail the exchange rather than being compared by hand.
        expectedState: state,
        expectedNonce: nonce,
        pkceCodeVerifier: codeVerifier,
      });
      const claims = tokens.claims();
      if (!claims?.sub) throw new Error('the ID token has no subject');
      return {
        subject: claims.sub,
        email: typeof claims.email === 'string' ? claims.email : null,
        // Google sends `email_verified` as a boolean; anything else is not a verification.
        emailVerified: claims.email_verified === true,
        name: typeof claims.name === 'string' ? claims.name : undefined,
      };
    },
  };
}
