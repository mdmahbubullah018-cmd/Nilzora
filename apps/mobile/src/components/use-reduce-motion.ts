import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Whether the device asks for reduced motion (Android "Remove animations", iOS "Reduce Motion").
 *
 * The answer is read once on mount and then follows the system setting while the screen is
 * open. Until the first read resolves it is `true`: "unknown" is treated as "reduced", so
 * nothing that moves by itself (an auto-advancing carousel) starts and then has to be taken
 * back a moment later.
 */
export function useReduceMotion(): boolean {
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) setReduced(enabled);
      })
      .catch(() => {
        // The setting could not be read: leave motion off rather than guess.
      });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      if (active) setReduced(enabled);
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}
