import { Easing } from 'react-native';

/*
 * Easing curves for React Native's Animated API, built once and shared. React Native declares
 * the base curves as methods, so they are wrapped in plain functions here instead of being
 * passed around detached from `Easing`.
 */

const quad = (t: number) => Easing.quad(t);
const cubic = (t: number) => Easing.cubic(t);
const sine = (t: number) => Easing.sin(t);

export const curves = {
  outQuad: Easing.out(quad),
  inOutQuad: Easing.inOut(quad),
  outCubic: Easing.out(cubic),
  inOutCubic: Easing.inOut(cubic),
  inOutSine: Easing.inOut(sine),
  /** Eases out past the target and settles back (`overshoot` ~1.5 is a soft pop). */
  outBack: (overshoot: number) => Easing.out(Easing.back(overshoot)),
} as const;
