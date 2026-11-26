import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, Text, View } from 'react-native';
import type { ActionResult } from '@/auth/session-manager';
import { useSession } from '@/auth/session-context';
import { AuthScaffold } from '@/components/auth-scaffold';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { AppIcon } from '@/components/icon';
import { Notice } from '@/components/notice';
import { OtpField } from '@/components/otp-field';
import { ResendCode } from '@/components/resend-code';
import { Screen, STACK_EDGES } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { authHref, parseReturnTo } from '@/lib/return-to';
import { theme } from '@/theme';

/**
 * The six-digit code that completes registration. Verifying the address is what makes the
 * account usable, so a correct code signs the customer in; the success state confirms that
 * before Continue takes them on to the same destination as before.
 */
export default function VerifyEmailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string; returnTo?: string }>();
  const returnTo = parseReturnTo(params.returnTo);
  const [email, setEmail] = useState(typeof params.email === 'string' ? params.email : '');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [result, setResult] = useState<ActionResult<'email' | 'code'> | null>(null);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const { manager } = useSession();
  /** Blocks a second submit before the loading state has rendered. */
  const busy = useRef(false);

  function leave() {
    if (returnTo !== null) router.dismissTo(returnTo as Href);
    else if (router.canGoBack()) router.back();
    else router.replace('/account');
  }

  async function submit() {
    if (manager === null || busy.current) return;
    busy.current = true;
    setSubmitting(true);
    setResult(null);
    setResendMessage(null);
    try {
      const outcome = await manager.verifyEmailCode(email, code);
      if (outcome.ok) {
        setCode('');
        setVerified(true);
        return;
      }
      setResult(outcome);
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  }

  async function resend() {
    if (manager === null) return;
    setResending(true);
    setResendMessage(null);
    try {
      const outcome = await manager.resendEmailCode(email);
      setResendMessage(outcome.message ?? null);
    } finally {
      setResending(false);
    }
  }

  if (manager === null) {
    return (
      <Screen edges={STACK_EDGES}>
        <Notice tone="danger" title="Verification is not available">
          This build has no valid API address (EXPO_PUBLIC_API_BASE_URL), so it cannot reach
          Nilzora.
        </Notice>
      </Screen>
    );
  }

  if (verified) {
    return (
      <Screen edges={STACK_EDGES}>
        <VerifiedPanel />
        <Button label="Continue" onPress={leave} />
      </Screen>
    );
  }

  const fieldErrors = result && !result.ok ? result.fieldErrors : undefined;
  return (
    <AuthScaffold
      eyebrow="Almost there"
      title="Verify your email"
      subtitle="Enter the six-digit code we sent you. It expires in 10 minutes, and verifying the address creates your account."
    >
      {result && !result.ok ? <Notice tone="danger">{result.message}</Notice> : null}
      {resendMessage !== null ? <Notice tone="success">{resendMessage}</Notice> : null}
      <Card style={styles.form}>
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          error={fieldErrors?.email}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          maxLength={254}
          editable={!submitting}
        />
        <OtpField
          value={code}
          onChange={setCode}
          error={fieldErrors?.code}
          hint="Six digits from the email."
          editable={!submitting}
        />
        <Button label="Verify and continue" loading={submitting} onPress={() => void submit()} />
      </Card>
      <ResendCode
        onResend={async () => {
          await resend();
        }}
        disabled={submitting || resending}
        subject="code"
      />
      <View style={styles.footer}>
        <Text style={styles.footerText}>Already verified?</Text>
        <Button
          label="Sign in"
          variant="secondary"
          disabled={submitting}
          onPress={() => router.replace(authHref('/sign-in', returnTo))}
        />
      </View>
    </AuthScaffold>
  );
}

/** The confirmation shown once the API has accepted the code. */
function VerifiedPanel() {
  const [progress] = useState(() => new Animated.Value(0));
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!active) return;
      setReduceMotion(enabled);
      if (!enabled) {
        Animated.spring(progress, {
          toValue: 1,
          friction: 6,
          tension: 90,
          useNativeDriver: true,
        }).start();
      }
    });
    return () => {
      active = false;
    };
  }, [progress]);

  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] });
  return (
    <View style={styles.verified}>
      <Animated.View
        style={[styles.verifiedDisc, reduceMotion ? null : { transform: [{ scale }] }]}
      >
        <AppIcon name="success" size="xl" color={theme.colors.primaryAction} />
      </Animated.View>
      <Text accessibilityRole="header" style={styles.verifiedTitle}>
        Email verified
      </Text>
      <Text style={styles.verifiedBody}>
        Your Nilzora account is ready. You are signed in on this device.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { padding: theme.spacing[4], gap: theme.spacing[4] },
  footer: { gap: theme.spacing[2], paddingTop: theme.spacing[2] },
  footerText: { color: theme.colors.mutedForeground, ...theme.text.body, textAlign: 'center' },
  verified: { alignItems: 'center', gap: theme.spacing[3], paddingVertical: theme.spacing[8] },
  verifiedDisc: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.notice.success.surface,
    borderWidth: 1,
    borderColor: theme.notice.success.border,
  },
  verifiedTitle: { color: theme.colors.foreground, ...theme.text.title },
  verifiedBody: {
    color: theme.colors.body,
    ...theme.text.body,
    lineHeight: 21,
    textAlign: 'center',
    maxWidth: 300,
  },
});
