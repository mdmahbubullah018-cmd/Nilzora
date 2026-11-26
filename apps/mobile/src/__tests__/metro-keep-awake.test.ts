/**
 * Nilzora respects the phone's own screen timeout. Expo's development wrapper would hold the
 * screen awake for the whole life of the app, so Metro hands it a no-op `expo-keep-awake`
 * (metro.config.js) and leaves every other import alone.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const config = require('../../metro.config.js') as {
  resolver: {
    resolveRequest: (
      context: { originModulePath: string; resolveRequest: () => unknown },
      moduleName: string,
      platform: string,
    ) => unknown;
  };
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const stub = require('../startup/no-keep-awake.js') as {
  useKeepAwake: () => undefined;
  ExpoKeepAwakeTag: string;
};

function resolve(origin: string, moduleName: string) {
  const fallback = { type: 'fallback' };
  return config.resolver.resolveRequest(
    { originModulePath: origin, resolveRequest: () => fallback },
    moduleName,
    'android',
  );
}

describe('screen timeout: Expo development keep-awake', () => {
  it('replaces expo-keep-awake only for the wrapper Expo adds around the app', () => {
    const origins = [
      String.raw`D:\repo\node_modules\expo\build\launch\withDevTools.js`,
      '/repo/node_modules/expo/src/launch/withDevTools.tsx',
    ];
    for (const origin of origins) {
      expect(resolve(origin, 'expo-keep-awake')).toEqual({
        type: 'sourceFile',
        filePath: expect.stringMatching(/src[\\/]startup[\\/]no-keep-awake\.js$/) as string,
      });
    }
    // Any other importer, and any other module, resolves exactly as before.
    expect(resolve('/repo/apps/mobile/src/feature.ts', 'expo-keep-awake')).toEqual({
      type: 'fallback',
    });
    expect(resolve('/repo/node_modules/expo/build/launch/withDevTools.js', 'react')).toEqual({
      type: 'fallback',
    });
  });

  it('the stand-in never holds the screen awake', () => {
    expect(stub.useKeepAwake()).toBeUndefined();
    expect(stub.ExpoKeepAwakeTag).toBe('nilzora-keep-awake-disabled');
  });
});
