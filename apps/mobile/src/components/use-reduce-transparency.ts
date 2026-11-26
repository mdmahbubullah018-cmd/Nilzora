import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Whether the device asks for reduced transparency (iOS "Reduce Transparency"; Android reports
 * it through the same API where the OEM exposes it).
 *
 * Glass surfaces fall back to an opaque fill while this is on, so text over the surface never
 * depends on what happens to be scrolling underneath it. The answer is read once on mount and
 * then follows the system setting.
 */
export function useReduceTransparency(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceTransparencyEnabled()
      .then((enabled) => {
        if (active) setReduced(enabled);
      })
      .catch(() => {
        // Unreadable setting: keep the normal (translucent) surface rather than guess.
      });
    const subscription = AccessibilityInfo.addEventListener('reduceTransparencyChanged', (on) => {
      if (active) setReduced(on);
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}
