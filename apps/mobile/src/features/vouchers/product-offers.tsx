import type { Voucher } from '@nilzora/contracts';
import { usePathname, useRouter } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSignedInUserId } from '@/auth/session-context';
import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { SCREEN_PADDING } from '@/features/catalog/catalog-layout';
import { describeApiError } from '@/lib/errors';
import { formatMoney } from '@/lib/money';
import { authHref } from '@/lib/return-to';
import { theme } from '@/theme';
import { rememberPendingCollect, takePendingCollect } from './pending-collect';
import { VoucherAction } from './voucher-actions';
import { VoucherTicket, voucherDiscount, voucherEligibility } from './voucher-card';
import { useCollectVoucher, useProductVouchers, voucherUseHref } from './voucher-hooks';

/*
 * Vouchers on a product: one row of compact tickets built from the same parts as the Voucher
 * Center's ticket (a primary stub with the offer, a perforated seam, the store's surface and its
 * two button styles), with the exact list — complete terms, dates and the Voucher Center — in a
 * native sheet. A phone shows one whole ticket and about 30% of the next, so the row visibly
 * continues; a swipe settles on a ticket.
 *
 * Everything comes from the product-voucher answer; the strip only hides what can no longer be
 * used and never decides applicability itself. Nothing renders while the offers are loading,
 * when the read failed, or when nothing applies.
 */

/** The row shows a handful; the sheet shows every applicable voucher. */
const STRIP_LIMIT = 6;
/** Space between two tickets. */
const GAP = 8;
/** One whole card plus 30% of the next: the share of the row a card takes. */
const CARD_SHARE = 1.3;
/** The tallest the row gets on a tablet, so a card never becomes a poster. */
const MAX_CARD_WIDTH = 380;

/** The width of one ticket: one whole card and a slice of the next fill the screen. */
export function voucherCardWidth(windowWidth: number): number {
  const available = windowWidth - SCREEN_PADDING * 2 - GAP;
  return Math.min(Math.max(available / CARD_SHARE, 232), MAX_CARD_WIDTH);
}

const EXPIRY = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'Asia/Dhaka',
});

/** "Min. spend ৳500", or a plain statement when there is no minimum. */
function minimumSpend(voucher: Voucher): string {
  return voucher.minOrderMinor > 0
    ? `Min. spend ${formatMoney(voucher.minOrderMinor)}`
    : 'No minimum spend';
}

/** "Till 30 Nov" or "No expiry", on the shop's own clock. */
function expiryLabel(voucher: Voucher): string {
  if (!voucher.endsAt) return 'No expiry';
  const date = new Date(voucher.endsAt);
  return Number.isNaN(date.getTime()) ? 'No expiry' : `Till ${EXPIRY.format(date)}`;
}

/**
 * The second line of a ticket: the minimum spend first, then what the voucher covers. The
 * minimum leads, so it stays readable when the tail is shortened; the admin's description and
 * the full conditions are in the expanded sheet.
 */
function secondLine(voucher: Voucher): string {
  return `${minimumSpend(voucher)} · ${voucherEligibility(voucher)}`;
}

/** Whether a voucher can still be collected and used on this product. */
function looksApplicable(voucher: Voucher): boolean {
  return (
    voucher.state !== 'expired' && voucher.state !== 'used' && voucher.state !== 'fully_collected'
  );
}

