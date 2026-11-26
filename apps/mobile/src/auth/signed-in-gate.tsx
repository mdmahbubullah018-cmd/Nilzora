import { useRouter } from 'expo-router';
import { CloudOff, Settings, UserRound } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { Notice } from '@/components/notice';
import { Screen, TAB_EDGES } from '@/components/screen';
import { TAB_BAR_SPACE } from '@/components/tab-bar';
import { authHref } from '@/lib/return-to';
import { useSignOut } from '@/notifications/use-sign-out';
import { theme } from '@/theme';
import { useSession } from './session-context';

export interface SignedInGateProps {
  /** The screen's content, rendered only for a signed-in customer. */
  children: ReactNode;
  /** Title of the screen, shown above the state card when the gate frames the screen itself. */
  title?: string;
  /** What the account is needed for, completing "Sign in or create an account to …". */
  purpose?: string;
  /**
   * The route to come back to after signing in or registering, e.g. "/orders" or "/checkout".
   * It is validated against the app's own routes; anything else is ignored.
   */
  returnTo?: string;
  /**
   * `false` (default): when nobody is signed in the gate renders its own <Screen>, so wrap
   * the whole screen: <SignedInGate title="Orders" returnTo="/orders"><OrdersScreen/></SignedInGate>.
   * `true`: render the state cards bare, for use inside a screen you already framed.
   */
  bare?: boolean;
  /** Header content for the framed state screen (a tab header, for example). */
  header?: ReactNode;
  /**
   * Space under the content. Defaults to the floating tab bar's height on tab screens, and
   * to none on stack screens (which have no bar), so a gated screen is never covered.
   */
  bottomSpace?: number;
  /** Safe-area edges for the framed state screen. Tab screens pad the top (default), stack screens the bottom. */
  edges?: readonly Edge[];
}

/**
 * Shows `children` to a signed-in customer and an explanation to everyone else: still
 * checking the saved session, no API address, offline (with retry), suspended, or signed
 * out (with Sign in and Create account, both carrying `returnTo`). The server remains the
 * authority on every protected call; the gate only keeps screens from asking pointlessly.
 */
export function SignedInGate({
  children,
  title,
  purpose = 'continue',
  returnTo,
  bare = false,
  header,
  bottomSpace,
  edges = TAB_EDGES,
}: SignedInGateProps) {
  const { state, manager } = useSession();
  if (state.status === 'signed_in') return <>{children}</>;

  let card: ReactNode;
  if (state.status === 'unconfigured' || manager === null) {
    card = (
      <Card>
        <EmptyState
          icon={Settings}
          title="Sign-in is not available"
          description="This build has no valid API address (EXPO_PUBLIC_API_BASE_URL), so it cannot reach Nilzora."
        />
      </Card>
    );
  } else if (state.status === 'restoring') {
    card = (
      <Card style={styles.padded}>
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Checking your sign-in"
          style={styles.loading}
        >
          <ActivityIndicator color={theme.colors.link} />
          <Text style={styles.muted}>Checking your sign-in…</Text>
        </View>
      </Card>
    );
  } else if (state.status === 'offline') {
    card = (
      <>
        <Card>
          <EmptyState
            icon={CloudOff}
            title="Nilzora could not be reached"
            description="Your account could not be checked right now. Check your connection, then try again."
          />
        </Card>
        <Button label="Try again" onPress={() => void manager.restore()} />
      </>
    );
  } else if (state.status === 'suspended') {
    card = (
      <>
        <Notice tone="danger" title="Account suspended">
          This account is suspended. Contact Nilzora support for help.
        </Notice>
        <SignOutButton />
      </>
    );
  } else {
    card = <SignedOutCard notice={state.notice} purpose={purpose} returnTo={returnTo} />;
  }

  if (bare) return <>{card}</>;
  // A tab screen sits under the floating bar; a stack screen does not.
  const space = bottomSpace ?? (edges === TAB_EDGES ? TAB_BAR_SPACE : 0);
  return (
    <Screen title={title} header={header} edges={edges} bottomSpace={space} testID="signed-in-gate">
      {card}
    </Screen>
  );
}

function SignedOutCard({
  notice,
  purpose,
  returnTo,
}: {
  notice: string | undefined;
  purpose: string;
  returnTo: string | undefined;
}) {
  const router = useRouter();
  return (
    <>
      {notice ? <Notice tone="warning">{notice}</Notice> : null}
      <Card>
        <EmptyState
          icon={UserRound}
          title="Sign in to Nilzora"
          description={`Sign in or create an account to ${purpose}.`}
        />
        <View style={styles.actions}>
          <Button label="Sign in" onPress={() => router.push(authHref('/sign-in', returnTo))} />
          <Button
            label="Create account"
            variant="secondary"
            onPress={() => router.push(authHref('/register', returnTo))}
          />
        </View>
      </Card>
    </>
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

const styles = StyleSheet.create({
  padded: { padding: theme.spacing[5], gap: theme.spacing[4] },
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[3],
    minHeight: theme.touchTarget,
  },
  muted: { color: theme.colors.mutedForeground, fontSize: 14 },
  actions: {
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[5],
    paddingBottom: theme.spacing[6],
  },
});
