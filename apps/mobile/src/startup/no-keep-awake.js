// A stand-in for `expo-keep-awake`, used only by Expo's development wrapper (see metro.config.js).
// It keeps the app's own screen from being held awake: `useKeepAwake` does nothing.
module.exports = {
  ExpoKeepAwakeTag: 'nilzora-keep-awake-disabled',
  useKeepAwake: () => undefined,
  activateKeepAwake: () => Promise.resolve(),
  activateKeepAwakeAsync: () => Promise.resolve(),
  deactivateKeepAwake: () => Promise.resolve(),
  isAvailableAsync: () => Promise.resolve(false),
};
