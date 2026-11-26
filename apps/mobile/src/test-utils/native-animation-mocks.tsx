import { useState, type ComponentType, type ReactNode } from 'react';
import { Easing, FlatList, Image, ScrollView, Text, View } from 'react-native';

/*
 * Jest stand-ins for react-native-reanimated, react-native-worklets and
 * react-native-gesture-handler, limited to what the app uses (the branded pull-to-refresh).
 *
 * Their native halves do not exist under Jest, and Reanimated 4.7's published mock initialises
 * the real module, which throws there. These keep the logic around the gesture testable: shared
 * values are plain boxes, animations jump straight to their target (calling their callback),
 * animated styles are computed on each render, worklets run as ordinary functions and gestures
 * never fire. Tests drive a refresh through the list's "Refresh" accessibility action.
 */

interface Box<T> {
  value: T;
  get: () => T;
  set: (next: T) => void;
}

function useSharedValue<T>(initial: T): Box<T> {
  const [box] = useState<Box<T>>(() => {
    const created: Box<T> = {
      value: initial,
      get: () => created.value,
      set: (next) => {
        created.value = next;
      },
    };
    return created;
  });
  return box;
}

type Done = ((finished: boolean) => void) | undefined;

function settle<T>(toValue: T, callback?: Done): T {
  callback?.(true);
  return toValue;
}

const Extrapolation = { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' } as const;

function interpolate(
  value: number,
  input: readonly number[],
  output: readonly number[],
  extrapolation?: string,
): number {
  const last = input.length - 1;
  let i = 0;
  while (i < last - 1 && value > (input[i + 1] ?? 0)) i++;
  const x0 = input[i] ?? 0;
  const x1 = input[i + 1] ?? x0;
  const y0 = output[i] ?? 0;
  const y1 = output[i + 1] ?? y0;
  const t = x1 === x0 ? 0 : (value - x0) / (x1 - x0);
  const clamped = extrapolation === 'clamp' ? Math.min(Math.max(t, 0), 1) : t;
  return y0 + (y1 - y0) * clamped;
}

const passThrough = <C,>(component: C): C => {
  // A real animated component consumes `animatedProps` itself. Under Jest the plain component
  // is rendered, so the prop is dropped rather than handed to a native view that cannot use it.
  const Component = component as unknown as ComponentType<Record<string, unknown>>;
  function AnimatedComponent({ animatedProps: _animatedProps, ...rest }: Record<string, unknown>) {
    return <Component {...rest} />;
  }
  return AnimatedComponent as unknown as C;
};

export const reanimatedMock = {
  __esModule: true,
  default: { View, ScrollView, FlatList, Image, Text, createAnimatedComponent: passThrough },
  createAnimatedComponent: passThrough,
  useSharedValue,
  useAnimatedStyle: <S,>(updater: () => S): S => updater(),
  useAnimatedProps: <P,>(updater: () => P): P => updater(),
  useAnimatedScrollHandler: () => () => undefined,
  useReducedMotion: () => true,
  // No keyboard under Jest: the lift is always zero.
  useAnimatedKeyboard: () => ({
    height: { value: 0, get: () => 0 },
    state: { value: 0, get: () => 0 },
  }),
  withTiming: <T,>(toValue: T, _config?: unknown, callback?: Done) => settle(toValue, callback),
  withSpring: <T,>(toValue: T, _config?: unknown, callback?: Done) => settle(toValue, callback),
  withSequence: <T,>(...steps: T[]): T | undefined => steps[steps.length - 1],
  withDelay: <T,>(_delayMs: number, animation: T): T => animation,
  withRepeat: <T,>(animation: T): T => animation,
  cancelAnimation: () => undefined,
  interpolate,
  Extrapolation,
  Easing,
};

export const workletsMock = {
  __esModule: true,
  scheduleOnRN: (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => {
    fn(...args);
  },
  runOnJS:
    (fn: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      fn(...args),
};

export const gestureHandlerMock = {
  __esModule: true,
  GestureHandlerRootView: View,
  GestureDetector: ({ children }: { children: ReactNode }) => children,
  usePanGesture: (config: object) => ({ type: 'pan', config }),
  useNativeGesture: (config: object) => ({ type: 'native', config }),
  usePinchGesture: (config: object) => ({ type: 'pinch', config }),
  useTapGesture: (config: object) => ({ type: 'tap', config }),
  useSimultaneousGestures: (...gestures: object[]) => ({ type: 'simultaneous', gestures }),
  GestureStateManager: {
    activate: () => undefined,
    fail: () => undefined,
    deactivate: () => undefined,
  },
};
