import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';
import { theme } from '@/theme';
import { RefreshableScrollView } from './pull-to-refresh/pull-to-refresh';

export interface ScreenFrameProps {
  children: ReactNode;
  /**
   * Safe-area edges this screen pads. Tab screens pad the top; stack screens with a
   * navigation header pad the bottom instead.
   */
  edges?: readonly Edge[];
  /**
   * Lift the content above the on-screen keyboard on Android. The app draws edge to edge, so the
   * system no longer resizes the window for the keyboard (`adjustResize` has no effect); a screen
   * with something anchored at the bottom (a chat composer) must ask for this. It follows the
   * keyboard's real inset (see AndroidKeyboardLift). iOS always lifts.
   */
  liftForKeyboard?: boolean;
}

/** Tab screens have no header of their own, so they pad the top. */
export const TAB_EDGES: readonly Edge[] = ['top'];
/** Stack screens sit under a navigation header, so they pad the bottom. */
export const STACK_EDGES: readonly Edge[] = ['bottom'];
/**
 * A stack screen that hides the navigation header (Search draws its own row) is the one case
 * with nothing above the content, so it pads both ends.
 */
export const HEADERLESS_STACK_EDGES: readonly Edge[] = ['top', 'bottom'];

/** Safe area, page background and keyboard avoidance: the frame shared by every screen kind. */
export function ScreenFrame({
  children,
  edges = TAB_EDGES,
  liftForKeyboard = false,
}: ScreenFrameProps) {
  if (Platform.OS === 'android' && liftForKeyboard) {
    return (
      <SafeAreaView edges={edges} style={styles.safeArea}>
        <AndroidKeyboardLift padsBottomInset={edges.includes('bottom')}>
          {children}
        </AndroidKeyboardLift>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView edges={edges} style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {children}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * Keeps an Android screen's bottom edge (a chat composer) on top of the keyboard.
 *
 * React Native's KeyboardAvoidingView cannot do this reliably here: it compares its own
 * `onLayout` frame, which is relative to its parent, with the keyboard's position in the window,
 * so under a navigation header it lifts too little by the header and status-bar height; and on
 * Android it only listens for `keyboardDidShow`, so a keyboard that changes height while open
 * (Gboard's suggestion strip, clipboard or emoji panel, switching keyboards) is not followed.
 *
 * The IME inset Reanimated reads from the window is the keyboard's real height from the bottom
 * of the screen, updated on every frame of its animation and whenever it changes size. The
 * bottom system-bar inset is already padded by the SafeAreaView when the screen asks for the
 * bottom edge, so only what the keyboard covers beyond it is added: no measured or guessed offset.
 */
function AndroidKeyboardLift({
  children,
  padsBottomInset,
}: {
  children: ReactNode;
  padsBottomInset: boolean;
}) {
  const keyboard = useAnimatedKeyboard({
    isStatusBarTranslucentAndroid: true,
    isNavigationBarTranslucentAndroid: true,
  });
  const insets = useSafeAreaInsets();
  const consumed = padsBottomInset ? insets.bottom : 0;
  const lift = useAnimatedStyle(() => ({
    paddingBottom: Math.max(0, keyboard.height.get() - consumed),
  }));
  return <Animated.View style={[styles.flex, lift]}>{children}</Animated.View>;
}

/** Page title in the same style on every screen. */
export function ScreenTitle({ children }: { children: string }) {
  return (
    <Text accessibilityRole="header" style={styles.title}>
      {children}
    </Text>
  );
}

export interface ScreenProps extends ScreenFrameProps {
  title?: string;
  header?: ReactNode;
  /** Enables the branded pull-to-refresh: pass useManualRefresh's `onRefresh`. */
  onRefresh?: () => unknown;
  /** Pauses the pull (without remounting the content) while it would do nothing useful. */
  refreshEnabled?: boolean;
  /** Extra space under the content, so the floating tab bar never covers the last row. */
  bottomSpace?: number;
  /** Space above the content, under the safe area. Defaults to `theme.layout.screenTop`. */
  topGap?: number;
  /** Space between the header, the title and the body. Defaults to `theme.layout.frameGap`. */
  contentGap?: number;
  /** Test id of the scrolling area. */
  testID?: string;
}

/**
 * Scrolling screen: safe area, page title and content that stays clear of the keyboard.
 * For a long list use <ListScreen> instead, so rows are virtualised.
 */
export function Screen({
  title,
  header,
  children,
  edges = TAB_EDGES,
  onRefresh,
  refreshEnabled,
  bottomSpace = 0,
  topGap = theme.layout.screenTop,
  contentGap = theme.layout.frameGap,
  testID,
}: ScreenProps) {
  return (
    <ScreenFrame edges={edges}>
      <RefreshableScrollView
        testID={testID}
        contentContainerStyle={[
          styles.content,
          { paddingTop: topGap, gap: contentGap },
          bottomSpace > 0 ? { paddingBottom: theme.spacing[10] + bottomSpace } : null,
        ]}        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onRefresh={onRefresh}
        refreshEnabled={refreshEnabled}
      >
        {header}
        {title ? <ScreenTitle>{title}</ScreenTitle> : null}
        <View style={styles.body}>{children}</View>
      </RefreshableScrollView>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.colors.surfaceMuted },
  flex: { flex: 1 },
  content: {
    paddingHorizontal: theme.spacing[5],
    paddingBottom: theme.spacing[10],
    // A short page still fills the viewport, so a block can take the room left under it (the
    // account's Sign out) without being pushed there by an absolute offset.
    flexGrow: 1,
  },
  title: {
    color: theme.colors.foreground,
    ...theme.text.display,
  },
  body: { gap: theme.layout.itemGap, flexGrow: 1 },
});
