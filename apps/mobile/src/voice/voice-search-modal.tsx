import {
  Check,
  CircleAlert,
  Mic,
  MicOff,
  Search as SearchIcon,
  Square,
  WifiOff,
  X,
} from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/button';
import { useReduceMotion } from '@/components/use-reduce-motion';
import { MAX_SEARCH_LENGTH, parseShopFilters } from '@/features/catalog/catalog-query';
import { isSearchable, useSearchResults } from '@/features/search/search-hooks';
import { theme } from '@/theme';
import type { SpeechErrorCode } from './native-speech';
import { useVoiceSearch, type VoiceProblem } from './use-voice-search';
import type { VoiceLanguage } from './voice-intent';

/*
 * The voice-search window: a calm, light full-screen sheet with glass cards and the brand's blue
 * gradient on the microphone. Everything that matters sits in the upper part of the screen (and
 * the sheet scrolls), so the keyboard never covers it and small phones still reach every button.
 *
 *   - the microphone has two soft rings: one breathes, one follows the customer's voice (both
 *     hold still with reduced motion);
 *   - each state has its own headline: ready, listening, finishing, check what we heard, and a
 *     distinct headline for a missing microphone permission, silence, no connection and errors;
 *   - the words appear as they are recognised, in a field the customer can correct, with the
 *     language they spoke and, when request words were removed, exactly what was heard;
 *   - Stop, Try again, Cancel and Search are always where they are expected; Search confirms once.
 */

const PROBLEM_TEXT: Readonly<Record<SpeechErrorCode, string>> = {
  no_speech: 'We did not hear anything. Tap the microphone and try again.',
  network: 'Voice search needs an internet connection. Check your connection, then try again.',
  permission: 'Nilzora needs the microphone to hear your search. Allow it, then try again.',
  busy: 'The phone’s speech service is busy. Try again in a moment.',
  language: 'This language is not available for voice input on your phone.',
  audio: 'The microphone could not be used. Close other apps that use it, then try again.',
  unavailable: 'Voice search is not available on this phone.',
  failed: 'Voice search could not start. Try again.',
};

const PROBLEM_TITLE: Readonly<Record<SpeechErrorCode, string>> = {
  no_speech: 'We didn’t catch that',
  network: 'No connection',
  permission: 'Microphone is off',
  busy: 'Speech service is busy',
  language: 'Language not available',
  audio: 'Microphone unavailable',
  unavailable: 'Not available',
  failed: 'Voice search stopped',
};

const LANGUAGE_LABEL: Readonly<Record<VoiceLanguage, string>> = {
  english: 'English',
  bangla: 'বাংলা',
  // Romanised Bangla is rewritten into Bangla before it is searched, so that is what the customer is shown.
  banglish: 'বাংলা',
  mixed: 'Mixed',
};

/** How long the words must rest before the window asks the catalogue how many there are. */
const PREVIEW_DEBOUNCE_MS = 350;

/** A value that only changes once it has stopped changing, so a preview costs one request. */
function useSettled<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value);
    }, delay);
    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);
  return settled;
}

function problemText(problem: VoiceProblem): string {
  if (problem.code === 'permission' && !problem.canAskAgain) {
    return 'Microphone access is turned off for Nilzora. Allow it in Settings to use voice search.';
  }
  return PROBLEM_TEXT[problem.code];
}

function ProblemIcon({ code }: { code: SpeechErrorCode }) {
  const props = { size: 18, color: theme.notice.danger.icon, accessible: false } as const;
  if (code === 'permission') return <MicOff {...props} />;
  if (code === 'network') return <WifiOff {...props} />;
  return <CircleAlert {...props} />;
}

export interface VoiceSearchModalProps {
  visible: boolean;
  onClose: () => void;
  /** The confirmed text. Called at most once per opening. */
  onConfirm: (text: string) => void;
}

