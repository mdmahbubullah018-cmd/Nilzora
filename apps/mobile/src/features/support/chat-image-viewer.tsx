import { X } from 'lucide-react-native';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '@/theme';

/*
 * A picture from the thread, opened full screen.
 *
 * The bubble shows the thumbnail (or the picture itself on narrow screens); tapping it opens this
 * viewer, which loads the full-size file the API resolved. Nothing is downloaded or copied: the
 * person can pinch or zoom with their platform's own image viewer by taking a screenshot, and the
 * file itself stays behind the same authenticated URL it arrived from.
 *
 * The full-size image is loaded over the existing media URL, so a failure here is not a dead end:
 * the close button always works and the caption shows only a safe display name.
 */
export interface ViewableImage {
  url: string;
  name: string;
}

/**
 * A name that is safe to show: only the last part of whatever was given (no folders), and a plain
 * "Picture" when what is left looks like a storage key (a long hex/uuid string) rather than a
 * name. The picture's address, key and path are never printed, spoken or put in an error.
 */
export function safeImageName(name: string): string {
  const base = name.split(/[\\/]/).pop()?.trim() ?? '';
  if (base === '' || /^[0-9a-f-]{20,}(.[a-z0-9]{2,5})?$/i.test(base)) return 'Picture';
  return base;
}

export function ChatImageViewer({
  image,
  onClose,
}: {
  image: ViewableImage | null;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={image !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <SafeAreaView edges={['top', 'bottom']} style={styles.frame}>
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>
              {image === null ? 'Picture' : safeImageName(image.name)}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close the picture"
              onPress={onClose}
              hitSlop={10}
              style={({ pressed }) => [styles.close, pressed ? styles.closePressed : null]}
            >
              <X size={20} color={theme.colors.softBackground} />
            </Pressable>
          </View>
          {image === null ? null : (
            <Image
              testID="chat-image-full"
              source={{ uri: image.url }}
              resizeMode="contain"
              accessibilityLabel={safeImageName(image.name)}
              style={styles.picture}
            />
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(8, 15, 28, 0.94)' },
  frame: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  title: { flex: 1, color: theme.colors.softBackground, ...theme.text.caption },
  close: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radii.full,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  closePressed: { backgroundColor: 'rgba(255,255,255,0.26)' },
  picture: { flex: 1, margin: theme.spacing[2] },
});
