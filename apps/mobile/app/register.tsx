import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type TextInputInstance } from 'react-native';
import type { ActionResult, RegisterInput } from '@/auth/session-manager';
import { useSession } from '@/auth/session-context';
import { AuthScaffold } from '@/components/auth-scaffold';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { GoogleButton } from '@/components/google-button';
import { Notice } from '@/components/notice';
import { PasswordField } from '@/components/password-field';
import { PolicyNotice } from '@/components/policy-notice';
import { Screen, STACK_EDGES } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { authHref, parseReturnTo } from '@/lib/return-to';
import { theme } from '@/theme';

/** Creates a customer account. There is no role field: the server always assigns "customer". */
export default function RegisterScreen() {
  const router = useRouter();
  const { returnTo: requestedReturnTo } = useLocalSearchParams<{ returnTo?: string }>();
  // Carried on to sign-in, which takes the customer back there.
  const returnTo = parseReturnTo(requestedReturnTo);
  const { manager } = useSession();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ActionResult<keyof RegisterInput> | null>(null);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [googleMessage, setGoogleMessage] = useState<string | null>(null);
  const emailRef = useRef<TextInputInstance>(null);
  const phoneRef = useRef<TextInputInstance>(null);
  const passwordRef = useRef<TextInputInstance>(null);
  const busy = useRef(false);

  async function submit() {
    if (manager === null || busy.current) return;
    busy.current = true;
    setSubmitting(true);
    setResult(null);
    try {
      const outcome = await manager.register({ email, password, fullName, phone });
      if (outcome.ok) setPassword('');
      setResult(outcome);
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  }

  /** Google creates the customer account on first use, so this is also a way to sign up. */
  async function submitGoogle() {
    if (manager === null || googleSubmitting || submitting) return;
    setGoogleSubmitting(true);
    setGoogleMessage(null);
    try {
      const outcome = await manager.signInWithGoogle();
      if (outcome.ok) {
        if (returnTo !== null) router.dismissTo(returnTo as Href);
        else if (router.canGoBack()) router.back();
        else router.replace('/account');
        return;
      }
      setGoogleMessage(outcome.message);
    } finally {
      setGoogleSubmitting(false);
    }
  }

  if (manager === null) {
    return (
      <Screen edges={STACK_EDGES}>
        <Notice tone="danger" title="Registration is not available">
          This build has no valid API address (EXPO_PUBLIC_API_BASE_URL), so it cannot reach
          Nilzora.
        </Notice>
      </Screen>
    );
  }

  if (result?.ok) {
    return (
      <Screen edges={STACK_EDGES}>
        <Notice tone="success" title="Check your inbox">
          {result.message}
        </Notice>
        <Text style={styles.intro}>
          Enter the six-digit code from the email to finish creating your account.
        </Text>
        <Button
          label="Enter my code"
          onPress={() =>
            router.replace(authHref('/verify-email', returnTo, email.trim().toLowerCase()))
          }
        />
      </Screen>
    );
  }

  const fieldErrors = result && !result.ok ? result.fieldErrors : undefined;
  const googleAvailable = manager.googleSignInAvailable();
  return (
    <AuthScaffold
      title="Create your account"
      subtitle="A few details, then a six-digit code by email to confirm your address."
      footer={
        <View style={styles.footer}>
          <Text style={styles.footerText}>Already have an account?</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign in"
            accessibilityHint="Opens the sign-in form"
            disabled={submitting}
            onPress={() => router.replace(authHref('/sign-in', returnTo))}
            hitSlop={8}
            style={({ pressed }) => [styles.footerAction, pressed ? styles.inlinePressed : null]}
          >
            <Text style={styles.footerActionText}>Sign in</Text>
          </Pressable>
        </View>
      }
    >
      {result && !result.ok ? <Notice tone="danger">{result.message}</Notice> : null}
      <Card style={styles.form}>
        <TextField
          label="Full name"
          optional
          value={fullName}
          onChangeText={setFullName}
          error={fieldErrors?.fullName}
          autoComplete="name"
          textContentType="name"
          autoCapitalize="words"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => emailRef.current?.focus()}
          maxLength={120}
          editable={!submitting}
        />
        <TextField
          ref={emailRef}
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
          onSubmitEditing={() => phoneRef.current?.focus()}
          maxLength={254}
          editable={!submitting}
        />
        <TextField
          ref={phoneRef}
          label="Mobile number"
          optional
          hint="Bangladeshi mobile number, for example 01712345678."
          value={phone}
          onChangeText={setPhone}
          error={fieldErrors?.phone}
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => passwordRef.current?.focus()}
          maxLength={20}
          editable={!submitting}
        />
        <PasswordField
          ref={passwordRef}
          label="Password"
          hint="At least 8 characters, with letters and numbers."
          value={password}
          onChangeText={setPassword}
          error={fieldErrors?.password}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          maxLength={128}
          editable={!submitting}
        />
        <Button label="Create account" loading={submitting} onPress={() => void submit()} />
        <PolicyNotice
          lead="By creating an account you agree to the"
          links={[
            { label: 'Terms of service', href: '/terms', after: ' and confirm you have read the ' },
            { label: 'Privacy policy', href: '/privacy', after: '.' },
          ]}
        />

        {googleAvailable ? (
          <>
            <AuthSeparator />
            <GoogleButton
              label="Sign up with Google"
              accessibilityHint="Creates your Nilzora account with Google, without a password"
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
  intro: { color: theme.colors.mutedForeground, ...theme.text.lead },
  form: { padding: theme.spacing[5], gap: theme.spacing[4] },
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