export function ProductOffers({ slug }: { slug: string }) {
  const router = useRouter();
  const returnTo = usePathname();
  const { width } = useWindowDimensions();
  const cardWidth = voucherCardWidth(width);
  const userId = useSignedInUserId();
  const { data } = useProductVouchers(slug);
  const collect = useCollectVoucher();
  const { mutate } = collect;
  const inFlight = useRef(false);
  const [collected, setCollected] = useState<ReadonlySet<string>>(() => new Set());
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toast, setToast] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  const applicable = useMemo(() => (data ?? []).filter(looksApplicable), [data]);
  const strip = applicable.slice(0, STRIP_LIMIT);

  const stateOf = useCallback(
    (voucher: Voucher): Voucher =>
      voucher.state === 'available' && collected.has(voucher.id)
        ? { ...voucher, state: 'collected' }
        : voucher,
    [collected],
  );

  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  const markCollected = useCallback((voucherId: string) => {
    setCollected((previous) => new Set(previous).add(voucherId));
    setToast({ tone: 'success', message: 'Voucher collected' });
  }, []);

  /**
   * Collects a voucher. A guest is sent to sign in first and the choice is remembered, so the
   * same product completes the collection when they return. A signed-in customer sees the
   * ticket turn "Collected" at once; a refusal puts it back and says why.
   */
  const runCollect = useCallback(
    (voucher: Voucher) => {
      if (userId === null) {
        rememberPendingCollect(slug, voucher.id);
        router.push(authHref('/sign-in', returnTo));
        return;
      }
      if (inFlight.current) return;
      inFlight.current = true;
      setPendingId(voucher.id);
      markCollected(voucher.id);
      mutate(voucher.id, {
        onError: (error) => {
          setCollected((previous) => {
            const next = new Set(previous);
            next.delete(voucher.id);
            return next;
          });
          setToast({
            tone: 'error',
            message:
              (error as { code?: string }).code === 'voucher_unavailable'
                ? 'This voucher cannot be collected on your account right now.'
                : describeApiError(error).message,
          });
        },
        onSettled: () => {
          inFlight.current = false;
          setPendingId(null);
        },
      });
    },
    [markCollected, mutate, returnTo, router, slug, userId],
  );

  // Back from signing in: finish the collection the guest started, once.
  useEffect(() => {
    if (userId === null || data === undefined) return;
    const waiting = takePendingCollect(slug);
    if (waiting === null) return;
    // A tick later, so the collection is a normal event rather than a state update inside
    // this effect.
    const timer = setTimeout(() => {
      const target = data.find(
        (voucher) => voucher.id === waiting && voucher.state === 'available',
      );
      if (target === undefined) {
        setToast({ tone: 'error', message: 'That voucher is no longer available.' });
        return;
      }
      runCollect(target);
    }, 0);
    return () => clearTimeout(timer);
  }, [userId, data, slug, runCollect]);

  if (applicable.length === 0) return null;

  return (
    <View style={styles.block}>
      <View style={styles.separator} />

      <View style={styles.headerRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Vouchers"
          accessibilityHint="Opens every voucher that applies to this product"
          onPress={() => setSheetOpen(true)}
          hitSlop={6}
          style={({ pressed }) => [styles.header, pressed ? styles.headerPressed : null]}
        >
          <Text style={styles.title}>Vouchers</Text>
          <ChevronRight size={16} color={theme.colors.navy} accessible={false} />
        </Pressable>
      </View>

      <FlatList
        testID="product-voucher-row"
        accessibilityLabel="Vouchers"
        data={strip}
        keyExtractor={(voucher) => voucher.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={cardWidth + GAP}
        snapToAlignment="start"
        style={styles.row}
        contentContainerStyle={styles.rowContent}
        ItemSeparatorComponent={VoucherGap}
        getItemLayout={(_, index) => ({
          length: cardWidth + GAP,
          offset: (cardWidth + GAP) * index,
          index,
        })}
        renderItem={({ item }) => {
          const shown = stateOf(item);
          return (
            <CompactVoucher
              voucher={item}
              width={cardWidth}
              collected={shown.state === 'collected'}
              upcoming={item.state === 'upcoming'}
              pending={pendingId === item.id}
              onCollect={() => runCollect(item)}
              onUse={() => {
                router.push(voucherUseHref(item));
              }}
            />
          );
        }}
      />

      <BottomSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Vouchers"
        testID="product-voucher-sheet"
        footer={
          <Button
            label="Open the Voucher Center"
            variant="secondary"
            onPress={() => {
              setSheetOpen(false);
              router.push('/vouchers');
            }}
          />
        }
      >
        <View style={styles.sheetBody}>
          {applicable.map((voucher) => {
            const shown = stateOf(voucher);
            return (
              <VoucherTicket
                key={voucher.id}
                voucher={shown}
                action={
                  <VoucherAction
                    voucher={shown}
                    returnTo={returnTo}
                    onCollected={() => markCollected(voucher.id)}
                  />
                }
              />
            );
          })}
          <Text style={styles.sheetNote}>
            Collect a voucher here, then choose it at checkout. One voucher or one coupon code per
            order.
          </Text>
        </View>
      </BottomSheet>

      {toast === null ? null : <SectionToast tone={toast.tone} message={toast.message} />}
    </View>
  );
}

function VoucherGap(): ReactNode {
  return <View style={styles.gap} />;
}

/**
 * One compact ticket: the offer on a primary stub (as the Voucher Center's ticket draws it),
 * then the title, the minimum spend and coverage, and the expiry beside the action.
 */
function CompactVoucher({
  voucher,
  width,
  collected,
  upcoming,
  pending,
  onCollect,
  onUse,
}: {
  voucher: Voucher;
  width: number;
  collected: boolean;
  /** Not started yet: shown, but nothing can be collected until it opens. */
  upcoming: boolean;
  pending: boolean;
  onCollect: () => void;
  /** The existing voucher-usage path: its qualifying category or product, else the shop. */
  onUse: () => void;
}): ReactNode {
  return (
    <View
      accessible={false}
      style={[styles.card, { width }]}
      testID={`product-voucher-${voucher.id}`}
    >
      <View style={styles.stub}>
        <Text style={styles.stubEyebrow} numberOfLines={1}>
          VOUCHER
        </Text>
        <Text style={styles.stubValue} numberOfLines={1} adjustsFontSizeToFit>
          {voucherDiscount(voucher)}
        </Text>
        <Text style={styles.stubLabel} numberOfLines={1}>
          {voucher.kind === 'free_delivery' ? 'DELIVERY' : 'OFF'}
        </Text>
        <View style={[styles.notch, styles.notchTop]} />
        <View style={[styles.notch, styles.notchBottom]} />
        <View style={styles.perforation} />
      </View>

      <View style={styles.body}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {voucher.title}
        </Text>
        <Text style={styles.cardDescription} numberOfLines={1}>
          {secondLine(voucher)}
        </Text>
        <View style={styles.cardFooter}>
          <Text style={styles.expiry} numberOfLines={1}>
            {expiryLabel(voucher)}
          </Text>
          <VoucherActionPill
            collected={collected}
            upcoming={upcoming}
            pending={pending}
            onCollect={onCollect}
            onUse={onUse}
          />
        </View>
      </View>
    </View>
  );
}

/**
 * The ticket's action, in the Voucher Center's two styles: a filled Collect and an outlined
 * Use. A collected voucher opens its existing usage path; a guest's Collect is handled by the
 * caller (sign in, then return here); one that has not opened yet is not pressable. The pill is
 * 28dp tall with a press area that reaches 44dp.
 */
function VoucherActionPill({
  collected,
  upcoming,
  pending,
  onCollect,
  onUse,
}: {
  collected: boolean;
  upcoming: boolean;
  pending: boolean;
  onCollect: () => void;
  onUse: () => void;
}): ReactNode {
  if (collected) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Use voucher"
        accessibilityHint="Shows the products this voucher applies to"
        onPress={onUse}
        hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
        style={({ pressed }) => [
          styles.pill,
          styles.pillOutline,
          pressed ? styles.pillPressed : null,
        ]}
      >
        <Text style={[styles.pillText, styles.pillTextOutline]}>Use</Text>
      </Pressable>
    );
  }
  if (upcoming) {
    return (
      <View style={[styles.pill, styles.pillUpcoming]}>
        <Text style={styles.pillTextMuted}>Soon</Text>
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Collect voucher"
      accessibilityHint="Saves this voucher to your account for checkout"
      accessibilityState={{ busy: pending }}
      disabled={pending}
      onPress={onCollect}
      hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
      style={({ pressed }) => [
        styles.pill,
        styles.pillSolid,
        pressed && !pending ? styles.pillPressedSolid : null,
        pending ? styles.pillBusy : null,
      ]}
    >
      {pending ? (
        <ActivityIndicator size="small" color={theme.colors.primaryActionForeground} />
      ) : (
        <Text style={styles.pillText}>Collect</Text>
      )}
    </Pressable>
  );
}

