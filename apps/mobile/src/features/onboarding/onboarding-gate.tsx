import { usePathname, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { claimOverlay } from '@/features/overlay/overlay-claim';
import { onSplashFinished } from '@/startup/splash-state';
import { BrandOnboarding } from './brand-onboarding';
import { brandIntroSeen, completeBrandIntro } from './brand-intro-store';
import { OnboardingScreen } from './onboarding-screen';
import { useCompleteOnboarding, useOnboarding } from './use-onboarding';

/**
 * The one launch sequence, shown over the app.
 *
 * It sits above the navigator instead of being a route, so:
 * - a deep link, a notification or a restored screen is untouched behind it;
 * - there is one launch sequence, not a splash screen followed by a route;
 * - closing it lands on the store home without leaving an entry in the history.
 *
 * Two things can appear here, never at once:
 * 1. The app's own four-screen introduction, on the first launch of this install. It is read
 *    from device storage, so it is on screen before any request finishes and needs no network.
 * 2. The Admin-managed campaign, under the frequency rules the server applies. A launch that
 *    shows the introduction holds the campaign back until a later launch, so a first-time
 *    customer is never shown two introductions in a row.
 *
 * Nothing renders until the introduction's state has been read, so nobody sees a flash of the
 * wrong overlay.
 */
export function OnboardingGate() {
  const router = useRouter();
  const pathname = usePathname();
  const { campaign, settled } = useOnboarding();
  const complete = useCompleteOnboarding();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [intro, setIntro] = useState<'checking' | 'due' | 'done'>('checking');
  const [campaignHeld, setCampaignHeld] = useState(false);

  // The launch no longer waits for the campaign lookup. A campaign that is not known by the
  // time the splash leaves is held back for this launch, so it never pops up over a shop the
  // customer has already started using; the next launch asks again under the same rules. The
  // decision is taken once, at the moment the splash leaves (never when there is no splash).
  const settledNow = useRef(settled);
  useEffect(() => {
    settledNow.current = settled;
  }, [settled]);
  useEffect(
    () =>
      onSplashFinished(() => {
        if (!settledNow.current) setCampaignHeld(true);
      }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    brandIntroSeen()
      .then((seen) => {
        if (!cancelled) setIntro(seen ? 'done' : 'due');
      })
      .catch(() => {
        // Storage unavailable: go straight to the app rather than block the launch.
        if (!cancelled) setIntro('done');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const finishIntro = useCallback(() => {
    // Close first: the introduction must never stay on screen because storage is slow.
    setIntro('done');
    setCampaignHeld(true);
    void completeBrandIntro();
  }, []);

  const handleFinish = useCallback(
    (destination?: Href) => {
      if (campaign === null) return;
      const campaignId = campaign.id;
      // Close first: the sequence must never stay on screen because a request is slow.
      setDismissed(campaignId);
      void complete(campaignId).catch(() => {
        // Recording failed; the campaign may appear again on a later launch, which is
        // better than pretending it was stored.
      });
      if (destination !== undefined) {
        router.push(destination);
        return;
      }
      if (pathname !== '/') router.replace('/');
    },
    [campaign, complete, pathname, router],
  );

  /*
   * Whether the launch sequence is on screen. Computed before the returns below, because the
   * overlay claim is a hook and must run on every render of this component.
   */
  const campaignVisible =
    intro !== 'due' &&
    !campaignHeld &&
    settled &&
    campaign !== null &&
    campaign.slides.length > 0 &&
    campaign.id !== dismissed;
  const overlayVisible = intro === 'due' || campaignVisible;

  // While the launch sequence holds the screen, the promotional popup waits its turn.
  useEffect(() => {
    if (!overlayVisible) return;
    return claimOverlay('onboarding');
  }, [overlayVisible]);

  if (intro === 'checking') return null;
  if (intro === 'due') {
    return (
      <View style={styles.overlay} testID="brand-intro-overlay">
        <BrandOnboarding onFinish={finishIntro} />
      </View>
    );
  }

  if (!campaignVisible || campaign === null) return null;

  return (
    <View style={styles.overlay} testID="onboarding-overlay">
      <OnboardingScreen campaign={campaign} onFinish={handleFinish} />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 10,
    // Android orders views by elevation before zIndex: without this, the floating tab bar
    // (elevation 12) took taps meant for the campaign's bottom button.
    elevation: 50,
  },
});
