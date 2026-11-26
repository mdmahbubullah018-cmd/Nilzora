import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ActionResult } from '@/auth/session-manager';
import { useSession } from '@/auth/session-context';
import { AuthScaffold } from '@/components/auth-scaffold';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Notice } from '@/components/notice';
import { Screen, STACK_EDGES } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { authHref } from '@/lib/return-to';
import { theme } from '@/theme';

/** Asks for a password-reset code. The answer never reveals whether the address exists. */
export default function ForgotPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const { manager } = useSession();
  const [email, setEmail] = useState(typeof params.email === 'string' ? params.email : '');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ActionResult<'email'> | null>(null);

  async function submit() {
    if (manager === null || submitting) return;
    setSubmitting(true);
    setResult(null);
    try {
      const outcome = await manager.requestPasswordReset(email);
      setResult(outcome);
      if (outcome.ok) {
        // Go straight to where the code is entered, carrying the same address.
        router.push(authHref('/reset-password', null, email.trim().toLowerCase()));
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (manager === null) {
    return (
      <Screen edges={STACK_EDGES}>
        <Notice tone="danger" title="Password recovery is not available">
          This build has no valid API address (EXPO_PUBLIC_API_BASE_URL), so it cannot reach
          Nilzora.
        </Notice>
      </Screen>
    );
  }

  const fieldErrors = result && !result.ok ? result.fieldErrors : undefined;
  return (
    <AuthScaffold
      title="Forgot your password?"
      subtitle="Enter the email address on your Nilzora account and we will send a six-digit code so you can choose a new password."
      footer={
        <Button
          label="Back to sign in"
          variant="secondary"
          disabled={submitting}
          onPress={() => router.replace('/sign-in')}
        />
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
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          maxLength={254}
          editable={!submitting}
        />
        <Button label="Email me a code" loading={submitting} onPress={() => void submit()} />
      </Card>
      <View style={styles.note}>
        <Notice tone="info">
          The same answer is sent whether or not an account exists, so this cannot be used to check
          which addresses are registered.
        </Notice>
      </View>
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  form: { padding: theme.spacing[4], gap: theme.spacing[4] },
  note: { paddingTop: theme.spacing[1] },
});
