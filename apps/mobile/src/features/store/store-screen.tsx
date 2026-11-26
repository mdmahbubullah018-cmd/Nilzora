import type { PublicStoreProfile } from '@nilzora/contracts';
import { Headset } from 'lucide-react-native';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { AppIcon, type IconName } from '@/components/icon';
import { QueryStateView } from '@/components/query-state';
import { Screen } from '@/components/screen';
import { useManualRefresh } from '@/query/use-manual-refresh';
import { theme } from '@/theme';
import { useStoreProfile } from './store-hooks';

/*
 * Contact and support.
 *
 * Every row comes from the store's published profile. Nothing is assumed: a field the store
 * left empty is not rendered, and a profile with no way to reach the store says exactly that
 * rather than showing a placeholder address or an invented phone number.
 */

/** One way to reach the store, already resolved to the URL the device should open. */
interface StoreContact {
  key: string;
  icon: IconName;
  label: string;
  value: string;
  url: string;
}

function rowsFor(profile: PublicStoreProfile): StoreContact[] {
  const rows: StoreContact[] = [];
  const email = profile.supportEmail ?? profile.contactEmail;
  const phone = profile.supportPhone ?? profile.contactPhone;
  if (email !== null) {
    rows.push({ key: 'email', icon: 'mail', label: 'Email', value: email, url: `mailto:${email}` });
  }
  if (phone !== null) {
    rows.push({
      key: 'phone',
      icon: 'phone',
      label: 'Phone',
      value: phone,
      url: `tel:${phone.replace(/\s+/g, '')}`,
    });
  }
  return rows;
}

/** The postal address, one entry per part the store filled in. */
function addressLines(profile: PublicStoreProfile): string[] {
  return [profile.addressLine, profile.addressArea, profile.addressDistrict].filter(
    (part): part is string => part !== null && part.trim() !== '',
  );
}

const SOCIAL_NETWORKS: readonly [keyof PublicStoreProfile['social'], string][] = [
  ['facebook', 'Facebook'],
  ['instagram', 'Instagram'],
  ['youtube', 'YouTube'],
];

function socialRows(profile: PublicStoreProfile): StoreContact[] {
  return SOCIAL_NETWORKS.flatMap(([network, label]) => {
    const url = profile.social[network];
    return url === null || url === undefined
      ? []
      : [{ key: network, icon: 'globe' as const, label, value: label, url }];
  });
}

/** Nothing published means nothing to open: the screen says so rather than guessing. */
function hasContactDetails(profile: PublicStoreProfile): boolean {
  return (
    rowsFor(profile).length > 0 ||
    addressLines(profile).length > 0 ||
    profile.businessHours !== null ||
    socialRows(profile).length > 0
  );
}

function open(url: string): void {
  // A device with no mail or dialler app cannot open this; the value stays readable above.
  void Linking.openURL(url).catch(() => undefined);
}

