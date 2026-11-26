import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Logo } from '@/components/logo';
import { useReduceMotion } from '@/components/use-reduce-motion';
import { curves } from '@/components/motion-curves';
import { theme } from '@/theme';
import { Backdrop, INTRO_COLORS, PagerDots, PillButton } from './brand-onboarding-parts';
import { ONBOARDING_COPY, type OnboardingCopy, type OnboardingStep } from './onboarding-copy';
import { StepDemo } from './onboarding-demos';

/*
 * The first-launch tutorial: five steps, one idea each, shown on a miniature of the screen
 * they describe.
 *
 * What the customer can do, in order of discovery: swipe; tap Next; tap the last step's
 * "Start shopping"; step back with Previous or the Android Back button; or leave with Skip.
 * The dots follow the pager itself (not the last button pressed), so they stay right when a
 * swipe, a Next tap and a Back press happen in quick succession. Nothing is timed: the screen
 * never advances on its own.
 *
 * The copy is English only, like the rest of the shop.
 *
 * The look is flat and colourful: each step has its own soft wash that cross-fades with the
 * swipe, the miniature screen fades and lifts in, and the copy follows a beat later. Every
 * animation is transform/opacity on the native driver except the page dots. With "reduce
 * motion" on, nothing floats or slides.
 */

export interface BrandOnboardingProps {
  /** Called once, whether the customer finished the last step or skipped it. */
  onFinish: () => void;
}

export function BrandOnboarding({ onFinish }: BrandOnboardingProps) {
  const { width } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const pager = useRef<ScrollViewInstance>(null);
  const [scrollX] = useState(() => new Animated.Value(0));
  const [index, setIndex] = useState(0);
  const finished = useRef(false);

  const copy = ONBOARDING_COPY;
  const last = copy.steps.length - 1;
  const onLast = index >= last;

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    onFinish();
  }, [onFinish]);

  const goTo = useCallback(
    (target: number) => {
      const next = Math.max(0, Math.min(last, target));
      const node = pager.current;
      if (node !== null && typeof node.scrollTo === 'function') {
        node.scrollTo({ x: next * width, animated: !reduceMotion });
      }
      setIndex(next);
    },
    [last, reduceMotion, width],
  );

  // Android Back steps back through the tutorial; on the first step it does what it always did.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (index === 0) return false;
      goTo(index - 1);
      return true;
    });
    return () => {
      subscription.remove();
    };
  }, [goTo, index]);

  // Say each step's headline once, so a screen-reader user knows the page changed.
  useEffect(() => {
    const step = copy.steps[index];
    if (step !== undefined && index > 0) AccessibilityInfo.announceForAccessibility(step.title);
  }, [copy.steps, index]);

  const onScroll = Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
    useNativeDriver: true,
  });

  return (
    <View style={styles.root}>
      <Backdrop scrollX={scrollX} width={width} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']} accessibilityViewIsModal>
        <View style={styles.header}>
          <Logo size="sm" decorative />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.skip}
            accessibilityHint={copy.skipHint}
            hitSlop={10}
            onPress={finish}
            style={styles.skip}
          >
            <Text style={styles.skipText}>{copy.skip}</Text>
          </Pressable>
        </View>

        <Animated.ScrollView
          ref={pager}
          testID="brand-intro-pager"
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          bounces={false}
          overScrollMode="never"
          scrollEventThrottle={16}
          onScroll={onScroll}
          onMomentumScrollEnd={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
            const page = Math.round(event.nativeEvent.contentOffset.x / width);
            setIndex(Math.max(0, Math.min(last, page)));
          }}
        >
          {copy.steps.map((step, slideIndex) => (
            <IntroSlide
              key={step.id}
              step={step}
              copy={copy}
              slideIndex={slideIndex}
              width={width}
              scrollX={scrollX}
              active={slideIndex === index}
              reduceMotion={reduceMotion}
            />
          ))}
        </Animated.ScrollView>

        <View style={styles.footer}>
          <PagerDots
            count={copy.steps.length}
            activeIndex={index}
            reduceMotion={reduceMotion}
            accessibilityLabel={copy.progressLabel}
          />
          <View style={styles.controls}>
            {index > 0 ? (
              <View style={styles.back}>
                <PillButton
                  label={copy.previous}
                  tone="quiet"
                  accessibilityHint={copy.previousHint}
                  onPress={() => goTo(index - 1)}
                />
              </View>
            ) : null}
            <View style={styles.next}>
              {onLast ? (
                <PillButton label={copy.start} tone="primary" onPress={finish} />
              ) : (
                <PillButton
                  label={copy.next}
                  tone="primary"
                  accessibilityHint={copy.nextHint}
                  onPress={() => goTo(index + 1)}
                />
              )}
            </View>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

