import type { ConfigContext, ExpoConfig } from 'expo/config';

/*
 * Remote push on Android needs Firebase credentials inside the build. google-services.json is
 * git-ignored and belongs to the machine, so its path comes from GOOGLE_SERVICES_FILE (see
 * .env.example) instead of being committed. Left unset, the app still builds and reports order
 * updates as unavailable rather than pretending that this device registered; set it, and a
 * development build wires FCM in.
 *
 * Google Sign-In needs no plugin entry here: @react-native-google-signin/google-signin only
 * ships an iOS URL-scheme plugin, and on Android the Credential Manager/`play-services-auth`
 * integration comes from autolinking plus the web client id passed at runtime
 * (EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID, see src/auth/google-native.ts). Adding the plugin without
 * options would instead demand a Firebase google-services.json for sign-in.
 */
export default ({ config }: ConfigContext): Partial<ExpoConfig> => {
  const googleServicesFile = process.env.GOOGLE_SERVICES_FILE?.trim();

  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      // Native changes that must survive `expo prebuild` (android/ is not committed).
      './plugins/with-android-cpp-stl',
      './plugins/with-android-splash-assets',
      './plugins/with-android-release-signing',
    ],
    android: {
      ...(config.android ?? {}),
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
  };
};
