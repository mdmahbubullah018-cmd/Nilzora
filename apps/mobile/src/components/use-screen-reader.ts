import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Whether a screen reader (TalkBack, VoiceOver) is running.
 *
 * Read once on mount, then it follows the system while the screen is open. Until the first read
 * resolves it is `true`: "unknown" is treated as "a screen reader is on", so nothing that moves
 * by itself starts under someone who cannot see it and then has to be taken back.
 */
export function useScreenReaderEnabled(): boolean {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isScreenReaderEnabled()
      .then((value) => {
        if (active) setEnabled(value);
      })
      .catch(() => {
        // Unreadable: stay on the cautious answer.
      });
    const subscription = AccessibilityInfo.addEventListener('screenReaderChanged', (value) => {
      if (active) setEnabled(value);
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return enabled;
}
