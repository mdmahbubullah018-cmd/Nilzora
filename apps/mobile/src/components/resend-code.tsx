import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '@/theme';

/** How long the button rests after a request. A local hint, not a server rule. */
export const RESEND_COOLDOWN_SECONDS = 60;

export interface ResendCodeProps {
  /** Sends the code. The cooldown starts when it settles, whatever the outcome. */
  onResend: () => Promise<void> | void;
  /** Blocks the control while the screen's own form is submitting. */
  disabled?: boolean;
  /** What is being resent, completing "Didn't get the <subject>?". */
  subject?: string;
}

/**
 * "Didn't get the email? Send a new code", with a local cooldown so a second request cannot
 * be fired by an impatient double tap. The countdown is only a courtesy: the API has its own
 * rate limit, and a request that is refused still ends the cooldown so the customer can try
 * again later rather than being stuck.
 */
export function ResendCode({ onResend, disabled = false, subject = 'code' }: ResendCodeProps) {
  const [seconds, setSeconds] = useState(0);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setTimeout(() => {
      setSeconds((current) => Math.max(0, current - 1));
    }, 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [seconds]);

  const counting = seconds > 0;
  const inactive = disabled || sending || counting;

  async function send() {
    if (inactive) return;
    setSending(true);
    try {
      await onResend();
    } finally {
      setSending(false);
      setSeconds(RESEND_COOLDOWN_SECONDS);
    }
  }

  return (
    <View style={styles.row}>
      <Text style={styles.prompt}>Didn&apos;t get the {subject}?</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          counting ? `Send a new code in ${String(seconds)} seconds` : 'Send a new code'
        }
        accessibilityState={{ disabled: inactive, busy: sending }}
        disabled={inactive}
        hitSlop={6}
        onPress={() => void send()}
        style={({ pressed }) => [styles.action, pressed ? styles.pressed : null]}
      >
        <Text style={[styles.actionText, inactive ? styles.actionTextInactive : null]}>
          {sending
            ? 'Sending…'
            : counting
              ? `Send a new code in ${String(seconds)}s`
              : 'Send a new code'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[1],
    minHeight: theme.touchTarget,
  },
  prompt: { color: theme.colors.mutedForeground, ...theme.text.body },
  action: { minHeight: theme.touchTarget, justifyContent: 'center', paddingHorizontal: 4 },
  pressed: { opacity: 0.6 },
  actionText: { color: theme.colors.link, ...theme.text.bodyStrong },
  actionTextInactive: { color: theme.colors.mutedForeground },
});
