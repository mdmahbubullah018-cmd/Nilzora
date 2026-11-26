import type * as GoogleNative from '../auth/google-native';

import { googleSignInAvailable, resetGoogleIdTokenProvider } from '../auth/google-signin';

/*
 * A build without the native module (Expo Go, or one made before the package was added)
 * would throw the moment the library is imported. That must leave Google sign-in hidden
 * rather than crash the app at startup, so the import is checked before anything else.
 */
jest.mock('@react-native-google-signin/google-signin', () => {
  throw new Error('TurboModuleRegistry.getEnforcing: RNGoogleSignin could not be found');
});

const WEB_CLIENT_ID = '123456789012-abcdef123456.apps.googleusercontent.com';

beforeEach(() => {
  resetGoogleIdTokenProvider();
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = WEB_CLIENT_ID;
});

afterEach(() => {
  resetGoogleIdTokenProvider();
  delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
});

it('loads without the native module and leaves Google sign-in hidden', () => {
  // Required lazily so the throwing mock above is only hit inside the guarded load.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberately deferred, see above
  const { registerNativeGoogleSignIn } = require('../auth/google-native') as typeof GoogleNative;

  expect(registerNativeGoogleSignIn()).toBe(false);
  expect(googleSignInAvailable()).toBe(false);
});
