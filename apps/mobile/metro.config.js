/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS config file that Metro loads with require */
// Metro configuration: Expo's defaults, plus one deliberate change.
//
// Expo's `registerRootComponent` wraps the whole app in `useKeepAwake()` in every non-production
// bundle (a debug build, or a development server), which stops the phone's own screen timeout
// from ever applying. Nilzora must respect the system screen-timeout setting, so that
// development wrapper gets a no-op `expo-keep-awake` (src/startup/no-keep-awake.js).
//
// Only the import made by Expo's own `withDevTools` is replaced: any feature that genuinely
// needs the screen awake (a product video, through expo-video's own player) is unaffected.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const noKeepAwake = path.resolve(__dirname, 'src/startup/no-keep-awake.js');
const upstream = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName === 'expo-keep-awake' &&
    /[\\/]expo[\\/](src|build)[\\/]launch[\\/]withDevTools/.test(context.originModulePath)
  ) {
    return { type: 'sourceFile', filePath: noKeepAwake };
  }
  return (upstream ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
