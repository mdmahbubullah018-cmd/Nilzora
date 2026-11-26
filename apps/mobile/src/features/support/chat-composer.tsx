import { Camera, FileText, Images, Mic, Plus } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from '@/components/bottom-sheet';
import { theme } from '@/theme';
import {
  CHAT_ATTACHMENT_MAX_PER_MESSAGE,
  CHAT_DOCUMENT_TYPES,
  chatMediaMaxLabel,
} from '@nilzora/contracts';

/*
 * The chat composer's controls
 * ----------------------------
 * One round "attach" button on the left of the message field opens a sheet with the three things
 * the chat can really send besides text:
 *
 *   Photo library — the system photo picker, several pictures at once
 *   Camera        — the device camera
 *   Files         — the document browser, limited to the types the server accepts
 *
 * On the right, the field has one round button that is the microphone while there is nothing to
 * send and Send once there is a draft or a selected file. A voice message is recorded from the
 * microphone button; it is never started without a tap on it.
 *
 * Every control is 44dp with a real accessible name, and nothing here invents a feature: the sheet
 * names the exact file types and limits it accepts rather than implying "any file".
 */

/** One round icon button next to the message field. */
export function ComposerAction({
  icon,
  label,
  hint,
  onPress,
  disabled = false,
}: {
  icon: 'attach' | 'mic';
  label: string;
  hint: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const Glyph = icon === 'mic' ? Mic : Plus;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.action,
        icon === 'mic' ? styles.actionMic : null,
        pressed && !disabled ? styles.actionPressed : null,
        disabled ? styles.actionDisabled : null,
      ]}
    >
      <Glyph
        size={21}
        color={icon === 'mic' ? theme.colors.primaryActionForeground : theme.colors.primaryAction}
        strokeWidth={theme.icon.stroke.idle}
      />
    </Pressable>
  );
}

/** The file types the chat really accepts, from the shared contract rather than a literal list. */
const FILE_TYPE_LABELS = ['PDF', 'TXT', 'CSV', 'DOCX', 'XLSX'];

function SheetOption({
  icon,
  label,
  hint,
  onPress,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      style={({ pressed }) => [styles.sheetRow, pressed ? styles.sheetRowPressed : null]}
    >
      <View style={styles.sheetIcon}>{icon}</View>
      <View style={styles.sheetText}>
        <Text style={styles.sheetLabel}>{label}</Text>
        <Text style={styles.sheetHint}>{hint}</Text>
      </View>
    </Pressable>
  );
}

/**
 * The attach sheet. It closes itself before it hands over to a picker, so the system picker
 * is never stacked on top of a modal; `slots` is how many more files this message can take.
 */
export function AttachSheet({
  visible,
  slots,
  onClose,
  onPickLibrary,
  onPickCamera,
  onPickFile,
}: {
  visible: boolean;
  slots: number;
  onClose: () => void;
  onPickLibrary: () => void;
  onPickCamera: () => void;
  onPickFile: () => void;
}) {
  const choose = (pick: () => void) => () => {
    onClose();
    pick();
  };
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Add to your message"
      testID="attach-sheet"
    >
      <Text style={styles.sheetLead}>
        Up to {CHAT_ATTACHMENT_MAX_PER_MESSAGE} files per message ({slots} left). Pictures up to{' '}
        {chatMediaMaxLabel('image')}, documents up to {chatMediaMaxLabel('document')}.
      </Text>
      <SheetOption
        icon={<Images size={20} color={theme.colors.primaryAction} strokeWidth={1.8} />}
        label="Photo library"
        hint={slots > 1 ? `Choose up to ${String(slots)} pictures` : 'Choose a picture'}
        onPress={choose(onPickLibrary)}
      />
      <SheetOption
        icon={<Camera size={20} color={theme.colors.primaryAction} strokeWidth={1.8} />}
        label="Camera"
        hint="Take a picture now"
        onPress={choose(onPickCamera)}
      />
      <SheetOption
        icon={<FileText size={20} color={theme.colors.primaryAction} strokeWidth={1.8} />}
        label="Files"
        hint={`${FILE_TYPE_LABELS.join(', ')} · ${String(CHAT_DOCUMENT_TYPES.length)} accepted types`}
        onPress={choose(onPickFile)}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  action: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radii.full,
    backgroundColor: theme.colors.iconSurface,
  },
  actionMic: { backgroundColor: theme.colors.primaryAction },
  actionPressed: { backgroundColor: theme.colors.infoSurface, opacity: 0.9 },
  actionDisabled: { opacity: 0.45 },
  sheetLead: { ...theme.text.body, color: theme.colors.body },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    minHeight: 60,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceMuted,
  },
  sheetRowPressed: { backgroundColor: theme.colors.infoSurface },
  sheetIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radii.input,
    backgroundColor: theme.colors.surface,
  },
  sheetText: { flex: 1, gap: 1 },
  sheetLabel: { ...theme.text.subheading, color: theme.colors.foreground },
  sheetHint: { ...theme.text.caption, color: theme.colors.mutedForeground },
});