function ContactRow({ row }: { row: StoreContact }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${row.label}: ${row.value}`}
      accessibilityHint={`Opens this ${row.label.toLowerCase()} outside Nilzora`}
      android_ripple={{ color: theme.colors.border }}
      onPress={() => {
        open(row.url);
      }}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
    >
      <AppIcon name={row.icon} color={theme.colors.primary} />
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{row.label}</Text>
        <Text style={styles.rowValue}>{row.value}</Text>
      </View>
    </Pressable>
  );
}

function ProfileBody({ profile }: { profile: PublicStoreProfile }) {
  const contact = rowsFor(profile);
  const address = addressLines(profile);
  const social = socialRows(profile);
  const hours = profile.businessHours;

  return (
    <>
      <Card style={styles.padded}>
        {profile.logoUrl === null ? null : (
          <Image
            source={{ uri: profile.logoUrl }}
            style={styles.logo}
            resizeMode="contain"
            // The store's name is read out directly below, so the mark itself is decorative.
            accessible={false}
            testID="store-logo"
          />
        )}
        <Text accessibilityRole="header" style={styles.name}>
          {profile.displayName}
        </Text>
        {profile.tagline !== null ? <Text style={styles.tagline}>{profile.tagline}</Text> : null}
        {profile.description !== null ? (
          <Text style={styles.body}>{profile.description}</Text>
        ) : null}
      </Card>

      {hasContactDetails(profile) ? null : (
        <Card>
          <EmptyState
            icon={Headset}
            title="No contact details published yet"
            description="Nilzora has not published a way to get in touch. Your orders and returns stay available from your account."
          />
        </Card>
      )}

      {contact.length > 0 ? (
        <Card>
          <Text accessibilityRole="header" style={styles.cardTitle}>
            Talk to us
          </Text>
          {contact.map((row) => (
            <ContactRow key={row.key} row={row} />
          ))}
        </Card>
      ) : null}

      {address.length > 0 || hours !== null ? (
        <Card style={styles.padded}>
          <Text accessibilityRole="header" style={styles.chipTitle}>
            Visit us
          </Text>
          {address.length > 0 ? (
            <View style={styles.infoRow}>
              <AppIcon name="location" color={theme.colors.primary} />
              <Text style={styles.infoText}>{address.join(', ')}</Text>
            </View>
          ) : null}
          {hours !== null ? (
            <View style={styles.infoRow}>
              <AppIcon name="clock" color={theme.colors.primary} />
              <Text style={styles.infoText}>{hours}</Text>
            </View>
          ) : null}
        </Card>
      ) : null}

      {social.length > 0 ? (
        <Card>
          <Text accessibilityRole="header" style={styles.cardTitle}>
            Follow Nilzora
          </Text>
          {social.map((row) => (
            <ContactRow key={row.key} row={row} />
          ))}
        </Card>
      ) : null}
    </>
  );
}

/** Where a customer reaches the store: opened from the account tab. */
export function StoreScreen() {
  const query = useStoreProfile();
  const profile = query.data?.profile;
  const { onRefresh } = useManualRefresh(query.refetch);

  return (
    <Screen title="Contact & support" onRefresh={onRefresh}>
      {query.status === 'error' ? (
        <QueryStateView
          state="error"
          error={query.error}
          onRetry={() => void query.refetch()}
          retrying={query.isRefetching}
        />
      ) : profile === undefined ? (
        <QueryStateView state="loading" loadingLabel="Loading contact details" />
      ) : (
        <ProfileBody profile={profile} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  padded: { padding: theme.spacing[5], gap: theme.spacing[2] },
  logo: { width: 56, height: 56, alignSelf: 'flex-start' },
  name: {
    color: theme.colors.foreground,
    fontSize: theme.text.display.fontSize,
    lineHeight: theme.text.display.lineHeight,
    fontWeight: theme.text.display.fontWeight,
  },
  tagline: {
    color: theme.colors.mutedForeground,
    fontSize: theme.text.subheading.fontSize,
    lineHeight: theme.text.subheading.lineHeight,
  },
  body: {
    color: theme.colors.foreground,
    fontSize: theme.text.body.fontSize,
    lineHeight: theme.text.body.lineHeight,
  },
  cardTitle: {
    color: theme.colors.foreground,
    fontSize: theme.text.subheading.fontSize,
    fontWeight: theme.fontWeights.semibold,
    paddingHorizontal: theme.spacing[5],
    paddingTop: theme.spacing[5],
    paddingBottom: theme.spacing[2],
  },
  chipTitle: {
    color: theme.colors.foreground,
    fontSize: theme.text.subheading.fontSize,
    fontWeight: theme.fontWeights.semibold,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    minHeight: 56,
    paddingHorizontal: theme.spacing[5],
    paddingVertical: theme.spacing[2],
  },
  pressed: { backgroundColor: theme.colors.surfaceMuted },
  rowText: { flex: 1, gap: theme.spacing[1] },
  rowLabel: {
    color: theme.colors.mutedForeground,
    fontSize: theme.text.caption.fontSize,
    fontWeight: theme.text.caption.fontWeight,
  },
  rowValue: {
    color: theme.colors.foreground,
    fontSize: theme.text.body.fontSize,
    lineHeight: theme.text.body.lineHeight,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing[3],
  },
  infoText: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.text.body.fontSize,
    lineHeight: theme.text.body.lineHeight,
  },
});
