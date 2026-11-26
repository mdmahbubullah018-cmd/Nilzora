import { AccessibilityInfo } from 'react-native';

/*
 * Runs before every test file (package.json "jest.setupFiles").
 *
 * - AsyncStorage has no native module under Jest, so the library's own in-memory mock is
 *   installed. It keeps its data for the whole test file: call resetAsyncStorage() in a
 *   beforeEach when a test depends on it being empty.
 * - Tests run with "reduce motion" on, so looping animations (skeleton pulses) never start:
 *   an endless animation keeps React's act() from ever settling. A test that needs the
 *   animation turns it back on with
 *   jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValueOnce(false).
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual<object>('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

/*
 * jest-expo provides a native ExpoGo module, so expo's isRunningInExpoGo() would report true
 * in every test. Tests are not Expo Go: default to a development build, and let the one test
 * that covers Expo Go (push-service-module-load) replace this mock with its own.
 */
jest.mock('expo', () => ({
  ...jest.requireActual<object>('expo'),
  isRunningInExpoGo: () => false,
}));

jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);

/*
 * The branded pull-to-refresh runs on react-native-gesture-handler and react-native-reanimated,
 * whose native halves do not exist under Jest. See native-animation-mocks.tsx: gestures never
 * fire (tests refresh through the list's "Refresh" accessibility action) and worklets run as
 * ordinary functions.
 */
jest.mock(
  'react-native-reanimated',
  () => jest.requireActual<{ reanimatedMock: object }>('./native-animation-mocks').reanimatedMock,
);
jest.mock(
  'react-native-worklets',
  () => jest.requireActual<{ workletsMock: object }>('./native-animation-mocks').workletsMock,
);
jest.mock(
  'react-native-gesture-handler',
  () =>
    jest.requireActual<{ gestureHandlerMock: object }>('./native-animation-mocks')
      .gestureHandlerMock,
);