export function VoiceSearchModal({ visible, onClose, onConfirm }: VoiceSearchModalProps) {
  const voice = useVoiceSearch();
  const { state, text, heard, language, problem, start, cancel } = voice;
  const reduceMotion = useReduceMotion();
  const confirmed = useRef(false);
  const [pulse] = useState(() => new Animated.Value(1));
  const [loudness] = useState(() => new Animated.Value(0));

  // Opening starts listening at once (the customer just tapped the microphone); closing releases it.
  useEffect(() => {
    if (!visible) return undefined;
    confirmed.current = false;
    void start();
    return () => {
      cancel();
    };
    // The attempt belongs to this opening only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const listening = state === 'listening';
  useEffect(() => {
    if (!listening || reduceMotion) {
      pulse.setValue(1);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.12, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [listening, reduceMotion, pulse]);
  useEffect(() => {
    if (reduceMotion) return;
    Animated.timing(loudness, {
      toValue: listening ? voice.level : 0,
      duration: 120,
      useNativeDriver: true,
    }).start();
  }, [listening, reduceMotion, voice.level, loudness]);

  const trimmed = text.trim();
  const canSearch = trimmed !== '' && state !== 'asking' && state !== 'processing';

  /*
   * How many products the words would find, asked through the same search pipeline the results
   * screen uses — the same filters object, so even the query key matches and the screen reuses
   * this answer instead of asking again. The words must rest for a moment first, so speaking or
   * typing costs one request, not one per partial result.
   */
  const settled = useSettled(trimmed, PREVIEW_DEBOUNCE_MS);
  const previewFilters = parseShopFilters({ q: settled });
  const preview = useSearchResults(previewFilters, {
    enabled: visible && state === 'ready' && isSearchable(previewFilters.q),
  });
  const previewTotal = preview.total;
  const previewReady = state === 'ready' && !preview.query.isFetching && previewTotal !== null;
  const noResults = previewReady && previewTotal === 0;

  const headline =
    state === 'asking'
      ? 'Allow the microphone to continue'
      : listening
        ? 'Listening…'
        : state === 'processing'
          ? 'Finishing…'
          : state === 'ready'
            ? noResults
              ? 'No products found'
              : previewReady && previewTotal !== null
                ? 'Results found'
                : 'Check what we heard'
            : state === 'error' && problem !== null
              ? PROBLEM_TITLE[problem.code]
              : state === 'error'
                ? 'Voice search stopped'
                : 'Ready';
  const hint = listening
    ? trimmed === ''
      ? 'Say what you are looking for — English or Bangla.'
      : 'Tap the microphone when you are done.'
    : state === 'idle'
      ? 'Tap the microphone and say what you are looking for.'
      : noResults
        ? 'Nothing matched those words. Change a word, or say it again.'
        : null;

  function confirm() {
    if (confirmed.current || !canSearch) return;
    confirmed.current = true;
    onConfirm(trimmed);
  }

  const orbAction = listening ? 'Stop listening' : 'Start listening';
  const outer = Animated.add(1, Animated.multiply(loudness, 0.45));
  const showHeard = language !== null && heard !== '' && heard !== trimmed;

  return (
    <Modal visible={visible} animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.screen}>
        {/* A very soft brand wash behind everything, so the sheet reads as one surface. */}
        <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} pointerEvents="none">
          <Defs>
            <LinearGradient id="voice-bg" x1="0" y1="0" x2="0.4" y2="1">
              <Stop offset="0" stopColor="#F7FBFF" />
              <Stop offset="0.55" stopColor="#F1F5F9" />
              <Stop offset="1" stopColor="#EAF3FB" />
            </LinearGradient>
          </Defs>
          <Circle cx="0" cy="0" r="100%" fill="url(#voice-bg)" />
        </Svg>
        <SafeAreaView style={styles.safe} testID="voice-search">
          <View style={styles.topRow}>
            <View style={styles.titleBlock}>
              <Text accessibilityRole="header" style={styles.title}>
                Voice search
              </Text>
              <Text style={styles.subtitle}>English or Bangla</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close voice search"
              hitSlop={8}
              onPress={onClose}
              style={styles.close}
            >
              <X size={20} color={theme.colors.foreground} accessible={false} />
            </Pressable>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.stage}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.orbArea}>
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.ring,
                  styles.ringOuter,
                  { transform: [{ scale: outer }], opacity: listening ? 1 : 0.2 },
                ]}
              />
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.ring,
                  styles.ringInner,
                  { transform: [{ scale: pulse }], opacity: listening ? 1 : 0.32 },
                ]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={orbAction}
                accessibilityHint={
                  listening ? 'Stops listening and keeps what was heard' : 'Listens for your search'
                }
                accessibilityState={{ busy: state === 'asking' || state === 'processing' }}
                disabled={state === 'asking' || state === 'processing'}
                onPress={() => {
                  if (listening) voice.finish();
                  else void start();
                }}
                style={({ pressed }) => [styles.orb, pressed ? styles.orbPressed : null]}
              >
                <Svg width={ORB} height={ORB} style={StyleSheet.absoluteFill}>
                  <Defs>
                    <LinearGradient id="orb" x1="0" y1="0" x2="1" y2="1">
                      <Stop offset="0" stopColor={theme.colors.sky} />
                      <Stop offset="0.55" stopColor={theme.colors.primary} />
                      <Stop offset="1" stopColor={theme.colors.violet} />
                    </LinearGradient>
                  </Defs>
                  <Circle cx={ORB / 2} cy={ORB / 2} r={ORB / 2} fill="url(#orb)" />
                </Svg>
                {state === 'asking' || state === 'processing' ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : listening ? (
                  <Square size={26} color="#FFFFFF" fill="#FFFFFF" accessible={false} />
                ) : (
                  <Mic size={34} color="#FFFFFF" accessible={false} />
                )}
              </Pressable>
            </View>

            <StateChip
              state={state}
              listening={listening}
              found={previewReady ? previewTotal : null}
            />

            <View style={styles.statusBlock}>
              <Text style={styles.status} accessibilityLiveRegion="polite">
                {headline}
              </Text>
              {hint === null ? null : <Text style={styles.hint}>{hint}</Text>}
            </View>

            <Waveform level={voice.level} active={listening} reduceMotion={reduceMotion} />

            {problem === null ? null : (
              <View style={styles.problem} accessibilityLiveRegion="polite">
                <View style={styles.problemHead}>
                  <ProblemIcon code={problem.code} />
                  <Text style={styles.problemText}>{problemText(problem)}</Text>
                </View>
                {problem.code === 'permission' && !problem.canAskAgain ? (
                  <Button
                    label="Open settings"
                    variant="secondary"
                    onPress={() => void Linking.openSettings().catch(() => undefined)}
                  />
                ) : null}
              </View>
            )}

            <View style={styles.card}>
              {language === null ? null : (
                <View
                  style={styles.langPill}
                  accessible
                  accessibilityLabel={`Heard as ${language === 'bangla' || language === 'banglish' ? 'Bangla' : LANGUAGE_LABEL[language]}`}
                >
                  <Text style={styles.langText}>{LANGUAGE_LABEL[language]}</Text>
                </View>
              )}
              <TextInput
                value={text}
                onChangeText={voice.edit}
                placeholder="Your search will appear here"
                placeholderTextColor={theme.colors.mutedForeground}
                accessibilityLabel="What we heard. You can edit it."
                multiline
                maxLength={MAX_SEARCH_LENGTH}
                selectionColor={theme.colors.primary}
                returnKeyType="search"
                submitBehavior="blurAndSubmit"
                onSubmitEditing={confirm}
                style={styles.input}
              />
              {showHeard ? <Text style={styles.heard}>You said: {heard}</Text> : null}
              {previewReady && previewTotal !== null && previewTotal > 0 ? (
                <View style={styles.resultRow} accessibilityLiveRegion="polite">
                  <Check size={14} color={theme.colors.primary} accessible={false} />
                  <Text style={styles.resultText}>
                    {previewTotal} {previewTotal === 1 ? 'product' : 'products'} found
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={styles.actions}>
              <Button label="Cancel" variant="secondary" onPress={onClose} />
              {listening ? (
                <Button label="Stop" variant="secondary" onPress={voice.finish} />
              ) : null}
              {state === 'ready' || state === 'error' ? (
                <Button
                  label="Try again"
                  variant="secondary"
                  onPress={() => {
                    void start();
                  }}
                />
              ) : null}
              <Button
                label={noResults ? 'Search anyway' : 'Search'}
                disabled={!canSearch}
                onPress={confirm}
              />
            </View>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

/**
 * The state, at a glance: one small glass pill with an icon and a word. The headline below says
 * the same thing in a sentence, so the state is never carried by colour or by an icon alone.
 */
function StateChip({
  state,
  listening,
  found,
}: {
  state: ReturnType<typeof useVoiceSearch>['state'];
  listening: boolean;
  found: number | null;
}) {
  const icon =
    state === 'error' ? (
      <CircleAlert size={13} color={theme.notice.danger.icon} accessible={false} />
    ) : state === 'ready' ? (
      found === 0 ? (
        <CircleAlert size={13} color={theme.notice.warning.icon} accessible={false} />
      ) : (
        <Check size={13} color={theme.colors.primary} accessible={false} />
      )
    ) : listening ? (
      <Mic size={13} color={theme.colors.primary} accessible={false} />
    ) : (
      <SearchIcon size={13} color={theme.colors.mutedForeground} accessible={false} />
    );
  const label =
    state === 'error'
      ? 'Needs attention'
      : state === 'ready'
        ? found === 0
          ? 'No results'
          : found === null
            ? 'Ready'
            : 'Results'
        : listening
          ? 'Now listening'
          : state === 'processing'
            ? 'Processing'
            : state === 'asking'
              ? 'Permission'
              : 'Ready';
  return (
    <View style={styles.chip} accessible accessibilityLabel={`Voice search: ${label}`}>
      {icon}
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

/**
 * The listening meter: a short row of bars that rise and fall with the customer's voice, taken
 * from the recogniser's own loudness reports. It is decorative — the headline above carries
 * the state for a screen reader — and it holds still when the phone asks for reduced motion.
 */
function Waveform({
  level,
  active,
  reduceMotion,
}: {
  level: number;
  active: boolean;
  reduceMotion: boolean;
}) {
  const strengths = [0.5, 0.85, 1, 0.7, 0.45];
  const levelShown = active && !reduceMotion ? Math.min(1, Math.max(0, level)) : 0;
  return (
    <View style={styles.wave} accessible={false} importantForAccessibility="no">
      {strengths.map((strength, index) => (
        <View
          key={index}
          testID={`voice-wave-${String(index)}`}
          style={[
            styles.waveBar,
            active ? styles.waveBarActive : null,
            { height: Math.round(6 + levelShown * 26 * strength) },
          ]}
        />
      ))}
    </View>
  );
}

const ORB = 96;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F1F5F9' },
  safe: { flex: 1 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[2],
  },
  titleBlock: { flex: 1, gap: 1 },
  title: { ...theme.text.heading, color: theme.colors.foreground },
  subtitle: { ...theme.text.caption, color: theme.colors.mutedForeground },
  close: {
    width: theme.touchTarget,
    height: theme.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.touchTarget / 2,
    backgroundColor: theme.glass.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.glass.border,
  },
  stage: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[6],
    gap: theme.spacing[3],
  },
  orbArea: { height: ORB + 72, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', borderRadius: 999 },
  ringOuter: {
    width: ORB + 64,
    height: ORB + 64,
    backgroundColor: 'rgba(139, 92, 246, 0.14)',
  },
  ringInner: {
    width: ORB + 34,
    height: ORB + 34,
    backgroundColor: 'rgba(56, 189, 248, 0.26)',
  },
  orb: {
    width: ORB,
    height: ORB,
    borderRadius: ORB / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    ...theme.shadow.floating,
  },
  orbPressed: { opacity: 0.88, transform: [{ scale: 0.98 }] },
  chip: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: theme.glass.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.glass.border,
  },
  chipText: {
    color: theme.colors.foreground,
    fontSize: 12,
    fontWeight: theme.fontWeights.semibold,
    letterSpacing: 0.2,
  },
  statusBlock: { alignItems: 'center', gap: 4 },
  status: {
    textAlign: 'center',
    color: theme.colors.foreground,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: theme.fontWeights.semibold,
  },
  hint: { textAlign: 'center', color: theme.colors.mutedForeground, fontSize: 14, lineHeight: 20 },
  problem: {
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderRadius: theme.radii.lg,
    backgroundColor: theme.notice.danger.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.notice.danger.border,
  },
  problemHead: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing[2] },
  problemText: { flex: 1, color: theme.notice.danger.foreground, fontSize: 14, lineHeight: 20 },
  card: {
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderRadius: theme.radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.glass.border,
    backgroundColor: theme.glass.surfaceRaised,
  },
  langPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    borderRadius: theme.radii.full,
    backgroundColor: theme.glass.activePill,
  },
  langText: { color: theme.colors.primary, fontSize: 12, fontWeight: theme.fontWeights.semibold },
  input: {
    minHeight: 64,
    maxHeight: 140,
    color: theme.colors.foreground,
    fontSize: 20,
    lineHeight: 28,
    textAlignVertical: 'top',
    padding: 0,
  },
  heard: { color: theme.colors.mutedForeground, fontSize: 13, lineHeight: 18 },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  resultText: { color: theme.colors.primary, fontSize: 13, fontWeight: theme.fontWeights.semibold },
  wave: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    height: 34,
  },
  waveBar: { width: 4, borderRadius: 2, backgroundColor: 'rgba(2, 132, 199, 0.3)' },
  waveBarActive: { backgroundColor: theme.colors.primary },
  actions: { gap: theme.spacing[2], paddingTop: theme.spacing[1] },
});
