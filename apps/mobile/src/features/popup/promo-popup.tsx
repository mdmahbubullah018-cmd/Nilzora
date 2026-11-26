import { usePathname, useRouter } from 'expo-router';
import { X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/button';
import { useReduceMotion } from '@/components/use-reduce-motion';
import { bannerTarget } from '@/features/brands/brand-components';
import { useOverlayOwner } from '@/features/overlay/overlay-claim';
import { recordPopupShown } from './popup-history';
import { SwipeDismiss } from './swipe-dismiss';
import { usePromoPopup } from './use-promo-popup';
import { theme } from '@/theme';

/*
 * The promotional popup, inside the app.
 *
 * The server says which popup exists (switched on, inside its window); this component owns what
 * only the device knows — how long the customer has been in the app, and whether this launch has
 * already shown it.
 *
 *   delay      the popup's own delay (0 to 120 seconds), measured from the launch. A customer who leaves
 *              before then never sees it.
 *   frequency  once per session (this launch, in memory), once per day (device storage), or every
 *              visit. See `popup-history.ts`.
 *   never      on checkout or while signing in, and never while the launch sequence is on screen:
 *              the overlay claim decides that, not a guess about route names.
 *
 * The artwork is requested only when the popup opens, and its box is sized from the stored
 * dimensions first, so nothing jumps as the picture appears. Android's back button closes it, and
 * the picture's own animation is left alone: an animated GIF keeps animating.
 */

const QUIET_PREFIXES = [
  '/checkout',
  '/sign-in',
  '/register',
  '/verify-email',
  '/forgot-password',
  '/reset-password',
] as const;

function isQuietRoute(pathname: string): boolean {
  return QUIET_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function PromoPopup() {
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const overlayOwner = useOverlayOwner();
  const { popup, settled } = usePromoPopup();
  const [open, setOpen] = useState(false);
  const quiet = isQuietRoute(pathname);
  const blocked = quiet || overlayOwner !== null;
  const popupId = popup?.id ?? null;
  const delaySeconds = popup?.delaySeconds ?? 0;

  useEffect(() => {
    if (popupId === null || blocked) return;
    const timer = setTimeout(() => setOpen(true), delaySeconds * 1000);
    return () => clearTimeout(timer);
  }, [popupId, blocked, delaySeconds]);

  // The device's record is written as it opens, not as it closes: a customer who force-closes the
  // app on the popup has still been shown it.
  useEffect(() => {
    if (!open || popup === null) return;
    void recordPopupShown({
      id: popup.id,
      frequency: popup.frequency,
    });
  }, [open, popup]);

  if (popup === null || !settled || !open) return null;

  const dismiss = () => setOpen(false);
  // The sheet spans the screen's width on a phone and a comfortable column on a tablet; it is
  // measured once here because the picture's box is sized from it.
  const sheetWidth = Math.min(width, 520);
  const ratio =
    popup.imageWidth > 0 && popup.imageHeight > 0 ? popup.imageHeight / popup.imageWidth : 1;
  const available = height - insets.top - insets.bottom - 24;
  const pictureHeight = Math.min(
    sheetWidth * ratio,
    available * (popup.displayMode === 'artwork' ? 0.72 : 0.5),
  );
  const hasWords =
    popup.title !== null ||
    popup.subtitle !== null ||
    popup.description !== null ||
    (popup.buttonLabel !== null && popup.buttonHref !== null);

  const follow = () => {
    if (popup.buttonHref === null) return;
    setOpen(false);
    // A store path (the API refuses anything else), so nothing off-site can be opened here. It is
    // translated to the app's own screen, exactly as banner and onboarding links are.
    router.push(bannerTarget(popup.buttonHref));
  };

  const picture = (
    <Image
      source={{ uri: popup.imageUrl }}
      // An animated GIF animates in `Image` on Android. The picture is never cropped: the box is
      // the artwork's own proportion, capped so the sheet keeps room for its words, and anything
      // left over is the sheet's own surface rather than a cut-off campaign.
      resizeMode="contain"
      accessibilityIgnoresInvertColors
      accessible={popup.imageAlt !== null}
      accessibilityLabel={popup.imageAlt ?? undefined}
      style={{ width: sheetWidth, height: pictureHeight }}
    />
  );

  return (
    <Modal
      visible
      transparent
      // The device's own motion preference decides the transition; nothing moves when it is on.
      animationType={reduceMotion ? 'none' : 'slide'}
      statusBarTranslucent
      onRequestClose={dismiss}
    >
      {/* A Modal is its own native window: gestures need their own root inside it. */}
      <GestureHandlerRootView style={styles.backdrop}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close this promotion"
          onPress={dismiss}
          style={StyleSheet.absoluteFill}
        />
        <SwipeDismiss
          onDismiss={dismiss}
          // The sheet sits on the bottom edge and rises from it, the way a native shopping app
          // presents a campaign; only its top corners are rounded.
          style={[
            styles.sheet,
            { width: sheetWidth, paddingBottom: Math.max(insets.bottom, 12) },
            popup.displayMode === 'artwork' && styles.sheetArtwork,
          ]}
          testID="promo-popup"
        >
          <View style={styles.grabberRow} pointerEvents="none" aria-hidden>
            <View style={styles.grabber} />
          </View>
          {popup.buttonHref === null ? (
            picture
          ) : (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={popup.imageAlt ?? popup.buttonLabel ?? 'Open the promotion'}
              onPress={follow}
            >
              {picture}
            </Pressable>
          )}
          {/* Only the words that were actually filled in are drawn, so a picture-only popup has
              no empty block beneath it. */}
          {popup.displayMode === 'template' && hasWords ? (
            <View style={styles.copy}>
              {popup.title === null ? null : (
                <Text style={styles.title} numberOfLines={3}>
                  {popup.title}
                </Text>
              )}
              {popup.subtitle === null ? null : (
                <Text style={styles.subtitle}>{popup.subtitle}</Text>
              )}
              {popup.description === null ? null : (
                <Text style={styles.description}>{popup.description}</Text>
              )}
              {/* A label with nowhere to go is not a button: both halves are required, or neither. */}
              {popup.buttonLabel === null || popup.buttonHref === null ? null : (
                <Button label={popup.buttonLabel} onPress={follow} />
              )}
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close this promotion"
            onPress={dismiss}
            hitSlop={10}
            style={({ pressed }) => [styles.close, pressed && styles.closePressed]}
          >
            <X color={theme.brand.onSolid} size={16} strokeWidth={2.5} />
          </Pressable>
        </SwipeDismiss>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
  },
  sheet: {
    alignSelf: 'center',
    overflow: 'hidden',
    borderTopLeftRadius: theme.radii.hero,
    borderTopRightRadius: theme.radii.hero,
    backgroundColor: theme.colors.surface,
  },
  sheetArtwork: {
    backgroundColor: 'transparent',
  },
  /** The sheet's own handle: it says "this rises and can be pushed back down". */
  grabberRow: {
    position: 'absolute',
    top: 6,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 2,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(15, 23, 42, 0.25)',
  },
  copy: {
    gap: 6,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 6,
  },
  title: {
    ...theme.text.heading,
    color: theme.colors.foreground,
  },
  subtitle: {
    ...theme.text.bodyStrong,
    color: theme.colors.primary,
  },
  description: {
    ...theme.text.body,
    color: theme.colors.mutedForeground,
  },
  /** A 36dp glyph target on a barely-there navy glass disc: no ring, no heavy circle. */
  close: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: 'rgba(15, 23, 42, 0.25)',
  },
  closePressed: {
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
});