interface IntroSlideProps {
  step: OnboardingStep;
  copy: OnboardingCopy;
  slideIndex: number;
  width: number;
  scrollX: Animated.Value;
  active: boolean;
  reduceMotion: boolean;
}

function IntroSlide({ step, copy, slideIndex, width, scrollX, active, reduceMotion }: IntroSlideProps) {
  // 0 -> 1 each time this step becomes the current one: the demo first, then the headline,
  // then the copy, a beat apart.
  const [enter] = useState(() => new Animated.Value(slideIndex === 0 ? 0 : 1));

  useEffect(() => {
    if (!active) return;
    if (reduceMotion) {
      enter.setValue(1);
      return;
    }
    enter.setValue(0);
    const animation = Animated.timing(enter, {
      toValue: 1,
      duration: 560,
      easing: curves.outCubic,
      useNativeDriver: true,
    });
    animation.start();
    return () => {
      animation.stop();
    };
  }, [active, enter, reduceMotion]);

  const range = [(slideIndex - 1) * width, slideIndex * width, (slideIndex + 1) * width];

  /** Fades with the pager, then lifts in when the step becomes current. */
  const reveal = (delay: number) => ({
    opacity: Animated.multiply(
      scrollX.interpolate({ inputRange: range, outputRange: [0, 1, 0], extrapolate: 'clamp' }),
      enter.interpolate({ inputRange: [0, delay, 1], outputRange: [0, 0, 1] }),
    ),
    transform: [
      {
        translateY: enter.interpolate({
          inputRange: [0, delay, 1],
          outputRange: reduceMotion ? [0, 0, 0] : [16, 16, 0],
        }),
      },
    ],
  });

  return (
    <View testID={`brand-intro-slide-${String(slideIndex)}`} style={[styles.slide, { width }]}>
      <View style={styles.demoArea}>
        <Animated.View style={[styles.demoFrame, reveal(0.1)]}>
          <StepDemo
            step={step.id}
            copy={copy}
            active={active}
            reduceMotion={reduceMotion}
          />
        </Animated.View>
      </View>
      <View style={styles.copy}>
        <Animated.View style={reveal(0.25)}>
          <Text
            accessibilityRole="header"
            accessibilityLabel={step.title}
            style={styles.title}
            maxFontSizeMultiplier={1.3}
          >
            <Text style={styles.titleLead}>{step.lead}</Text>
            {'\n'}
            <Text style={styles.titleHighlight}>{step.highlight}</Text>
          </Text>
        </Animated.View>
        <Animated.View style={reveal(0.4)}>
          <Text style={styles.body} maxFontSizeMultiplier={1.4}>
            {step.body}
          </Text>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.brand.onSolid },
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing[5],
    paddingTop: theme.spacing[3],
    gap: theme.spacing[3],
  },
  skip: {
    minHeight: theme.touchTarget,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing[3],
  },
  skipText: {
    color: INTRO_COLORS.violet,
    fontSize: 15,
    fontWeight: theme.fontWeights.semibold,
  },
  slide: {
    flex: 1,
    paddingHorizontal: theme.spacing[6],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[4],
    gap: theme.spacing[5],
  },
  // The miniature screen takes whatever height is left above the copy, so short screens
  // shrink it instead of pushing the buttons off screen.
  demoArea: { flex: 1, minHeight: 150, alignItems: 'center', justifyContent: 'center' },
  demoFrame: { width: '100%', maxWidth: 340 },
  copy: { gap: theme.spacing[3], alignItems: 'center' },
  title: { textAlign: 'center', color: INTRO_COLORS.ink, letterSpacing: -0.4 },
  titleLead: { fontSize: 25, lineHeight: 33, fontWeight: '300' },
  titleHighlight: {
    fontSize: 29,
    lineHeight: 37,
    fontWeight: theme.fontWeights.bold,
    color: INTRO_COLORS.violet,
  },
  body: {
    fontSize: 15,
    lineHeight: 23,
    color: INTRO_COLORS.body,
    textAlign: 'center',
    maxWidth: 320,
  },
  footer: {
    alignItems: 'center',
    gap: theme.spacing[5],
    paddingHorizontal: theme.spacing[5],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[4],
  },
  controls: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
  },
  back: { flex: 1 },
  next: { flex: 1.4 },
});