/** A short confirmation that floats over the strip and disappears on its own. */
function SectionToast({
  tone,
  message,
}: {
  tone: 'success' | 'error';
  message: string;
}): ReactNode {
  return (
    <View pointerEvents="none" style={styles.toastWrap}>
      <View
        accessibilityLiveRegion="polite"
        style={[styles.toast, tone === 'error' ? styles.toastError : null]}
      >
        <Text style={styles.toastText}>{message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: theme.spacing[2], position: 'relative' },
  // The 8dp band that sets the offers apart from the purchase controls above them.
  separator: {
    height: 8,
    marginHorizontal: -theme.spacing[5],
    backgroundColor: '#F1F5F9',
  },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minHeight: 32,
  },
  headerPressed: { opacity: 0.65 },
  title: {
    color: theme.colors.navy,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: theme.fontWeights.medium,
  },

  row: { marginHorizontal: -theme.spacing[2] },
  rowContent: { paddingHorizontal: 12, paddingVertical: 2 },
  gap: { width: GAP },

  // The same surface language as the Voucher Center's ticket, one step smaller.
  card: {
    height: 96,
    flexDirection: 'row',
    borderRadius: theme.radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
    ...theme.shadow.card,
  },
  stub: {
    width: 76,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    paddingHorizontal: 4,
    backgroundColor: theme.colors.primary,
  },
  stubEyebrow: {
    color: '#E0F2FE',
    fontSize: 8.5,
    lineHeight: 11,
    fontWeight: theme.fontWeights.semibold,
    letterSpacing: 1.4,
  },
  stubValue: {
    color: theme.brand.onSolid,
    fontSize: 20,
    lineHeight: 23,
    fontWeight: theme.fontWeights.bold,
    letterSpacing: -0.3,
  },
  stubLabel: {
    color: theme.brand.onSolid,
    fontSize: 9.5,
    lineHeight: 12,
    fontWeight: theme.fontWeights.semibold,
    letterSpacing: 1.2,
  },
  notch: {
    position: 'absolute',
    right: -5,
    width: 10,
    height: 10,
    borderRadius: 5,
    // The page shows through the ticket's cut-outs.
    backgroundColor: theme.colors.background,
  },
  notchTop: { top: -5 },
  notchBottom: { bottom: -5 },
  perforation: {
    position: 'absolute',
    right: 0,
    top: 12,
    bottom: 12,
    borderRightWidth: 2,
    borderStyle: 'dashed',
    borderColor: 'rgba(255, 255, 255, 0.45)',
  },

  body: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'space-between',
    paddingVertical: theme.spacing[2],
    paddingLeft: theme.spacing[3],
    paddingRight: theme.spacing[2] + 2,
    gap: 2,
  },
  cardTitle: {
    color: theme.colors.foreground,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: theme.fontWeights.semibold,
  },
  cardDescription: { color: theme.colors.mutedForeground, fontSize: 11, lineHeight: 15 },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
    minHeight: 28,
  },
  expiry: {
    flexShrink: 1,
    color: theme.colors.mutedForeground,
    fontSize: 10.5,
    lineHeight: 14,
  },
  pill: {
    minHeight: 28,
    minWidth: 68,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.radii.full,
  },
  pillSolid: { backgroundColor: theme.colors.primaryAction },
  pillPressedSolid: { backgroundColor: theme.colors.primaryActionHover },
  pillPressed: { backgroundColor: theme.colors.iconSurface },
  pillOutline: {
    borderWidth: 1.5,
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.surface,
  },
  pillUpcoming: { backgroundColor: theme.colors.surfaceMuted },
  pillBusy: { opacity: 0.8 },
  pillText: {
    color: theme.colors.primaryActionForeground,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: theme.fontWeights.semibold,
  },
  pillTextOutline: { color: theme.colors.primary },
  pillTextMuted: {
    color: theme.colors.mutedForeground,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: theme.fontWeights.semibold,
  },

  sheetBody: { gap: theme.spacing[3] },
  sheetNote: {
    color: theme.colors.mutedForeground,
    ...theme.text.caption,
    lineHeight: 18,
    paddingTop: theme.spacing[1],
  },

  toastWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 72,
    alignItems: 'center',
    zIndex: 2,
  },
  toast: {
    borderRadius: theme.radii.full,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    backgroundColor: theme.colors.navy,
    ...theme.shadow.floating,
  },
  toastError: { backgroundColor: theme.colors.fieldError },
  toastText: { color: theme.brand.onSolid, ...theme.text.caption },
});
