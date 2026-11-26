import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type TextInputInstance } from 'react-native';
import type { ActionResult } from '@/auth/session-manager';
import { useSession } from '@/auth/session-context';
import { AuthScaffold } from '@/components/auth-scaffold';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { GoogleButton } from '@/components/google-button';
import { Notice } from '@/components/notice';
import { PasswordField } from '@/components/password-field';
import { Screen, STACK_EDGES } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { authHref, parseReturnTo } from '@/lib/return-to';
import { theme } from '@/theme';

export default function SignInScreen() {
  const router = useRouter();
  const { returnTo: requestedReturnTo } = useLocalSearchParams<{ returnTo?: string }>();
  // Only one of the app's own screens is accepted; anything else falls back to the default.
  const returnTo = parseReturnTo(requestedReturnTo);
  const { state, manager } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ActionResult<'email' | 'password'> | null>(null);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [googleMessage, setGoogleMessage] = useState<string | null>(null);
  const passwordRef = useRef<TextInputInstance>(null);
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
    try {
      const outcome = await manager.signIn(email, password);
      if (outcome.ok) {
        setPassword('');
        leave();
        return;
      }
      setResult(outcome);
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  }

  async function submitGoogle() {
    if (manager === null || googleSubmitting || submitting) return;
    setGoogleSubmitting(true);
    setGoogleMessage(null);
    try {
      const outcome = await manager.signInWithGoogle();
      if (outcome.ok) {
        setPassword('');
        leave();
        return;
      }
      setGoogleMessage(outcome.message);
    } finally {
      setGoogleSubmitting(false);
    }
  }

  if (manager === null || state.status === 'unconfigured') {
    return (
      <Screen edges={STACK_EDGES}>
        <Notice tone="danger" title="Sign-in is not available">
          This build has no valid API address (EXPO_PUBLIC_API_BASE_URL), so it cannot reach
          Nilzora.
        </Notice>
      </Screen>
    );
  }

  if (state.status === 'signed_in' && !submitting) {
    return (
      <Screen edges={STACK_EDGES}>
        <Notice tone="success">You are signed in.</Notice>
        <Button label={returnTo === null ? 'Go to your account' : 'Continue'} onPress={leave} />
      </Screen>
    );
  }

  const fieldErrors = result && !result.ok ? result.fieldErrors : undefined;
  const googleAvailable = manager.googleSignInAvailable();
  return (
    <AuthScaffold
      title="Welcome back"
      subtitle="Sign in to follow your orders, keep your delivery addresses and check out in a few taps."
      footer={
        <View style={styles.footer}>
          <Text style={styles.footerText}>New to Nilzora?</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Create an account"
            accessibilityHint="Opens the registration form"
            disabled={submitting}
            onPress={() => router.replace(authHref('/register', returnTo))}
            hitSlop={8}
            style={({ pressed }) => [styles.footerAction, pressed ? styles.inlinePressed : null]}
          >
            <Text style={styles.footerActionText}>Create an account</Text>
          </Pressable>
        </View>
      }
    >
      {result && !result.ok ? <Notice tone="danger">{result.message}</Notice> : null}
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
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => passwordRef.current?.focus()}
          maxLength={254}
          editable={!submitting}
        />
        <View style={styles.passwordBlock}>
          <PasswordField
            ref={passwordRef}
            label="Password"
            value={password}
            onChangeText={setPassword}
            error={fieldErrors?.password}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
            maxLength={1024}
            editable={!submitting}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Forgot your password?"
            accessibilityHint="Emails you a code to set a new password"
            disabled={submitting}
            onPress={() => router.push(authHref('/forgot-password', null, email))}
            hitSlop={8}
            style={({ pressed }) => [styles.forgot, pressed ? styles.inlinePressed : null]}
          >
            <Text style={styles.forgotText}>Forgot your password?</Text>
          </Pressable>
        </View>
        <Button label="Sign in" loading={submitting} onPress={() => void submit()} />

        {googleAvailable ? (
          <>
            <AuthSeparator />
            <GoogleButton
              loading={googleSubmitting}
              disabled={submitting}
              onPress={() => void submitGoogle()}
            />
            {googleMessage === null ? null : <Notice tone="danger">{googleMessage}</Notice>}
          </>
        ) : null}
      </Card>
    </AuthScaffold>
  );
}

/** The rule between the password form and the other way in. */
function AuthSeparator() {
  return (
    <View style={styles.separatorRow} aria-hidden>
      <View style={styles.separatorLine} />
      <Text style={styles.separatorText}>or</Text>
      <View style={styles.separatorLine} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { padding: theme.spacing[5], gap: theme.spacing[4] },
  passwordBlock: { gap: theme.spacing[1] },
  forgot: {
    alignSelf: 'flex-end',
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.radii.sm,
  },
  forgotText: { color: theme.colors.link, ...theme.text.caption },
  inlinePressed: { opacity: 0.7 },
  separatorRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3] },
  separatorLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
  },
  separatorText: { color: theme.colors.mutedForeground, ...theme.text.caption },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[1],
    paddingTop: theme.spacing[1],
  },
  footerText: { color: theme.colors.mutedForeground, ...theme.text.body },
  footerAction: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.radii.sm,
  },
  footerActionText: { color: theme.colors.link, ...theme.text.bodyStrong },
});
