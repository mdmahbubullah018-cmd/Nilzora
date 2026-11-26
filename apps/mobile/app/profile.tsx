import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ActionResult, SessionManager, SessionUser } from '@/auth/session-manager';
import { useSession } from '@/auth/session-context';
import { SignedInGate } from '@/auth/signed-in-gate';
import { Avatar } from '@/components/avatar';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Notice } from '@/components/notice';
import { Screen, STACK_EDGES } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { AvatarSection } from '@/features/profile/avatar-section';
import { useSignOut } from '@/notifications/use-sign-out';
import { theme } from '@/theme';

/*
 * Profile details: the account's own name, picture and phone. Reached from the Account
 * center, which is where the rest of the account (orders, addresses, support) lives.
 */

type ProfileResult = ActionResult<'fullName' | 'phone'>;

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(date);
  } catch {
    return iso.slice(0, 10);
  }
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

interface ProfileFormProps {
  user: SessionUser;
  manager: SessionManager;
  result: ProfileResult | null;
  onResult: (result: ProfileResult | null) => void;
}

function ProfileForm({ user, manager, result, onResult }: ProfileFormProps) {
  const [fullName, setFullName] = useState(user.profile.fullName ?? '');
  const [phone, setPhone] = useState(user.profile.phone ?? '');
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);

  async function save() {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    onResult(null);
    try {
      onResult(await manager.updateProfile({ fullName, phone }));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  const fieldErrors = result && !result.ok ? result.fieldErrors : undefined;
  return (
    <Card style={styles.padded}>
      <Text accessibilityRole="header" style={styles.cardTitle}>
        Edit profile
      </Text>
      {result ? <Notice tone={result.ok ? 'success' : 'danger'}>{result.message}</Notice> : null}
      <TextField
        label="Full name"
        optional
        value={fullName}
        onChangeText={setFullName}
        error={fieldErrors?.fullName}
        autoComplete="name"
        textContentType="name"
        autoCapitalize="words"
        maxLength={120}
        editable={!saving}
      />
      <TextField
        label="Mobile number"
        optional
        hint="Bangladeshi mobile number, for example 01712345678. Leave empty to remove it."
        value={phone}
        onChangeText={setPhone}
        error={fieldErrors?.phone}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        maxLength={20}
        editable={!saving}
      />
      <Button label="Save changes" loading={saving} onPress={() => void save()} />
    </Card>
  );
}

function SignOutButton() {
  // Also removes this device's push token from the account before the session is cleared.
  const { signOut, signingOut } = useSignOut();

  return (
    <Button
      label="Sign out"
      variant="danger"
      loading={signingOut}
      accessibilityHint="Ends your session on this device"
      onPress={() => void signOut()}
    />
  );
}

function Details({ user, manager }: { user: SessionUser; manager: SessionManager }) {
  const { profile } = user;
  // Kept here: the form is re-created after a save, the outcome must survive that.
  const [result, setResult] = useState<ProfileResult | null>(null);
  const displayName = profile.fullName?.trim() || user.email || 'Nilzora customer';

  return (
    <>
      <Card style={styles.padded}>
        <View style={styles.identity}>
          <Avatar
            name={displayName}
            size="lg"
            tone="light"
            pictureUrl={profile.avatar?.thumbUrl ?? profile.googleAvatar}
          />
          <View style={styles.identityText}>
            <Text
              accessibilityRole="header"
              accessibilityLabel={`Name: ${displayName}`}
              numberOfLines={1}
              style={styles.name}
            >
              {displayName}
            </Text>
            {user.email ? (
              <Text
                accessibilityLabel={`Email: ${user.email}`}
                numberOfLines={1}
                style={styles.email}
              >
                {user.email}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.rows}>
          <SummaryRow label="Phone" value={profile.phone ?? 'Not added'} />
          <SummaryRow label="Member since" value={formatDate(profile.createdAt)} />
        </View>
      </Card>

      <AvatarSection
        name={displayName}
        currentUrl={profile.avatar?.thumbUrl ?? null}
        googleUrl={profile.googleAvatar}
        manager={manager}
      />

      {/* Re-initialised after every save so the fields show what the server stored. */}
      <ProfileForm
        key={profile.updatedAt}
        user={user}
        manager={manager}
        result={result}
        onResult={setResult}
      />

      <SignOutButton />
    </>
  );
}

export default function ProfileScreen() {
  const { state, manager } = useSession();

  return (
    <SignedInGate purpose="see and edit your profile" returnTo="/profile" edges={STACK_EDGES}>
      {state.status === 'signed_in' && manager !== null ? (
        <Screen edges={STACK_EDGES}>
          <Details user={state.user} manager={manager} />
        </Screen>
      ) : null}
    </SignedInGate>
  );
}

const styles = StyleSheet.create({
  padded: { padding: theme.spacing[5], gap: theme.spacing[4] },
  identity: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[4] },
  identityText: { flex: 1, gap: 2 },
  name: { color: theme.colors.foreground, ...theme.text.heading, fontSize: 19 },
  email: { color: theme.colors.mutedForeground, ...theme.text.body },
  rows: { gap: theme.spacing[3] },
  row: { gap: 2 },
  rowLabel: { color: theme.colors.mutedForeground, ...theme.text.caption },
  rowValue: { color: theme.colors.foreground, ...theme.text.body, fontSize: 15 },
  cardTitle: {
    color: theme.colors.foreground,
    ...theme.text.heading,
    fontSize: 17,
  },
});
