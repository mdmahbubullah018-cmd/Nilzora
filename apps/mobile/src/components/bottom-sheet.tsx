import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '@/theme';
import { IconButton } from './icon-button';
import { icons } from './icon';

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Runs once the sheet has finished opening, e.g. to reset a draft to the applied values. */
  onOpen?: () => void;
  /** The sheet's heading; the close button repeats it for screen readers. */
  title: string;
  children: ReactNode;
  /** Actions pinned under the scrolling content. */
  footer?: ReactNode;
  testID?: string;
}

/**
 * A sheet that slides up over the screen, built on the engine's own Modal so it needs no
 * dependency and Android's back button closes it. The backdrop is a sighted-only affordance
 * (hidden from screen readers); the header's close button is the named way out. A sheet that
 * holds a form keeps its content above the keyboard.
 */
export function BottomSheet({
  visible,
  onClose,
  onOpen,
  title,
  children,
  footer,
  testID,
}: BottomSheetProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
      onShow={onOpen}
    >
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable
          accessible={false}
          importantForAccessibility="no"
          onPress={onClose}
          style={styles.backdrop}
        />
        <SafeAreaView edges={['bottom']} testID={testID} style={styles.sheet}>
          <View pointerEvents="none" style={styles.grabber} />
          <View style={styles.headerRow}>
            <Text accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
            <IconButton
              icon={icons.close}
              label={`Close ${title.toLocaleLowerCase()}`}
              onPress={onClose}
            />
          </View>
          <ScrollView
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
          {footer === undefined ? null : <View style={styles.footer}>{footer}</View>}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
  },
  sheet: {
    maxHeight: '86%',
    // A solid sheet: the page behind it is dimmed by the scrim, and the panel itself stays
    // opaque so the labels and rows are read against one clean surface.
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: theme.radii.sheet,
    borderTopRightRadius: theme.radii.sheet,
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[4],
    ...theme.shadow.sheet,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: theme.radii.full,
    backgroundColor: theme.colors.borderStrong,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[3],
    paddingLeft: theme.spacing[5],
    paddingRight: theme.spacing[2],
    paddingTop: theme.spacing[2],
  },
  title: { flex: 1, color: theme.colors.foreground, ...theme.text.heading },
  body: { padding: theme.spacing[5], gap: theme.spacing[5] },
  footer: {
    flexDirection: 'row',
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[5],
    paddingTop: theme.spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
});
