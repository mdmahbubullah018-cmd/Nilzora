import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ActionResult } from '@/auth/session-manager';
import { useSession } from '@/auth/session-context';
import { AuthScaffold } from '@/components/auth-scaffold';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Notice } from '@/components/notice';
import { OtpField } from '@/components/otp-field';
import { PasswordField } from '@/components/password-field';
import { Screen, STACK_EDGES } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { authHref } from '@/lib/return-to';
import { theme } from '@/theme';

/** Shown when the two password fields differ; the API is never asked in that case. */
export const PASSWORD_MISMATCH = 'The two passwords do not match.';

/**
 * Sets a new password from a reset code. Every session for the account ends, so the
 * customer signs in again with the new password.
 */
export default function ResetPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const { manager } = useSession();
  const [email, setEmail] = useState(typeof params.email === 'string' ? params.email : '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [confirmationError, setConfirmationError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ActionResult<'email' | 'code' | 'password'> | null>(null);

  async function submit() {
    if (manager === null || submitting) return;
    // Checked here, before any request: a typo in the confirmation must not change the
    // password to something the customer did not intend.
    if (password !== confirmation) {
      setConfirmationError(PASSWORD_MISMATCH);
      return;
    }
    setConfirmationError(undefined);
    setSubmitting(true);
    setResult(null);
    try {
      const outcome = await manager.resetPassword(email, code, password);
      if (outcome.ok) {
        setCode('');
        setPassword('');
        setConfirmation('');
        router.replace(authHref('/sign-in', null, undefined));
      }
      setResult(outcome);
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
      eyebrow="Almost there"
      title="Choose a new password"
      subtitle="Enter the six-digit code we emailed you, then pick a password you have not used before. This signs out every other device."
      footer={
        <Button
          label="Need a new code?"
          variant="secondary"
          disabled={submitting}
          onPress={() => router.replace(authHref('/forgot-password', null, email))}
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
          maxLength={254}
          editable={!submitting}
        />
        <OtpField
          value={code}
          onChange={setCode}
          error={fieldErrors?.code}
          label="Reset code"
          hint="Six digits from the email."
          editable={!submitting}
        />
        <PasswordField
          label="New password"
          hint="At least 8 characters, with letters and numbers."
          value={password}
          onChangeText={(text) => {
            setPassword(text);
            setConfirmationError(undefined);
          }}
          error={fieldErrors?.password}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="new-password"
          textContentType="newPassword"
          maxLength={128}
          editable={!submitting}
        />
        <PasswordField
          label="Confirm new password"
          value={confirmation}
          onChangeText={(text) => {
            setConfirmation(text);
            setConfirmationError(undefined);
          }}
          error={confirmationError}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          maxLength={128}
          editable={!submitting}
        />
        <Button label="Set new password" loading={submitting} onPress={() => void submit()} />
      </Card>
      <View style={styles.note}>
        <Notice tone="info">
          The code is single use and expires ten minutes after it was sent.
        </Notice>
      </View>
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  form: { padding: theme.spacing[4], gap: theme.spacing[4] },
  note: { paddingTop: theme.spacing[1] },
});
